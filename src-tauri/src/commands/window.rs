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
