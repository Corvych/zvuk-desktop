use crate::error::AppError;
use crate::models::{CollectionPage, CreatePlaylistRequest, Playlist};
use crate::state::AppState;
use tauri::State;

/// Get a specific playlist by ID.
#[tauri::command]
pub async fn get_playlist(
    id: i64,
    state: State<'_, AppState>,
) -> Result<Playlist, AppError> {
    state.api_client.get_playlist(id).await
}

/// Get the user's playlist collection (paginated).
#[tauri::command]
pub async fn get_user_playlists(
    offset: u32,
    limit: u32,
    state: State<'_, AppState>,
) -> Result<CollectionPage<Playlist>, AppError> {
    state.api_client.get_user_playlists(offset, limit).await
}

/// Get curated/editorial playlists from Zvuk for explore/home page.
#[tauri::command]
pub async fn get_editorial_playlists(
    state: State<'_, AppState>,
) -> Result<Vec<Playlist>, AppError> {
    state.api_client.get_editorial_playlists().await
}


/// Create a new playlist.
#[tauri::command]
pub async fn create_playlist(
    title: String,
    description: Option<String>,
    state: State<'_, AppState>,
) -> Result<Playlist, AppError> {
    let req = CreatePlaylistRequest { title, description };
    state.api_client.create_playlist(&req).await
}

/// Delete a user-owned playlist.
#[tauri::command]
pub async fn delete_playlist(
    id: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.api_client.delete_playlist(id).await
}

/// Add a track to a playlist.
#[tauri::command]
pub async fn add_track_to_playlist(
    playlist_id: i64,
    track_id: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.api_client.add_track_to_playlist(playlist_id, track_id).await
}

/// Remove a track from a playlist.
#[tauri::command]
pub async fn remove_track_from_playlist(
    playlist_id: i64,
    track_id: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.api_client.remove_track_from_playlist(playlist_id, track_id).await
}
