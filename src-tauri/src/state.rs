use crate::api_client::ZvukApiClient;
use crate::discord_rpc::DiscordRpcManager;
use crate::models::UserProfile;
use std::sync::Mutex;

/// Application state managed by Tauri.
/// Shared across all IPC commands via `tauri::State<AppState>`.
pub struct AppState {
    pub api_client: ZvukApiClient,
    pub current_user: Mutex<Option<UserProfile>>,
    pub discord_rpc: DiscordRpcManager,
}

impl AppState {
    pub fn new() -> Self {
        let initial_settings = crate::commands::settings::get_saved_discord_settings();
        Self {
            api_client: ZvukApiClient::new(),
            current_user: Mutex::new(None),
            discord_rpc: DiscordRpcManager::new(initial_settings),
        }
    }
}
