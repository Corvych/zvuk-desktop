#![cfg(windows)]

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::core::{w, Interface, GUID as WinGUID, HSTRING};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{
    CoCreateInstance as WinCoCreateInstance, CoInitializeEx as WinCoInitializeEx, CoUninitialize,
    CLSCTX_INPROC_SERVER as WIN_CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED as WIN_COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{
    DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW,
    SetCurrentProcessExplicitAppUserModelID, ShellLink,
};
use windows_sys::core::{GUID, HRESULT};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    CreateBitmap, CreateDIBSection, DeleteObject, GetDC, ReleaseDC, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, RGBQUAD,
};
use windows_sys::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows_sys::Win32::UI::Shell::{
    DefSubclassProc, SetWindowSubclass, THBF_DISABLED, THBF_ENABLED, THBN_CLICKED, THB_FLAGS,
    THB_ICON, THB_TOOLTIP, THUMBBUTTON,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, RegisterWindowMessageW, HICON, ICONINFO, WM_COMMAND, WM_SETTINGCHANGE,
};

const ID_PREV: u32 = 100;
const ID_PLAY_PAUSE: u32 = 101;
const ID_NEXT: u32 = 102;

const SUBCLASS_ID: usize = 4242;

const CLSID_TASKBAR_LIST: GUID = GUID {
    data1: 0x56FDF344,
    data2: 0xFD6D,
    data3: 0x11D0,
    data4: [0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90],
};

const IID_ITASKBAR_LIST3: GUID = GUID {
    data1: 0xEA1AFB91,
    data2: 0x9E28,
    data3: 0x4B86,
    data4: [0x90, 0xE9, 0x9E, 0x9F, 0x8A, 0x5E, 0xEF, 0xAF],
};

#[repr(C)]
#[allow(non_snake_case)]
struct ITaskbarList3Vtbl {
    QueryInterface: unsafe extern "system" fn(this: *mut c_void, riid: *const GUID, ppv: *mut *mut c_void) -> HRESULT,
    AddRef: unsafe extern "system" fn(this: *mut c_void) -> u32,
    Release: unsafe extern "system" fn(this: *mut c_void) -> u32,
    HrInit: unsafe extern "system" fn(this: *mut c_void) -> HRESULT,
    AddTab: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND) -> HRESULT,
    DeleteTab: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND) -> HRESULT,
    ActivateTab: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND) -> HRESULT,
    SetActiveAlt: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND) -> HRESULT,
    MarkFullscreenWindow: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND, fFullscreen: i32) -> HRESULT,
    SetProgressValue: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND, ullCompleted: u64, ullTotal: u64) -> HRESULT,
    SetProgressState: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND, tbpFlags: u32) -> HRESULT,
    RegisterTab: unsafe extern "system" fn(this: *mut c_void, hwndTab: HWND, hwndMDI: HWND) -> HRESULT,
    UnregisterTab: unsafe extern "system" fn(this: *mut c_void, hwndTab: HWND) -> HRESULT,
    SetTabOrder: unsafe extern "system" fn(this: *mut c_void, hwndTab: HWND, hwndInsertBefore: HWND) -> HRESULT,
    SetTabActive: unsafe extern "system" fn(this: *mut c_void, hwndTab: HWND, hwndMDI: HWND, tbatFlags: u32) -> HRESULT,
    ThumbBarAddButtons: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND, cButtons: u32, pButton: *const THUMBBUTTON) -> HRESULT,
    ThumbBarUpdateButtons: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND, cButtons: u32, pButton: *const THUMBBUTTON) -> HRESULT,
    ThumbBarSetImageList: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND, himl: *mut c_void) -> HRESULT,
    SetOverlayIcon: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND, hIcon: HICON, pszDescription: *const u16) -> HRESULT,
    SetThumbnailTooltip: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND, pszTip: *const u16) -> HRESULT,
    SetThumbnailClip: unsafe extern "system" fn(this: *mut c_void, hwnd: HWND, prcClip: *const c_void) -> HRESULT,
}

