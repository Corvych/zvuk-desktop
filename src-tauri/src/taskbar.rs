#![cfg(windows)]

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, WebviewWindow};
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
    CreateIconIndirect, RegisterWindowMessageW, HICON, ICONINFO, WM_COMMAND,
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
