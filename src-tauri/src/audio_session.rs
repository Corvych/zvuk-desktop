/// Sets the Windows audio session display name so the app appears as "Zvuk Desktop"
/// in the Windows Volume Mixer instead of "Edge WebView" (the default for WebView2).
///
/// The key challenge: WebView2 (used by Tauri) spawns child processes for rendering,
/// GPU work, etc. Audio is played by those child processes (e.g. msedgewebview2.exe
/// --type=renderer), NOT by our main process. So we must walk the full process tree
/// rooted at our PID and rename every audio session belonging to any descendant.
///
/// Because the audio session is created lazily (only when playback starts), we retry
/// in a background thread until we find and rename at least one session.
#[cfg(windows)]
pub mod windows_audio {
    use std::collections::{HashMap, HashSet, VecDeque};

    use windows::core::{Interface, HSTRING};
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioSessionControl, IAudioSessionControl2, IAudioSessionManager2,
        IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    /// Build the set of all PIDs in the process subtree rooted at `root_pid` (inclusive).
    /// WebView2 spawns browser + renderer + GPU child processes, so we walk all descendants.
    fn get_subtree_pids(root_pid: u32) -> HashSet<u32> {
        let mut result = HashSet::new();
        result.insert(root_pid);

        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                log::warn!("[AudioSession] CreateToolhelp32Snapshot failed");
                return result;
            }

            let mut pe: PROCESSENTRY32W = std::mem::zeroed();
            pe.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

            // Build parent -> children map from the snapshot
            let mut parent_map: HashMap<u32, Vec<u32>> = HashMap::new();
            if Process32FirstW(snapshot, &mut pe) != 0 {
                loop {
                    parent_map
                        .entry(pe.th32ParentProcessID)
                        .or_default()
                        .push(pe.th32ProcessID);

                    if Process32NextW(snapshot, &mut pe) == 0 {
                        break;
                    }
                }
            }

            CloseHandle(snapshot);

            // BFS from root_pid to collect all descendants
            let mut queue = VecDeque::new();
            queue.push_back(root_pid);
            while let Some(pid) = queue.pop_front() {
                if let Some(children) = parent_map.get(&pid) {
                    for &child in children {
                        if result.insert(child) {
                            queue.push_back(child);
                        }
                    }
                }
            }
        }

        log::debug!("[AudioSession] Process subtree PIDs: {:?}", result);
        result
    }

    /// Try to rename all audio sessions belonging to our process subtree.
    /// Returns true if at least one session was successfully renamed.
    unsafe fn try_set_display_name(name: &str) -> bool {
        let name_hstr = HSTRING::from(name);

        let enumerator: IMMDeviceEnumerator =
            match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                Ok(e) => e,
                Err(e) => {
                    log::warn!("[AudioSession] CoCreateInstance(IMMDeviceEnumerator) failed: {e}");
                    return false;
                }
            };

        let device = match enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
            Ok(d) => d,
            Err(e) => {
                log::warn!("[AudioSession] GetDefaultAudioEndpoint failed: {e}");
                return false;
            }
        };

        let session_manager: IAudioSessionManager2 = match device.Activate(CLSCTX_ALL, None) {
            Ok(sm) => sm,
            Err(e) => {
                log::warn!("[AudioSession] Activate(IAudioSessionManager2) failed: {e}");
                return false;
            }
        };

        let session_enumerator = match session_manager.GetSessionEnumerator() {
            Ok(se) => se,
            Err(e) => {
                log::warn!("[AudioSession] GetSessionEnumerator failed: {e}");
                return false;
            }
        };

        let count = match session_enumerator.GetCount() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[AudioSession] GetCount failed: {e}");
                return false;
            }
        };

        // Build our process subtree once per attempt
        let our_pids = get_subtree_pids(std::process::id());
        log::debug!("[AudioSession] Total active sessions: {count}, our subtree: {} pids", our_pids.len());

        let mut renamed = false;

        for i in 0..count {
            let session = match session_enumerator.GetSession(i) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let control2: IAudioSessionControl2 = match session.cast() {
                Ok(c) => c,
                Err(_) => continue,
            };

            let pid = match control2.GetProcessId() {
                Ok(p) => p,
                Err(_) => continue,
            };

            if our_pids.contains(&pid) {
                match control2.SetDisplayName(&name_hstr, std::ptr::null()) {
                    Ok(_) => {
                        log::info!(
                            "[AudioSession] Renamed session {i} (pid={pid}) to '{name}'"
                        );
                        renamed = true;
                    }
                    Err(e) => {
                        log::warn!("[AudioSession] SetDisplayName failed for session {i}: {e}");
                    }
                }

                // Also set the icon to our executable (which has the app icon embedded by Tauri)
                if let Ok(exe_path) = std::env::current_exe() {
                    let icon_hstr = HSTRING::from(exe_path.as_os_str());
                    if let Ok(control) = control2.cast::<IAudioSessionControl>() {
                        let _ = control.SetIconPath(&icon_hstr, std::ptr::null());
                    }
                }
            }
        }

        renamed
    }

    /// Spawns a background thread that retries setting the audio session display name
    /// every second until it succeeds (max ~60 attempts / 60 seconds).
    pub fn set_audio_session_name_async(name: &'static str) {
        std::thread::spawn(move || {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }

            for attempt in 0..60 {
                if unsafe { try_set_display_name(name) } {
                    // Keep re-applying every 5s in case new WebView2 processes spawn
                    // (e.g. after navigation) and create new audio sessions
                    loop {
                        std::thread::sleep(std::time::Duration::from_secs(5));
                        unsafe { try_set_display_name(name) };
                    }
                }
                log::debug!(
                    "[AudioSession] No matching session yet (attempt {attempt}), retrying in 1s..."
                );
                std::thread::sleep(std::time::Duration::from_secs(1));
            }

            log::warn!("[AudioSession] Could not find any audio session after 60 attempts.");
        });
    }
}
