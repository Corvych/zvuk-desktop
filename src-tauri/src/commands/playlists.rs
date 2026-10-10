use crate::error::AppError;
use crate::models::{
    CollectionPage, CreatePlaylistRequest, PlaylistItemInput, Playlist, ShortPlaylistsResult,
};
use crate::state::AppState;
use tauri::State;

/// Get a specific playlist by ID.
#[tauri::command]
pub async fn get_playlist(
    id: i64,
    state: State<'_, AppState>,
) -> Result<Playlist, AppError> {
    let mut playlist = state.api_client.get_playlist(id).await?;
    let cur_user_id = {
        let guard = state.current_user.lock().unwrap();
        guard.as_ref().map(|u| u.id.to_string())
    };
    if let (Some(ref cur_id), Some(ref owner_id)) = (&cur_user_id, &playlist.owner) {
        if cur_id == owner_id {
            playlist.is_editable = true;
        }
    }
    Ok(playlist)
}

/// Get the user's playlist collection (paginated).
#[tauri::command]
pub async fn get_user_playlists(
    offset: u32,
    limit: u32,
    state: State<'_, AppState>,
) -> Result<CollectionPage<Playlist>, AppError> {
    let mut page = state.api_client.get_user_playlists(offset, limit).await?;
    let cur_user_id = {
        let guard = state.current_user.lock().unwrap();
        guard.as_ref().map(|u| u.id.to_string())
    };
    for item in &mut page.items {
        if let (Some(ref cur_id), Some(ref owner_id)) = (&cur_user_id, &item.owner) {
            if cur_id == owner_id {
                item.is_editable = true;
            }
        }
    }
    Ok(page)
}

/// Get short info of user playlists with cursor pagination (for add to playlist dialog).
#[tauri::command]
pub async fn get_user_short_playlists(
    limit: Option<u32>,
    offset: Option<String>,
    state: State<'_, AppState>,
) -> Result<ShortPlaylistsResult, AppError> {
    state
        .api_client
        .get_user_short_playlists(limit.unwrap_or(20), offset)
        .await
}

/// Add items (tracks) to a playlist.
#[tauri::command]
pub async fn add_items_to_playlist(
    id: String,
    items: Vec<PlaylistItemInput>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.api_client.add_items_to_playlist(&id, items).await
}

/// Update a playlist's tracks, name, and visibility (can reorder or remove tracks).
#[tauri::command]
pub async fn update_playlist(
    id: String,
    name: String,
    is_public: bool,
    items: Vec<PlaylistItemInput>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .api_client
        .update_playlist(&id, &name, is_public, items)
        .await
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
    let mut pl = state.api_client.create_playlist(&req).await?;
    pl.is_editable = true;
    let cur_user_id = {
        let guard = state.current_user.lock().unwrap();
        guard.as_ref().map(|u| u.id.to_string())
    };
    pl.owner = cur_user_id;
    Ok(pl)
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
