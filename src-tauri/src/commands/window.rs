#[tauri::command]
pub async fn window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
pub async fn window_toggle_maximize(window: tauri::Window) {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
pub async fn window_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
pub async fn window_start_dragging(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[tauri::command]
pub async fn update_taskbar_playback(is_playing: bool, can_prev: bool, can_next: bool) {
    #[cfg(windows)]
    crate::taskbar::update_taskbar_playback(is_playing, can_prev, can_next);
    #[cfg(not(windows))]
    let _ = (is_playing, can_prev, can_next);
}