#[repr(C)]
#[allow(non_snake_case)]
struct ITaskbarList3 {
    lpVtbl: *const ITaskbarList3Vtbl,
}

struct SendPtr<T>(pub *mut T);
unsafe impl<T> Send for SendPtr<T> {}
unsafe impl<T> Sync for SendPtr<T> {}

impl<T> Clone for SendPtr<T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for SendPtr<T> {}

struct Icons {
    prev: HICON,
    play: HICON,
    pause: HICON,
    next: HICON,
}
unsafe impl Send for Icons {}
unsafe impl Sync for Icons {}

// Global state for taskbar toolbar
static GLOBAL_APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);
static GLOBAL_HWND: Mutex<Option<SendPtr<c_void>>> = Mutex::new(None);
static TASKBAR_LIST: Mutex<Option<SendPtr<ITaskbarList3>>> = Mutex::new(None);
static TASKBAR_ICONS: Mutex<Option<Icons>> = Mutex::new(None);
static BUTTONS_INITIALIZED: AtomicBool = AtomicBool::new(false);
static TASKBAR_BUTTON_CREATED_MSG: AtomicU32 = AtomicU32::new(0);
static LAST_STATE: Mutex<(bool, bool, bool)> = Mutex::new((false, false, false));
static LAST_JUMP_LIST_LIGHT_THEME: AtomicBool = AtomicBool::new(false);

unsafe extern "system" fn taskbar_subclass_proc(
    hwnd: HWND,
    u_msg: u32,
    w_param: WPARAM,
    l_param: LPARAM,
    _u_id_subclass: usize,
    _dw_ref_data: usize,
) -> LRESULT {
    let created_msg = TASKBAR_BUTTON_CREATED_MSG.load(Ordering::SeqCst);
    if created_msg != 0 && u_msg == created_msg {
        BUTTONS_INITIALIZED.store(false, Ordering::SeqCst);
        let taskbar_opt = *TASKBAR_LIST.lock().unwrap();
        if let Some(t) = taskbar_opt {
            let (is_playing, can_prev, can_next) = *LAST_STATE.lock().unwrap();
            update_buttons_internal(hwnd, t.0, is_playing, can_prev, can_next);
        }
        return 0;
    }

    if u_msg == WM_SETTINGCHANGE {
        let is_light = is_system_light_theme();
        if LAST_JUMP_LIST_LIGHT_THEME.swap(is_light, Ordering::SeqCst) != is_light {
            init_jump_list_async();
        }
    }

    if u_msg == WM_COMMAND {
        let hi = ((w_param >> 16) & 0xffff) as u16;
        let lo = (w_param & 0xffff) as u32;
        if hi == THBN_CLICKED as u16 {
            let app_opt = GLOBAL_APP_HANDLE.lock().unwrap().clone();
            if let Some(app) = app_opt {
                match lo {
                    ID_PREV => {
                        let _ = app.emit("taskbar-prev", ());
                        return 0;
                    }
                    ID_PLAY_PAUSE => {
                        let _ = app.emit("taskbar-play-pause", ());
                        return 0;
                    }
                    ID_NEXT => {
                        let _ = app.emit("taskbar-next", ());
                        return 0;
                    }
                    _ => {}
                }
            }
        }
    }
    DefSubclassProc(hwnd, u_msg, w_param, l_param)
}

