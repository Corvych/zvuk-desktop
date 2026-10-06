use crate::error::AppError;
use crate::models::{
    ArtistRadioResult, FlowState, ListeningHistoryItem, MusicRecommendationItem,
    PersonalWaveContentInput, PersonalWaveOptions, Track, TunerSettings,
};
use crate::state::AppState;
use tauri::State;

/// Start or continue the Personal Wave (Сила Звука).
/// Pass content_input when switching/skipping tracks to report metrics.
#[tauri::command]
pub async fn get_personal_wave(
    content_input: Option<PersonalWaveContentInput>,
    first: Option<u32>,
    options: Option<PersonalWaveOptions>,
    wave_src: Option<String>,
    wave_type: Option<String>,
    wave_input: Option<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<Vec<Track>, AppError> {
    state
        .api_client
        .get_personal_wave(
            content_input,
            first,
            options,
            wave_src,
            wave_type,
            wave_input,
        )
        .await
}

/// Fetch artist radio stream ("Поток по артисту / В стиле [артист]").
#[tauri::command]
pub async fn get_artist_radio(
    artist_id: String,
    cursor: Option<u32>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<ArtistRadioResult, AppError> {
    state
        .api_client
        .get_artist_radio(&artist_id, cursor, limit)
        .await
}

/// Start or continue the Sound Energy flow.
/// Pass session_id from a previous call to continue the same flow.
#[tauri::command]
pub async fn get_flow(
    session_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<FlowState, AppError> {
    state.api_client.get_flow(session_id.as_deref()).await
}

/// Adjust the Sound Energy tuner settings.
/// The flow will be updated to match the new tuner position.
#[tauri::command]
pub async fn tune_flow(
    session_id: String,
    energy: f32,
    discovery: f32,
    mood: f32,
    popularity: f32,
    state: State<'_, AppState>,
) -> Result<FlowState, AppError> {
    let settings = TunerSettings {
        energy,
        discovery,
        mood,
        popularity,
    };
    state.api_client.tune_flow(&session_id, &settings).await
}

/// Fetch dynamic block music recommendations ("Рекомендуем послушать").
#[tauri::command]
pub async fn get_music_recommendations(
    limit: Option<u32>,
    offset: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<MusicRecommendationItem>, AppError> {
    state.api_client.get_music_recommendations(limit, offset).await
}

/// Fetch user listening history ("История прослушиваний").
#[tauri::command]
pub async fn get_listening_history(
    limit: Option<u32>,
    offset: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<ListeningHistoryItem>, AppError> {
    state.api_client.get_listening_history(limit, offset).await
}

