use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, RwLock};

#[cfg(target_os = "windows")]
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};

pub const DEFAULT_DISCORD_CLIENT_ID: &str = "1556060308911689789";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordRpcSettings {
    pub enabled: bool,
    pub client_id: String,
    pub show_buttons: bool,
    pub show_pause: bool,
}

impl Default for DiscordRpcSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            client_id: String::new(),
            show_buttons: true,
            show_pause: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordActivity {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub cover_url: Option<String>,
    pub duration: Option<f64>,
    pub position: Option<f64>,
    pub is_playing: bool,
    pub track_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordStatus {
    pub connected: bool,
    pub error: Option<String>,
}

enum IpcStream {
    #[cfg(target_os = "windows")]
    Windows(NamedPipeClient),
    #[cfg(not(target_os = "windows"))]
    Unix(tokio::net::UnixStream),
}

impl IpcStream {
    async fn read_exact(&mut self, buf: &mut [u8]) -> std::io::Result<()> {
        match self {
            #[cfg(target_os = "windows")]
            IpcStream::Windows(ref mut s) => {
                use tokio::io::AsyncReadExt;
                s.read_exact(buf).await.map(|_| ())
            }
            #[cfg(not(target_os = "windows"))]
            IpcStream::Unix(ref mut s) => {
                use tokio::io::AsyncReadExt;
                s.read_exact(buf).await.map(|_| ())
            }
        }
    }

    async fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        match self {
            #[cfg(target_os = "windows")]
            IpcStream::Windows(ref mut s) => {
                use tokio::io::AsyncWriteExt;
                s.write_all(buf).await
            }
            #[cfg(not(target_os = "windows"))]
            IpcStream::Unix(ref mut s) => {
                use tokio::io::AsyncWriteExt;
                s.write_all(buf).await
            }
        }
    }
}

async fn connect_to_discord() -> Option<IpcStream> {
    #[cfg(target_os = "windows")]
    {
        for i in 0..10 {
            let pipe_path = format!(r"\\.\pipe\discord-ipc-{}", i);
            if let Ok(client) = ClientOptions::new().open(&pipe_path) {
                log::info!("[Discord RPC] Connected to {}", pipe_path);
                return Some(IpcStream::Windows(client));
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let xdg = std::env::var("XDG_RUNTIME_DIR").unwrap_or_default();
        let tmp = std::env::var("TMPDIR")
            .or_else(|_| std::env::var("TMP"))
            .unwrap_or_else(|_| "/tmp".into());
        for base in &[xdg.as_str(), tmp.as_str(), "/tmp"] {
            if base.is_empty() {
                continue;
            }
            for i in 0..10 {
                let path = format!("{}/discord-ipc-{}", base, i);
                if let Ok(stream) = tokio::net::UnixStream::connect(&path).await {
                    log::info!("[Discord RPC] Connected to {}", path);
                    return Some(IpcStream::Unix(stream));
                }
            }
        }
    }

    None
}

async fn send_packet(stream: &mut IpcStream, opcode: u32, payload: &str) -> std::io::Result<()> {
    let payload_bytes = payload.as_bytes();
    let length = payload_bytes.len() as u32;

    let mut header = [0u8; 8];
    header[0..4].copy_from_slice(&opcode.to_le_bytes());
    header[4..8].copy_from_slice(&length.to_le_bytes());

    stream.write_all(&header).await?;
    stream.write_all(payload_bytes).await?;
    Ok(())
}

async fn read_packet(stream: &mut IpcStream) -> std::io::Result<(u32, String)> {
    let mut header = [0u8; 8];
    stream.read_exact(&mut header).await?;

    let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let length = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;

    if length > 65536 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Discord IPC packet too large",
        ));
    }

    let mut buf = vec![0u8; length];
    stream.read_exact(&mut buf).await?;

    let text = String::from_utf8(buf)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok((opcode, text))
}

async fn perform_handshake(stream: &mut IpcStream, client_id: &str) -> Result<(), String> {
    let handshake = serde_json::json!({
        "v": 1,
        "client_id": client_id
    })
    .to_string();

    send_packet(stream, 0, &handshake)
        .await
        .map_err(|e| format!("Failed to send handshake: {}", e))?;

    let (op, body) = tokio::time::timeout(Duration::from_secs(3), read_packet(stream))
        .await
        .map_err(|_| "Handshake timeout".to_string())?
        .map_err(|e| format!("Handshake read error: {}", e))?;

    log::debug!("[Discord RPC] Handshake response (op {}): {}", op, body);
    Ok(())
}