fn create_bgra_icon<F>(draw_fn: F) -> Option<HICON>
where
    F: Fn(f64, f64) -> bool,
{
    const W: i32 = 24;
    const H: i32 = 24;
    let mut pixels = [0u8; (W * H * 4) as usize];

    for y in 0..H {
        for x in 0..W {
            let mut hits = 0;
            // 3x3 supersampling for crisp smooth edges
            for sy in 0..3 {
                for sx in 0..3 {
                    let px = (x as f64) + (sx as f64 + 0.5) / 3.0;
                    let py = (y as f64) + (sy as f64 + 0.5) / 3.0;
                    if draw_fn(px, py) {
                        hits += 1;
                    }
                }
            }

            if hits > 0 {
                let alpha = (hits * 255 / 9) as u8;
                let idx = ((y * W + x) * 4) as usize;
                // BGRA format
                pixels[idx] = 255;     // B
                pixels[idx + 1] = 255; // G
                pixels[idx + 2] = 255; // R
                pixels[idx + 3] = alpha;
            }
        }
    }

    unsafe {
        let mask_bytes = vec![0u8; (((W + 15) / 16) * 2 * H) as usize];
        let hbm_mask = CreateBitmap(W, H, 1, 1, mask_bytes.as_ptr() as _);
        if hbm_mask.is_null() {
            return None;
        }

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: W,
                biHeight: -H, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD {
                rgbBlue: 0,
                rgbGreen: 0,
                rgbRed: 0,
                rgbReserved: 0,
            }],
        };

        let hdc = GetDC(std::ptr::null_mut());
        let mut bits: *mut c_void = std::ptr::null_mut();
        let hbm_color = CreateDIBSection(
            hdc,
            &bmi,
            DIB_RGB_COLORS,
            &mut bits,
            std::ptr::null_mut(),
            0,
        );
        ReleaseDC(std::ptr::null_mut(), hdc);

        if hbm_color.is_null() || bits.is_null() {
            DeleteObject(hbm_mask);
            return None;
        }

        std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u8, pixels.len());

        let icon_info = ICONINFO {
            fIcon: 1,
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: hbm_mask,
            hbmColor: hbm_color,
        };

        let hicon = CreateIconIndirect(&icon_info);
        DeleteObject(hbm_mask);
        DeleteObject(hbm_color);

        if hicon.is_null() {
            None
        } else {
            Some(hicon)
        }
    }
}

fn create_icons() -> Option<Icons> {
    // Prev: bar on left + triangle pointing left
    let prev = create_bgra_icon(|x, y| {
        // Vertical bar
        if (4.0..=6.5).contains(&x) && (4.5..=19.5).contains(&y) {
            return true;
        }
        // Triangle pointing left from x=18 down to x=7
        if (7.0..=18.0).contains(&x) {
            let half_h = (x - 7.0) * (7.5 / 11.0);
            return (12.0 - half_h..=12.0 + half_h).contains(&y);
        }
        false
    })?;

    // Play: triangle pointing right
    let play = create_bgra_icon(|x, y| {
        if (7.0..=18.0).contains(&x) {
            let half_h = (18.0 - x) * (7.5 / 11.0);
            return (12.0 - half_h..=12.0 + half_h).contains(&y);
        }
        false
    })?;

    // Pause: two vertical bars
    let pause = create_bgra_icon(|x, y| {
        if (4.5..=19.5).contains(&y) {
            if (5.5..=9.5).contains(&x) || (14.5..=18.5).contains(&x) {
                return true;
            }
        }
        false
    })?;

    // Next: triangle pointing right + bar on right
    let next = create_bgra_icon(|x, y| {
        // Triangle pointing right from x=6 (base) to x=17 (tip)
        if (6.0..=17.0).contains(&x) {
            let half_h = (17.0 - x) * (7.5 / 11.0);
            if (12.0 - half_h..=12.0 + half_h).contains(&y) {
                return true;
            }
        }
        // Vertical bar on right
        if (17.5..=20.0).contains(&x) && (4.5..=19.5).contains(&y) {
            return true;
        }
        false
    })?;

    Some(Icons {
        prev,
        play,
        pause,
        next,
    })
}

fn encode_wide(s: &str) -> [u16; 260] {
    let mut buf = [0u16; 260];
    let mut i = 0;
    for c in s.encode_utf16() {
        if i >= 259 {
            break;
        }
        buf[i] = c;
        i += 1;
    }
    buf[i] = 0;
    buf
}

