use crate::error::AppError;
use crate::models::{Album, ArtistDetail, StreamInfo, Track};
use crate::state::AppState;
use tauri::State;

/// Get metadata for a specific track.
#[tauri::command]
pub async fn get_track(
    id: i64,
    state: State<'_, AppState>,
) -> Result<Track, AppError> {
    state.api_client.get_track(id).await
}

/// Get album metadata and tracks by ID.
#[tauri::command]
pub async fn get_album(
    id: i64,
    state: State<'_, AppState>,
) -> Result<Album, AppError> {
    state.api_client.get_album(id).await
}

/// Get artist metadata, popular tracks, and releases by ID.
#[tauri::command]
pub async fn get_artist(
    id: i64,
    state: State<'_, AppState>,
) -> Result<ArtistDetail, AppError> {
    state.api_client.get_artist(id).await
}

/// Resolve the stream URL for a track.
/// Quality can be: "low", "mid", "high", "flac"
#[tauri::command]
pub async fn get_stream_url(
    id: i64,
    quality: String,
    state: State<'_, AppState>,
) -> Result<StreamInfo, AppError> {
    state.api_client.get_stream_url(id, &quality).await
}

/// Get lyrics and synced subtitles for a track.
#[tauri::command]
pub async fn get_lyrics(
    id: i64,
    state: State<'_, AppState>,
) -> Result<Option<crate::models::LyricsInfo>, AppError> {
    state.api_client.get_lyrics(id).await
}



