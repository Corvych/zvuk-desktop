use crate::error::AppError;
use crate::models::{Album, CollectionPage, Track};
use crate::state::AppState;
use tauri::State;

/// Get the user's liked tracks (paginated).
#[tauri::command]
pub async fn get_liked_tracks(
    offset: u32,
    limit: u32,
    state: State<'_, AppState>,
) -> Result<CollectionPage<Track>, AppError> {
    state.api_client.get_liked_tracks(offset, limit).await
}

/// Get all liked track IDs for global heart state comparison.
#[tauri::command]
pub async fn get_liked_track_ids(
    state: State<'_, AppState>,
) -> Result<Vec<i64>, AppError> {
    state.api_client.get_liked_track_ids().await
}

/// Get all liked album IDs for global heart state comparison.
#[tauri::command]
pub async fn get_liked_album_ids(
    state: State<'_, AppState>,
) -> Result<Vec<i64>, AppError> {
    state.api_client.get_liked_album_ids().await
}

/// Get the user's liked albums (paginated).
#[tauri::command]
pub async fn get_liked_albums(
    offset: u32,
    limit: u32,
    state: State<'_, AppState>,
) -> Result<CollectionPage<Album>, AppError> {
    state.api_client.get_liked_albums(offset, limit).await
}

/// Like a track. Optimistic on the frontend, confirmed here.
#[tauri::command]
pub async fn like_track(
    track_id: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.api_client.like_track(track_id).await
}

/// Unlike a track.
#[tauri::command]
pub async fn unlike_track(
    track_id: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.api_client.unlike_track(track_id).await
}

/// Like an album.
#[tauri::command]
pub async fn like_album(
    album_id: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.api_client.like_album(album_id).await
}

/// Unlike an album.
#[tauri::command]
pub async fn unlike_album(
    album_id: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.api_client.unlike_album(album_id).await
}

/// Get all followed / subscribed artist IDs.
#[tauri::command]
pub async fn get_liked_artist_ids(
    state: State<'_, AppState>,
) -> Result<Vec<i64>, AppError> {
    state.api_client.get_liked_artist_ids().await
}

/// Follow / subscribe to an artist.
#[tauri::command]
pub async fn like_artist(
    artist_id: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.api_client.like_artist(artist_id).await
}

/// Unfollow / unsubscribe from an artist.
#[tauri::command]
pub async fn unlike_artist(
    artist_id: i64,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.api_client.unlike_artist(artist_id).await
}