pub fn init_taskbar(window: &WebviewWindow, app_handle: AppHandle) {
    let hwnd_raw = match window.hwnd() {
        Ok(h) => h,
        Err(e) => {
            log::error!("[Taskbar] Failed to get window hwnd: {:?}", e);
            return;
        }
    };

    let hwnd = hwnd_raw.0 as HWND;

    *GLOBAL_APP_HANDLE.lock().unwrap() = Some(app_handle);
    *GLOBAL_HWND.lock().unwrap() = Some(SendPtr(hwnd as _));

    // Register TaskbarButtonCreated message
    unsafe {
        let msg = RegisterWindowMessageW(encode_wide("TaskbarButtonCreated").as_ptr());
        TASKBAR_BUTTON_CREATED_MSG.store(msg, Ordering::SeqCst);
    }

    // Initialize COM and TaskbarList
    unsafe {
        let _ = CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED as u32);

        let mut tbl: *mut c_void = std::ptr::null_mut();
        let hr = CoCreateInstance(
            &CLSID_TASKBAR_LIST,
            std::ptr::null_mut(),
            CLSCTX_INPROC_SERVER,
            &IID_ITASKBAR_LIST3,
            &mut tbl,
        );

        if hr != 0 || tbl.is_null() {
            log::error!("[Taskbar] Failed to create ITaskbarList3 instance: 0x{:X}", hr);
            return;
        }

        let taskbar = tbl as *mut ITaskbarList3;
        let hr_init = ((*taskbar).lpVtbl.as_ref().unwrap().HrInit)(tbl);
        if hr_init != 0 {
            log::error!("[Taskbar] HrInit failed: 0x{:X}", hr_init);
            return;
        }

        *TASKBAR_LIST.lock().unwrap() = Some(SendPtr(taskbar));

        // Subclass window to receive WM_COMMAND and TaskbarButtonCreated
        SetWindowSubclass(hwnd, Some(taskbar_subclass_proc), SUBCLASS_ID, 0);

        // Create icons
        if let Some(icons) = create_icons() {
            *TASKBAR_ICONS.lock().unwrap() = Some(icons);
        } else {
            log::error!("[Taskbar] Failed to create icons for thumbnail toolbar");
            return;
        }

        // Add initial buttons (disabled / stopped state)
        update_buttons_internal(hwnd, taskbar, false, false, false);
    }

    init_jump_list_async();
}

pub const APP_USER_MODEL_ID: &str = "com.corvych.zvuk-desktop";
pub const ARG_PLAY_FLOW: &str = "--taskbar-play-flow";
pub const ARG_PLAY_FAVOURITES: &str = "--taskbar-play-favourites";

// PKEY_Title = {F29F85E0-4FF9-1068-AB91-08002B27B3D9}, pid 2
const PKEY_TITLE: PROPERTYKEY = PROPERTYKEY {
    fmtid: WinGUID::from_u128(0xF29F85E0_4FF9_1068_AB91_08002B27B3D9),
    pid: 2,
};

pub fn set_process_app_user_model_id() {
    unsafe {
        if let Err(err) = SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(APP_USER_MODEL_ID)) {
            log::warn!("[Taskbar] SetCurrentProcessExplicitAppUserModelID failed: {err}");
        }
    }
}

pub fn parse_taskbar_action_from_args<I, S>(args: I) -> Option<&'static str>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    for arg in args {
        match arg.as_ref() {
            ARG_PLAY_FLOW => return Some("play-flow"),
            ARG_PLAY_FAVOURITES => return Some("play-favourites"),
            _ => {}
        }
    }
    None
}

fn init_jump_list_async() {
    std::thread::spawn(|| {
        if let Err(err) = register_jump_list() {
            log::warn!("[Taskbar] Failed to register Jump List tasks: {err}");
        } else {
            log::info!("[Taskbar] Jump List tasks registered successfully");
        }
    });
}

