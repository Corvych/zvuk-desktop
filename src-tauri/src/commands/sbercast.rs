use std::sync::Arc;
use tauri::State;
use crate::sbercast::{SberCastManager, SberCastStatus, SberDevice};

#[tauri::command]
pub async fn sbercast_discover_devices(
    manager: State<'_, Arc<SberCastManager>>,
) -> Result<Vec<SberDevice>, String> {
    Ok(manager.discover_devices().await)
}

#[tauri::command]
pub async fn sbercast_add_manual_device(
    manager: State<'_, Arc<SberCastManager>>,
    host: String,
    port: Option<u16>,
) -> Result<SberDevice, String> {
    manager.add_manual_device(&host, port.unwrap_or(20000)).await
}

#[tauri::command]
pub async fn sbercast_pair_device(
    manager: State<'_, Arc<SberCastManager>>,
    host: String,
    port: Option<u16>,
    name: Option<String>,
) -> Result<SberDevice, String> {
    manager.pair_device(&host, port.unwrap_or(20000), name).await
}

#[tauri::command]
pub async fn sbercast_connect_device(
    manager: State<'_, Arc<SberCastManager>>,
    device: SberDevice,
) -> Result<(), String> {
    manager.connect_device(device).await
}

#[tauri::command]
pub async fn sbercast_disconnect(
    manager: State<'_, Arc<SberCastManager>>,
) -> Result<(), String> {
    manager.disconnect().await;
    Ok(())
}

#[tauri::command]
pub async fn sbercast_get_status(
    manager: State<'_, Arc<SberCastManager>>,
) -> Result<SberCastStatus, String> {
    Ok(manager.get_status().await)
}

#[tauri::command]
pub async fn sbercast_get_saved_devices(
    manager: State<'_, Arc<SberCastManager>>,
) -> Result<Vec<SberDevice>, String> {
    Ok(manager.get_saved_devices().await)
}

#[tauri::command]
pub async fn sbercast_remove_saved_device(
    manager: State<'_, Arc<SberCastManager>>,
    id: String,
) -> Result<(), String> {
    manager.remove_device(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn sbercast_play_deeplink(
    manager: State<'_, Arc<SberCastManager>>,
    deeplink: String,
) -> Result<(), String> {
    manager.play_deeplink(&deeplink).await
}

#[tauri::command]
pub async fn sbercast_play_track(
    manager: State<'_, Arc<SberCastManager>>,
    track_id: String,
) -> Result<(), String> {
    manager.play_track(&track_id).await
}

#[tauri::command]
pub async fn sbercast_play_playlist(
    manager: State<'_, Arc<SberCastManager>>,
    playlist_id: String,
) -> Result<(), String> {
    manager.play_playlist(&playlist_id).await
}

#[tauri::command]
pub async fn sbercast_play_artist(
    manager: State<'_, Arc<SberCastManager>>,
    artist_id: String,
) -> Result<(), String> {
    manager.play_artist(&artist_id).await
}

#[tauri::command]
pub async fn sbercast_play_release(
    manager: State<'_, Arc<SberCastManager>>,
    release_id: String,
) -> Result<(), String> {
    manager.play_release(&release_id).await
}

#[tauri::command]
pub async fn sbercast_media_play(
    manager: State<'_, Arc<SberCastManager>>,
) -> Result<(), String> {
    manager.media_play().await
}

#[tauri::command]
pub async fn sbercast_media_pause(
    manager: State<'_, Arc<SberCastManager>>,
) -> Result<(), String> {
    manager.media_pause().await
}

#[tauri::command]
pub async fn sbercast_media_next(
    manager: State<'_, Arc<SberCastManager>>,
) -> Result<(), String> {
    manager.media_next().await
}

#[tauri::command]
pub async fn sbercast_media_prev(
    manager: State<'_, Arc<SberCastManager>>,
) -> Result<(), String> {
    manager.media_prev().await
}

#[tauri::command]
pub async fn sbercast_media_like(
    manager: State<'_, Arc<SberCastManager>>,
) -> Result<(), String> {
    manager.media_like().await
}

#[tauri::command]
pub async fn sbercast_media_dislike(
    manager: State<'_, Arc<SberCastManager>>,
) -> Result<(), String> {
    manager.media_dislike().await
}

#[tauri::command]
pub async fn sbercast_media_shuffle(
    manager: State<'_, Arc<SberCastManager>>,
    on: bool,
) -> Result<(), String> {
    manager.media_shuffle(on).await
}

#[tauri::command]
pub async fn sbercast_media_repeat(
    manager: State<'_, Arc<SberCastManager>>,
    mode: String,
) -> Result<(), String> {
    manager.media_repeat(&mode).await
}

#[tauri::command]
pub async fn sbercast_set_volume(
    manager: State<'_, Arc<SberCastManager>>,
    percent: u32,
) -> Result<(), String> {
    manager.set_volume(percent).await
}

#[tauri::command]
pub async fn sbercast_seek(
    manager: State<'_, Arc<SberCastManager>>,
    seconds: u64,
) -> Result<(), String> {
    manager.seek(seconds).await
}
