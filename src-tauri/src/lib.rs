mod api_client;
mod commands;
mod discord_rpc;
mod error;
mod models;
mod state;
mod token_manager;

use state::AppState;
use tauri::{Emitter, Manager};

pub use commands::settings::apply_cache_browser_args;

#[tauri::command]
fn get_cli_args() -> Vec<String> {
    std::env::args().collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    commands::settings::apply_cache_browser_args();

    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            log::info!("Single instance triggered with args: {:?}", argv);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = app.emit("deep-link-received", argv);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    let _ = window.set_icon(icon.clone());
                }
            }
            commands::auth::start_global_auth_listener(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_cli_args,
            // Window controls
            commands::window::window_minimize,
            commands::window::window_toggle_maximize,
            commands::window::window_close,
            commands::window::window_start_dragging,
            // Auth & Sber ID
            commands::auth::login_with_token,
            commands::auth::open_sber_id_login,
            commands::auth::open_browser_login,
            commands::auth::close_sberid_window,
            commands::auth::check_auth_status,
            commands::auth::get_subscription,
            commands::auth::logout,
            // Tracks & Artists
            commands::tracks::get_track,
            commands::tracks::get_tracks_by_ids,
            commands::tracks::get_album,
            commands::tracks::get_artist,
            commands::tracks::get_artist_releases,
            commands::tracks::get_stream_url,
            commands::tracks::get_lyrics,

            // Search
            commands::search::search,
            commands::search::autocomplete,
            // Playlists
            commands::playlists::get_playlist,
            commands::playlists::get_user_playlists,
            commands::playlists::get_user_short_playlists,
            commands::playlists::add_items_to_playlist,
            commands::playlists::update_playlist,
            commands::playlists::get_editorial_playlists,
            commands::playlists::create_playlist,
            commands::playlists::delete_playlist,
            commands::playlists::add_track_to_playlist,
            commands::playlists::remove_track_from_playlist,
            // Favourites
            commands::favourites::get_liked_tracks,
            commands::favourites::get_liked_track_ids,
            commands::favourites::get_liked_album_ids,
            commands::favourites::get_liked_albums,
            commands::favourites::like_track,
            commands::favourites::unlike_track,
            commands::favourites::like_album,
            commands::favourites::unlike_album,
            commands::favourites::get_liked_artist_ids,
            commands::favourites::like_artist,
            commands::favourites::unlike_artist,
            // Recommendations / Sound Energy / Personal Wave
            commands::recommendations::get_personal_wave,
            commands::recommendations::get_artist_radio,
            commands::recommendations::get_flow,
            commands::recommendations::tune_flow,
            commands::recommendations::get_music_recommendations,
            commands::recommendations::get_listening_history,
            // Settings
            commands::settings::get_cache_limit_mb,
            commands::settings::set_cache_limit_mb,
            // Discord RPC
            commands::discord::get_discord_settings,
            commands::discord::set_discord_settings,
            commands::discord::update_discord_activity,
            commands::discord::get_discord_status,
        ])

        .run(tauri::generate_context!())
        .expect("error while running zvuk-desktop");
}