fn app_data_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("Zvuk Desktop")
}

/// Render a 32x32 32-bit BGRA `.ico` file using 3x3 supersampling for smooth edges.
fn build_rgba_ico<F>(pixel_fn: F) -> Vec<u8>
where
    F: Fn(f64, f64) -> Option<[u8; 4]>, // returns [B, G, R, A]
{
    const W: usize = 32;
    const H: usize = 32;
    const AND_ROW_BYTES: usize = 4; // ((32 + 31) / 32) * 4
    const HEADER_SIZE: usize = 6 + 16;
    const BITMAP_HEADER_SIZE: usize = 40;
    const XOR_SIZE: usize = W * H * 4;
    const AND_SIZE: usize = H * AND_ROW_BYTES;
    const IMAGE_SIZE: usize = BITMAP_HEADER_SIZE + XOR_SIZE + AND_SIZE;

    let mut out = Vec::with_capacity(HEADER_SIZE + IMAGE_SIZE);

    // ICONDIR
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved
    out.extend_from_slice(&1u16.to_le_bytes()); // type = icon
    out.extend_from_slice(&1u16.to_le_bytes()); // count = 1

    // ICONDIRENTRY
    out.push(W as u8);
    out.push(H as u8);
    out.push(0); // color count
    out.push(0); // reserved
    out.extend_from_slice(&1u16.to_le_bytes()); // planes
    out.extend_from_slice(&32u16.to_le_bytes()); // bpp
    out.extend_from_slice(&(IMAGE_SIZE as u32).to_le_bytes());
    out.extend_from_slice(&(HEADER_SIZE as u32).to_le_bytes());

    // BITMAPINFOHEADER (biHeight = 2 * H for XOR + AND masks in ICO format)
    out.extend_from_slice(&(BITMAP_HEADER_SIZE as u32).to_le_bytes());
    out.extend_from_slice(&(W as i32).to_le_bytes());
    out.extend_from_slice(&((H as i32) * 2).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // planes
    out.extend_from_slice(&32u16.to_le_bytes()); // bpp
    out.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    out.extend_from_slice(&(XOR_SIZE as u32).to_le_bytes());
    out.extend_from_slice(&0i32.to_le_bytes()); // x ppm
    out.extend_from_slice(&0i32.to_le_bytes()); // y ppm
    out.extend_from_slice(&0u32.to_le_bytes()); // clr used
    out.extend_from_slice(&0u32.to_le_bytes()); // clr important

    // XOR mask: bottom-up rows
    for row in (0..H).rev() {
        for col in 0..W {
            let mut sum_b = 0.0f64;
            let mut sum_g = 0.0f64;
            let mut sum_r = 0.0f64;
            let mut sum_a = 0.0f64;
            for sy in 0..3 {
                for sx in 0..3 {
                    let px = col as f64 + (sx as f64 + 0.5) / 3.0;
                    let py = row as f64 + (sy as f64 + 0.5) / 3.0;
                    if let Some([b, g, r, a]) = pixel_fn(px, py) {
                        let af = a as f64 / 255.0;
                        sum_b += b as f64 * af;
                        sum_g += g as f64 * af;
                        sum_r += r as f64 * af;
                        sum_a += af;
                    }
                }
            }
            if sum_a > 0.0 {
                let b = (sum_b / sum_a).round().clamp(0.0, 255.0) as u8;
                let g = (sum_g / sum_a).round().clamp(0.0, 255.0) as u8;
                let r = (sum_r / sum_a).round().clamp(0.0, 255.0) as u8;
                let a = ((sum_a / 9.0) * 255.0).round().clamp(0.0, 255.0) as u8;
                out.extend_from_slice(&[b, g, r, a]);
            } else {
                out.extend_from_slice(&[0, 0, 0, 0]);
            }
        }
    }

    // AND mask (all zero; alpha channel controls transparency)
    out.resize(HEADER_SIZE + IMAGE_SIZE, 0);
    out
}

fn read_personalize_dword(value_name: &windows::core::PCWSTR) -> Option<u32> {
    let mut data: u32 = 0;
    let mut size: u32 = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            *value_name,
            RRF_RT_REG_DWORD,
            None,
            Some(&mut data as *mut u32 as *mut c_void),
            Some(&mut size),
        )
    };
    if status.is_ok() {
        Some(data)
    } else {
        None
    }
}

