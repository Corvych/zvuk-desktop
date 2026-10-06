use crate::api_client::ZvukApiClient;
use crate::models::UserProfile;
use std::sync::Mutex;

/// Application state managed by Tauri.
/// Shared across all IPC commands via `tauri::State<AppState>`.
pub struct AppState {
    pub api_client: ZvukApiClient,
    pub current_user: Mutex<Option<UserProfile>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            api_client: ZvukApiClient::new(),
            current_user: Mutex::new(None),
        }
    }
}