async fn resolve_app_icon_url(client_id: &str) -> Option<String> {
    let url = format!("https://discord.com/api/v10/applications/{}/rpc", client_id);
    if let Ok(resp) = reqwest::Client::new()
        .get(&url)
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        if let Ok(val) = resp.json::<serde_json::Value>().await {
            if let Some(icon) = val.get("icon").and_then(|v| v.as_str()) {
                if !icon.is_empty() {
                    return Some(format!(
                        "https://cdn.discordapp.com/app-icons/{}/{}.png",
                        client_id, icon
                    ));
                }
            }
        }
    }
    // Reliable fallback for default app ID
    Some("https://cdn.discordapp.com/app-icons/1556060308911689789/414ccd4c4413ca749f3bd077f1214fdf.png".to_string())
}

fn build_activity_payload(
    activity: &Option<DiscordActivity>,
    settings: &DiscordRpcSettings,
    small_image_url: Option<&str>,
    nonce: &str,
) -> serde_json::Value {
    let pid = std::process::id();

    match activity {
        None => serde_json::json!({
            "cmd": "SET_ACTIVITY",
            "args": {
                "pid": pid,
                "activity": null
            },
            "nonce": nonce
        }),
        Some(act) => {
            if !act.is_playing && !settings.show_pause {
                return serde_json::json!({
                    "cmd": "SET_ACTIVITY",
                    "args": {
                        "pid": pid,
                        "activity": null
                    },
                    "nonce": nonce
                });
            }

            let mut act_obj = serde_json::Map::new();

            // Type 2 = Listening to! Displays as "Listening to <AppName>" with progress bar like Spotify
            act_obj.insert("type".to_string(), serde_json::json!(2));

            // Details: Song Title
            let title = if act.title.trim().is_empty() {
                "Музыкальный трек".to_string()
            } else {
                act.title.clone()
            };
            act_obj.insert("details".to_string(), serde_json::json!(title));

            // State: Artist Name
            let artist = if act.artist.trim().is_empty() {
                "Неизвестный исполнитель".to_string()
            } else {
                act.artist.clone()
            };
            act_obj.insert("state".to_string(), serde_json::json!(artist));

            // Timestamps: only active when playing to enable Discord's live interactive progress bar
            if act.is_playing {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();

                let pos = act.position.unwrap_or(0.0).max(0.0) as u64;
                let dur = act.duration.unwrap_or(0.0).max(0.0) as u64;

                let start = now.saturating_sub(pos);
                let end = if dur > pos { start + dur } else { now };

                let mut timestamps = serde_json::Map::new();
                timestamps.insert("start".to_string(), serde_json::json!(start));
                if dur > 0 {
                    timestamps.insert("end".to_string(), serde_json::json!(end));
                }
                act_obj.insert("timestamps".to_string(), serde_json::Value::Object(timestamps));
            }

            // Assets (album cover art and app icon)
            let mut assets = serde_json::Map::new();
            if let Some(ref cover) = act.cover_url {
                if cover.starts_with("http://") || cover.starts_with("https://") {
                    assets.insert("large_image".to_string(), serde_json::json!(cover));
                }
            }
            if let Some(ref album) = act.album {
                if !album.trim().is_empty() {
                    assets.insert("large_text".to_string(), serde_json::json!(album));
                }
            }

            if let Some(small_icon) = small_image_url {
                assets.insert(
                    "small_image".to_string(),
                    serde_json::json!(small_icon),
                );
                assets.insert(
                    "small_text".to_string(),
                    serde_json::json!(if act.is_playing {
                        "Звук"
                    } else {
                        "На паузе"
                    }),
                );
            }
            act_obj.insert("assets".to_string(), serde_json::Value::Object(assets));

            // Buttons: direct link to listen to track in Zvuk
            if settings.show_buttons {
                if let Some(track_id) = act.track_id {
                    let track_url = format!("https://zvuk.com/track/{}", track_id);
                    let button = serde_json::json!({
                        "label": "Слушать в Звуке",
                        "url": track_url
                    });
                    act_obj.insert("buttons".to_string(), serde_json::json!([button]));
                }
            }

            serde_json::json!({
                "cmd": "SET_ACTIVITY",
                "args": {
                    "pid": pid,
                    "activity": act_obj
                },
                "nonce": nonce
            })
        }
    }
}

enum RpcCommand {
    UpdateActivity(Option<DiscordActivity>),
    UpdateSettings(DiscordRpcSettings),
}

#[derive(Clone)]
pub struct DiscordRpcManager {
    sender: mpsc::UnboundedSender<RpcCommand>,
    settings: Arc<RwLock<DiscordRpcSettings>>,
    is_connected: Arc<AtomicBool>,
    last_error: Arc<RwLock<Option<String>>>,
}