/// Returns true when the Windows shell / Jump List uses a light background.
fn is_system_light_theme() -> bool {
    if let Some(sys_light) = read_personalize_dword(&w!("SystemUsesLightTheme")) {
        return sys_light != 0;
    }
    if let Some(apps_light) = read_personalize_dword(&w!("AppsUseLightTheme")) {
        return apps_light != 0;
    }
    false
}

/// Signed-distance helper for an arc of radius `r` spanning ±45° horizontally (centered at origin).
fn is_in_radio_arc(abs_dx: f64, abs_dy: f64, radius: f64, half_stroke: f64) -> bool {
    if abs_dx >= abs_dy {
        (abs_dx.hypot(abs_dy) - radius).abs() <= half_stroke
    } else {
        let cap = radius * std::f64::consts::FRAC_1_SQRT_2;
        (abs_dx - cap).hypot(abs_dy - cap) <= half_stroke
    }
}

fn ensure_task_icons(dir: &Path, is_light_theme: bool) -> (Option<PathBuf>, Option<PathBuf>) {
    let _ = std::fs::create_dir_all(dir);

    // Clean up legacy unthemed icon filenames if present
    let _ = std::fs::remove_file(dir.join("task_flow.ico"));
    let _ = std::fs::remove_file(dir.join("task_favourites.ico"));

    // Black foreground on light system palette, white foreground on dark system palette
    let fg: [u8; 4] = if is_light_theme {
        [0, 0, 0, 255]
    } else {
        [255, 255, 255, 255]
    };
    let suffix = if is_light_theme { "black" } else { "white" };

    // "Мой поток" icon: center dot + left & right radio waves
    let flow_path = dir.join(format!("task_flow_{suffix}.ico"));
    let flow_bytes = build_rgba_ico(|x, y| {
        let dx = (x - 16.0).abs();
        let dy = (y - 16.0).abs();
        if dx * dx + dy * dy <= 2.9 * 2.9
            || is_in_radio_arc(dx, dy, 7.4, 1.25)
            || is_in_radio_arc(dx, dy, 12.2, 1.25)
        {
            Some(fg)
        } else {
            None
        }
    });
    let flow_ok = std::fs::write(&flow_path, flow_bytes).is_ok();

    // "Любимое" icon: solid heart
    let fav_path = dir.join(format!("task_favourites_{suffix}.ico"));
    let fav_bytes = build_rgba_ico(|x, y| {
        let nx = (x - 16.0) / 10.5;
        let ny = -(y - 17.0) / 10.5;
        let a = nx * nx + ny * ny - 1.0;
        if a * a * a - nx * nx * ny * ny * ny <= 0.0 {
            Some(fg)
        } else {
            None
        }
    });
    let fav_ok = std::fs::write(&fav_path, fav_bytes).is_ok();

    (
        if flow_ok { Some(flow_path) } else { None },
        if fav_ok { Some(fav_path) } else { None },
    )
}

