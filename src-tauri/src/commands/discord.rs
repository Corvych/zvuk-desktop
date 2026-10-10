use crate::discord_rpc::{DiscordActivity, DiscordRpcSettings, DiscordStatus};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn get_discord_settings(state: State<'_, AppState>) -> Result<DiscordRpcSettings, String> {
    Ok(state.discord_rpc.get_settings().await)
}

#[tauri::command]
pub async fn set_discord_settings(
    settings: DiscordRpcSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Save to file
    crate::commands::settings::save_discord_settings_to_file(&settings)?;
    // Notify manager
    state.discord_rpc.update_settings(settings);
    Ok(())
}

#[tauri::command]
pub fn update_discord_activity(
    activity: Option<DiscordActivity>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.discord_rpc.update_activity(activity);
    Ok(())
}

#[tauri::command]
pub async fn get_discord_status(state: State<'_, AppState>) -> Result<DiscordStatus, String> {
    Ok(state.discord_rpc.get_status().await)
}