impl DiscordRpcManager {
    pub fn new(initial_settings: DiscordRpcSettings) -> Self {
        let (sender, mut receiver) = mpsc::unbounded_channel::<RpcCommand>();
        let settings = Arc::new(RwLock::new(initial_settings));
        let is_connected = Arc::new(AtomicBool::new(false));
        let last_error = Arc::new(RwLock::new(None));

        let settings_clone = Arc::clone(&settings);
        let is_connected_clone = Arc::clone(&is_connected);
        let last_error_clone = Arc::clone(&last_error);

        tauri::async_runtime::spawn(async move {
            let mut stream: Option<IpcStream> = None;
            let mut current_activity: Option<DiscordActivity> = None;
            let mut active_client_id: String = String::new();
            let mut active_icon_url: Option<String> = None;
            let mut nonce_seq: u64 = 0;

            while let Some(cmd) = receiver.recv().await {
                let current_settings = {
                    let guard = settings_clone.read().await;
                    guard.clone()
                };

                match cmd {
                    RpcCommand::UpdateSettings(new_settings) => {
                        let client_id_changed = active_client_id != new_settings.client_id;
                        let was_enabled = current_settings.enabled;

                        {
                            let mut guard = settings_clone.write().await;
                            *guard = new_settings.clone();
                        }

                        if !new_settings.enabled {
                            if let Some(ref mut s) = stream {
                                nonce_seq += 1;
                                let clear_payload = build_activity_payload(&None, &new_settings, None, &nonce_seq.to_string()).to_string();
                                let _ = send_packet(s, 1, &clear_payload).await;
                            }
                            stream = None;
                            active_client_id.clear();
                            active_icon_url = None;
                            is_connected_clone.store(false, Ordering::Relaxed);
                            let mut err_guard = last_error_clone.write().await;
                            *err_guard = None;
                            continue;
                        }

                        if client_id_changed || stream.is_none() || !was_enabled {
                            // Reconnect with new settings
                            stream = None;
                            active_client_id.clear();
                            active_icon_url = None;
                            is_connected_clone.store(false, Ordering::Relaxed);
                        }
                    }
                    RpcCommand::UpdateActivity(act) => {
                        current_activity = act;
                    }
                }

                let current_settings = {
                    let guard = settings_clone.read().await;
                    guard.clone()
                };

                if !current_settings.enabled {
                    continue;
                }

                // If not connected, attempt connection
                if stream.is_none() {
                    let client_id = if current_settings.client_id.trim().is_empty() {
                        DEFAULT_DISCORD_CLIENT_ID
                    } else {
                        current_settings.client_id.trim()
                    };

                    match connect_to_discord().await {
                        Some(mut new_stream) => {
                            match perform_handshake(&mut new_stream, client_id).await {
                                Ok(_) => {
                                    log::info!("[Discord RPC] Handshake succeeded with client_id: {}", client_id);
                                    active_icon_url = resolve_app_icon_url(client_id).await;
                                    stream = Some(new_stream);
                                    active_client_id = client_id.to_string();
                                    is_connected_clone.store(true, Ordering::Relaxed);
                                    let mut err_guard = last_error_clone.write().await;
                                    *err_guard = None;
                                }
                                Err(err) => {
                                    log::warn!("[Discord RPC] Handshake failed: {}", err);
                                    let mut err_guard = last_error_clone.write().await;
                                    *err_guard = Some(err);
                                    is_connected_clone.store(false, Ordering::Relaxed);
                                    stream = None;
                                    active_icon_url = None;
                                    continue;
                                }
                            }
                        }
                        None => {
                            is_connected_clone.store(false, Ordering::Relaxed);
                            // Discord not running
                            continue;
                        }
                    }
                }

                // Send activity update if connected
                if let Some(ref mut s) = stream {
                    nonce_seq += 1;
                    let payload = build_activity_payload(
                        &current_activity,
                        &current_settings,
                        active_icon_url.as_deref(),
                        &nonce_seq.to_string(),
                    )
                    .to_string();

                    match send_packet(s, 1, &payload).await {
                        Ok(_) => {
                            // Non-blocking consume response
                            let _ = tokio::time::timeout(Duration::from_millis(300), read_packet(s)).await;
                        }
                        Err(e) => {
                            log::warn!("[Discord RPC] Connection lost: {}", e);
                            stream = None;
                            active_client_id.clear();
                            active_icon_url = None;
                            is_connected_clone.store(false, Ordering::Relaxed);
                            let mut err_guard = last_error_clone.write().await;
                            *err_guard = Some(format!("Connection lost: {}", e));
                        }
                    }
                }
            }
        });

        Self {
            sender,
            settings,
            is_connected,
            last_error,
        }
    }

    pub fn update_activity(&self, activity: Option<DiscordActivity>) {
        let _ = self.sender.send(RpcCommand::UpdateActivity(activity));
    }

    pub fn update_settings(&self, settings: DiscordRpcSettings) {
        let _ = self.sender.send(RpcCommand::UpdateSettings(settings));
    }

    pub async fn get_settings(&self) -> DiscordRpcSettings {
        let guard = self.settings.read().await;
        guard.clone()
    }

    pub async fn get_status(&self) -> DiscordStatus {
        let err_guard = self.last_error.read().await;
        DiscordStatus {
            connected: self.is_connected.load(Ordering::Relaxed),
            error: err_guard.clone(),
        }
    }
}