unsafe fn create_jump_list_task(
    exe_path: &Path,
    working_dir: Option<&Path>,
    args: &str,
    title: &str,
    description: &str,
    icon_path: Option<&Path>,
) -> windows::core::Result<IShellLinkW> {
    let link: IShellLinkW = WinCoCreateInstance(&ShellLink, None, WIN_CLSCTX_INPROC_SERVER)?;
    link.SetPath(&HSTRING::from(exe_path.as_os_str()))?;
    if let Some(dir) = working_dir {
        link.SetWorkingDirectory(&HSTRING::from(dir.as_os_str()))?;
    }
    link.SetArguments(&HSTRING::from(args))?;
    link.SetDescription(&HSTRING::from(description))?;

    let resolved_icon = icon_path.unwrap_or(exe_path);
    link.SetIconLocation(&HSTRING::from(resolved_icon.as_os_str()), 0)?;

    let prop_store: IPropertyStore = link.cast()?;
    let prop_val = PROPVARIANT::from(title);
    prop_store.SetValue(&PKEY_TITLE, &prop_val)?;
    prop_store.Commit()?;

    Ok(link)
}

fn register_jump_list() -> windows::core::Result<()> {
    let exe_path = std::env::current_exe().map_err(|e| {
        windows::core::Error::new(windows::core::HRESULT(-1), format!("current_exe failed: {e}"))
    })?;
    let working_dir = exe_path.parent();
    let is_light_theme = is_system_light_theme();
    LAST_JUMP_LIST_LIGHT_THEME.store(is_light_theme, Ordering::SeqCst);
    let (flow_icon, fav_icon) = ensure_task_icons(&app_data_dir(), is_light_theme);

    unsafe {
        let co_init_hr = WinCoInitializeEx(None, WIN_COINIT_APARTMENTTHREADED);
        let should_uninit = co_init_hr.is_ok();

        let result = (|| -> windows::core::Result<()> {
            let dest_list: ICustomDestinationList =
                WinCoCreateInstance(&DestinationList, None, WIN_CLSCTX_INPROC_SERVER)?;
            dest_list.SetAppID(&HSTRING::from(APP_USER_MODEL_ID))?;

            let mut max_slots: u32 = 0;
            let _removed: IObjectArray = dest_list.BeginList(&mut max_slots)?;

            let collection: IObjectCollection =
                WinCoCreateInstance(&EnumerableObjectCollection, None, WIN_CLSCTX_INPROC_SERVER)?;

            let flow_task = create_jump_list_task(
                &exe_path,
                working_dir,
                ARG_PLAY_FLOW,
                "Включить Мой поток",
                "Запустить персональный поток рекомендаций",
                flow_icon.as_deref(),
            )?;
            collection.AddObject(&flow_task)?;

            let fav_task = create_jump_list_task(
                &exe_path,
                working_dir,
                ARG_PLAY_FAVOURITES,
                "Включить Любимое",
                "Воспроизвести любимые треки",
                fav_icon.as_deref(),
            )?;
            collection.AddObject(&fav_task)?;

            let task_array: IObjectArray = collection.cast()?;
            dest_list.AddUserTasks(&task_array)?;
            dest_list.CommitList()?;
            Ok(())
        })();

        if should_uninit {
            CoUninitialize();
        }
        result
    }
}

