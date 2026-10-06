use crate::error::AppError;
use crate::models::{AutocompleteResult, SearchResults};
use crate::state::AppState;
use tauri::State;

/// Full-text search across tracks, albums, artists, playlists.
#[tauri::command]
pub async fn search(
    query: String,
    state: State<'_, AppState>,
) -> Result<SearchResults, AppError> {
    state.api_client.search(&query).await
}

/// Quick autocomplete search for the search bar.
#[tauri::command]
pub async fn autocomplete(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<AutocompleteResult>, AppError> {
    state.api_client.autocomplete(&query).await
}