fn update_buttons_internal(
    hwnd: HWND,
    taskbar: *mut ITaskbarList3,
    is_playing: bool,
    can_prev: bool,
    can_next: bool,
) {
    *LAST_STATE.lock().unwrap() = (is_playing, can_prev, can_next);

    let icons_guard = TASKBAR_ICONS.lock().unwrap();
    let icons = match icons_guard.as_ref() {
        Some(i) => i,
        None => return,
    };

    let play_pause_icon = if is_playing {
        icons.pause
    } else {
        icons.play
    };
    let play_pause_tip = if is_playing {
        encode_wide("Пауза")
    } else {
        encode_wide("Воспроизведение")
    };

    let buttons = [
        THUMBBUTTON {
            dwMask: THB_FLAGS | THB_ICON | THB_TOOLTIP,
            iId: ID_PREV,
            iBitmap: 0,
            hIcon: icons.prev,
            szTip: encode_wide("Предыдущий трек"),
            dwFlags: if can_prev { THBF_ENABLED } else { THBF_DISABLED },
        },
        THUMBBUTTON {
            dwMask: THB_FLAGS | THB_ICON | THB_TOOLTIP,
            iId: ID_PLAY_PAUSE,
            iBitmap: 0,
            hIcon: play_pause_icon,
            szTip: play_pause_tip,
            dwFlags: THBF_ENABLED,
        },
        THUMBBUTTON {
            dwMask: THB_FLAGS | THB_ICON | THB_TOOLTIP,
            iId: ID_NEXT,
            iBitmap: 0,
            hIcon: icons.next,
            szTip: encode_wide("Следующий трек"),
            dwFlags: if can_next { THBF_ENABLED } else { THBF_DISABLED },
        },
    ];

    unsafe {
        let vtbl = (*taskbar).lpVtbl.as_ref().unwrap();
        if !BUTTONS_INITIALIZED.load(Ordering::SeqCst) {
            let hr = (vtbl.ThumbBarAddButtons)(taskbar as _, hwnd, buttons.len() as u32, buttons.as_ptr());
            if hr == 0 {
                BUTTONS_INITIALIZED.store(true, Ordering::SeqCst);
                log::info!("[Taskbar] Thumbnail toolbar buttons added successfully");
            } else {
                log::debug!("[Taskbar] ThumbBarAddButtons returned 0x{:X} (will retry on TaskbarButtonCreated)", hr);
            }
        } else {
            let hr = (vtbl.ThumbBarUpdateButtons)(taskbar as _, hwnd, buttons.len() as u32, buttons.as_ptr());
            if hr != 0 {
                log::warn!("[Taskbar] ThumbBarUpdateButtons returned 0x{:X}", hr);
            }
        }
    }
}

pub fn update_taskbar_playback(is_playing: bool, can_prev: bool, can_next: bool) {
    let hwnd_guard = GLOBAL_HWND.lock().unwrap();
    let hwnd = match *hwnd_guard {
        Some(h) => h.0 as HWND,
        None => return,
    };

    let taskbar_guard = TASKBAR_LIST.lock().unwrap();
    let taskbar = match *taskbar_guard {
        Some(t) => t.0,
        None => return,
    };

    update_buttons_internal(hwnd, taskbar, is_playing, can_prev, can_next);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_taskbar_actions_from_args() {
        assert_eq!(
            parse_taskbar_action_from_args(["zvuk-desktop.exe", ARG_PLAY_FLOW]),
            Some("play-flow")
        );
        assert_eq!(
            parse_taskbar_action_from_args(["zvuk-desktop.exe", ARG_PLAY_FAVOURITES]),
            Some("play-favourites")
        );
        assert_eq!(
            parse_taskbar_action_from_args(["zvuk-desktop.exe", "--other"]),
            None
        );
    }

    #[test]
    fn builds_valid_32x32_ico() {
        let bytes = build_rgba_ico(|_, _| Some([0, 255, 0, 255]));
        // 6 (ICONDIR) + 16 (ICONDIRENTRY) + 40 (BITMAPINFOHEADER) + 32*32*4 (XOR) + 32*4 (AND)
        assert_eq!(bytes.len(), 6 + 16 + 40 + 4096 + 128);
        assert_eq!(&bytes[0..6], &[0, 0, 1, 0, 1, 0]);
        assert_eq!(bytes[6], 32);
        assert_eq!(bytes[7], 32);
    }

    #[test]
    fn radio_wave_arcs_match_expected_regions() {
        assert!(is_in_radio_arc(7.4, 0.0, 7.4, 1.25));
        assert!(is_in_radio_arc(12.2, 0.0, 12.2, 1.25));
        // Outside ±45° cone (above/below center dot) should not match
        assert!(!is_in_radio_arc(0.0, 7.4, 7.4, 1.25));
        assert!(!is_in_radio_arc(0.0, 12.2, 12.2, 1.25));
    }
}
