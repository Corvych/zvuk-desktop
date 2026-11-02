use std::collections::HashMap;
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

enum IpcReader {
    #[cfg(target_os = "windows")]
    Windows(tokio::io::ReadHalf<NamedPipeClient>),
    #[cfg(not(target_os = "windows"))]
    Unix(tokio::io::ReadHalf<tokio::net::UnixStream>),
}

enum IpcWriter {
    #[cfg(target_os = "windows")]
    Windows(tokio::io::WriteHalf<NamedPipeClient>),
    #[cfg(not(target_os = "windows"))]
    Unix(tokio::io::WriteHalf<tokio::net::UnixStream>),
}

impl IpcStream {
    fn split(self) -> (IpcReader, IpcWriter) {
        match self {
            #[cfg(target_os = "windows")]
            IpcStream::Windows(s) => {
                let (r, w) = tokio::io::split(s);
                (IpcReader::Windows(r), IpcWriter::Windows(w))
            }
            #[cfg(not(target_os = "windows"))]
            IpcStream::Unix(s) => {
                let (r, w) = tokio::io::split(s);
                (IpcReader::Unix(r), IpcWriter::Unix(w))
            }
        }
    }

    async fn read_exact(&mut self, buf: &mut [u8]) -> std::io::Result<()> {
        use tokio::io::AsyncReadExt;
        match self {
            #[cfg(target_os = "windows")]
            IpcStream::Windows(ref mut s) => s.read_exact(buf).await.map(|_| ()),
            #[cfg(not(target_os = "windows"))]
            IpcStream::Unix(ref mut s) => s.read_exact(buf).await.map(|_| ()),
        }
    }

    async fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        use tokio::io::AsyncWriteExt;
        match self {
            #[cfg(target_os = "windows")]
            IpcStream::Windows(ref mut s) => s.write_all(buf).await,
            #[cfg(not(target_os = "windows"))]
            IpcStream::Unix(ref mut s) => s.write_all(buf).await,
        }
    }
}

impl IpcReader {
    async fn read_exact(&mut self, buf: &mut [u8]) -> std::io::Result<()> {
        use tokio::io::AsyncReadExt;
        match self {
            #[cfg(target_os = "windows")]
            IpcReader::Windows(ref mut s) => s.read_exact(buf).await.map(|_| ()),
            #[cfg(not(target_os = "windows"))]
            IpcReader::Unix(ref mut s) => s.read_exact(buf).await.map(|_| ()),
        }
    }
}

impl IpcWriter {
    async fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        use tokio::io::AsyncWriteExt;
        match self {
            #[cfg(target_os = "windows")]
            IpcWriter::Windows(ref mut s) => s.write_all(buf).await,
            #[cfg(not(target_os = "windows"))]
            IpcWriter::Unix(ref mut s) => s.write_all(buf).await,
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

async fn send_packet_stream(stream: &mut IpcStream, opcode: u32, payload: &str) -> std::io::Result<()> {
    let payload_bytes = payload.as_bytes();
    let length = payload_bytes.len() as u32;

    let mut header = [0u8; 8];
    header[0..4].copy_from_slice(&opcode.to_le_bytes());
    header[4..8].copy_from_slice(&length.to_le_bytes());

    stream.write_all(&header).await?;
    stream.write_all(payload_bytes).await?;
    Ok(())
}

async fn read_packet_stream(stream: &mut IpcStream) -> std::io::Result<(u32, String)> {
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

async fn send_packet_writer(writer: &mut IpcWriter, opcode: u32, payload: &str) -> std::io::Result<()> {
    let payload_bytes = payload.as_bytes();
    let length = payload_bytes.len() as u32;

    let mut header = [0u8; 8];
    header[0..4].copy_from_slice(&opcode.to_le_bytes());
    header[4..8].copy_from_slice(&length.to_le_bytes());

    writer.write_all(&header).await?;
    writer.write_all(payload_bytes).await?;
    Ok(())
}

async fn read_packet_reader(reader: &mut IpcReader) -> std::io::Result<(u32, String)> {
    let mut header = [0u8; 8];
    reader.read_exact(&mut header).await?;

    let opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let length = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;

    if length > 65536 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Discord IPC packet too large",
        ));
    }

    let mut buf = vec![0u8; length];
    reader.read_exact(&mut buf).await?;

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

    send_packet_stream(stream, 0, &handshake)
        .await
        .map_err(|e| format!("Failed to send handshake: {}", e))?;

    let (op, body) = tokio::time::timeout(Duration::from_secs(4), read_packet_stream(stream))
        .await
        .map_err(|_| "Handshake timeout".to_string())?
        .map_err(|e| format!("Handshake read error: {}", e))?;

    log::debug!("[Discord RPC] Handshake response (op {}): {}", op, body);
    Ok(())
}

async fn resolve_app_icon_url(client_id: &str) -> Option<String> {
    const DEFAULT_ICON: &str = "https://cdn.discordapp.com/app-icons/1556060308911689789/414ccd4c4413ca749f3bd077f1214fdf.png";
    if client_id == DEFAULT_DISCORD_CLIENT_ID || client_id.trim().is_empty() {
        return Some(DEFAULT_ICON.to_string());
    }

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
    Some(DEFAULT_ICON.to_string())
}

/// Sanitizes a string for Discord RPC (min 2, max 128 characters)
fn sanitize_discord_string(s: &str, min_len: usize, max_len: usize) -> Option<String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut result: String = trimmed.chars().take(max_len).collect();
    while result.chars().count() < min_len {
        result.push(' ');
    }
    Some(result)
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

            // Details: Song Title (2-128 chars)
            let title = sanitize_discord_string(&act.title, 2, 128)
                .unwrap_or_else(|| "Музыкальный трек".to_string());
            act_obj.insert("details".to_string(), serde_json::json!(title));

            // State: Artist Name (2-128 chars)
            let artist = sanitize_discord_string(&act.artist, 2, 128)
                .unwrap_or_else(|| "Неизвестный исполнитель".to_string());
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
            let mut has_large_image = false;

            if let Some(ref cover) = act.cover_url {
                if cover.starts_with("http://") || cover.starts_with("https://") {
                    assets.insert("large_image".to_string(), serde_json::json!(cover));
                    has_large_image = true;
                }
            }

            // If no cover art, fallback to app icon for large image so presence has visual badge
            if !has_large_image {
                if let Some(small_icon) = small_image_url {
                    assets.insert("large_image".to_string(), serde_json::json!(small_icon));
                    has_large_image = true;
                }
            }

            if let Some(album) = act.album.as_deref().and_then(|a| sanitize_discord_string(a, 2, 128)) {
                assets.insert("large_text".to_string(), serde_json::json!(album));
            }

            // Small badge overlaid on bottom right of large image
            if has_large_image {
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
            }
            act_obj.insert("assets".to_string(), serde_json::Value::Object(assets));

            // Buttons: direct link to listen to track in Zvuk
            if settings.show_buttons {
                if let Some(track_id) = act.track_id {
                    if track_id > 0 {
                        let track_url = format!("https://zvuk.com/track/{}", track_id);
                        let button = serde_json::json!({
                            "label": "Слушать в Звуке",
                            "url": track_url
                        });
                        act_obj.insert("buttons".to_string(), serde_json::json!([button]));
                    }
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

enum InternalRpcMsg {
    Disconnected(String),
    Pong(String),
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
            let (internal_tx, mut internal_rx) = mpsc::unbounded_channel::<InternalRpcMsg>();
            let mut ticker = tokio::time::interval(Duration::from_secs(5));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            let mut writer: Option<IpcWriter> = None;
            let mut current_activity: Option<DiscordActivity> = None;
            let mut active_client_id: String = String::new();
            let mut active_icon_url: Option<String> = None;
            let mut icon_cache: HashMap<String, Option<String>> = HashMap::new();
            let mut nonce_seq: u64 = 0;

            loop {
                tokio::select! {
                    cmd = receiver.recv() => {
                        let Some(cmd) = cmd else { break; };
                        match cmd {
                            RpcCommand::UpdateSettings(new_settings) => {
                                let client_id_changed = active_client_id != new_settings.client_id;
                                let was_enabled = {
                                    let guard = settings_clone.read().await;
                                    guard.enabled
                                };

                                {
                                    let mut guard = settings_clone.write().await;
                                    *guard = new_settings.clone();
                                }

                                if !new_settings.enabled {
                                    if let Some(ref mut w) = writer {
                                        nonce_seq += 1;
                                        let clear_payload = build_activity_payload(&None, &new_settings, None, &nonce_seq.to_string()).to_string();
                                        let _ = send_packet_writer(w, 1, &clear_payload).await;
                                    }
                                    writer = None;
                                    active_client_id.clear();
                                    active_icon_url = None;
                                    is_connected_clone.store(false, Ordering::Relaxed);
                                    let mut err_guard = last_error_clone.write().await;
                                    *err_guard = None;
                                    continue;
                                }

                                if client_id_changed || writer.is_none() || !was_enabled {
                                    writer = None;
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

                        if writer.is_none() {
                            connect_and_sync(
                                &current_settings,
                                &current_activity,
                                &internal_tx,
                                &mut writer,
                                &mut active_client_id,
                                &mut active_icon_url,
                                &mut icon_cache,
                                &mut nonce_seq,
                                &is_connected_clone,
                                &last_error_clone,
                            ).await;
                        } else if let Some(ref mut w) = writer {
                            nonce_seq += 1;
                            let payload = build_activity_payload(
                                &current_activity,
                                &current_settings,
                                active_icon_url.as_deref(),
                                &nonce_seq.to_string(),
                            ).to_string();

                            if let Err(e) = send_packet_writer(w, 1, &payload).await {
                                log::warn!("[Discord RPC] Send packet error: {}", e);
                                writer = None;
                                active_client_id.clear();
                                active_icon_url = None;
                                is_connected_clone.store(false, Ordering::Relaxed);
                                let mut err_guard = last_error_clone.write().await;
                                *err_guard = Some(format!("Connection lost: {}", e));
                            }
                        }
                    }
                    internal_msg = internal_rx.recv() => {
                        let Some(msg) = internal_msg else { continue; };
                        match msg {
                            InternalRpcMsg::Disconnected(reason) => {
                                log::warn!("[Discord RPC] Disconnected from Discord: {}", reason);
                                writer = None;
                                active_client_id.clear();
                                active_icon_url = None;
                                is_connected_clone.store(false, Ordering::Relaxed);
                                let mut err_guard = last_error_clone.write().await;
                                *err_guard = Some(reason);
                            }
                            InternalRpcMsg::Pong(payload) => {
                                if let Some(ref mut w) = writer {
                                    let _ = send_packet_writer(w, 4, &payload).await;
                                }
                            }
                        }
                    }
                    _ = ticker.tick() => {
                        let current_settings = {
                            let guard = settings_clone.read().await;
                            guard.clone()
                        };

                        if current_settings.enabled && writer.is_none() {
                            connect_and_sync(
                                &current_settings,
                                &current_activity,
                                &internal_tx,
                                &mut writer,
                                &mut active_client_id,
                                &mut active_icon_url,
                                &mut icon_cache,
                                &mut nonce_seq,
                                &is_connected_clone,
                                &last_error_clone,
                            ).await;
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

async fn connect_and_sync(
    settings: &DiscordRpcSettings,
    activity: &Option<DiscordActivity>,
    internal_tx: &mpsc::UnboundedSender<InternalRpcMsg>,
    writer: &mut Option<IpcWriter>,
    active_client_id: &mut String,
    active_icon_url: &mut Option<String>,
    icon_cache: &mut HashMap<String, Option<String>>,
    nonce_seq: &mut u64,
    is_connected: &Arc<AtomicBool>,
    last_error: &Arc<RwLock<Option<String>>>,
) {
    let client_id = if settings.client_id.trim().is_empty() {
        DEFAULT_DISCORD_CLIENT_ID
    } else {
        settings.client_id.trim()
    };

    let Some(mut stream) = connect_to_discord().await else {
        is_connected.store(false, Ordering::Relaxed);
        return;
    };

    match perform_handshake(&mut stream, client_id).await {
        Ok(_) => {
            log::info!("[Discord RPC] Connected and handshake succeeded with client_id: {}", client_id);
            let icon_url = if let Some(cached) = icon_cache.get(client_id) {
                cached.clone()
            } else {
                let resolved = resolve_app_icon_url(client_id).await;
                icon_cache.insert(client_id.to_string(), resolved.clone());
                resolved
            };
            *active_client_id = client_id.to_string();
            *active_icon_url = icon_url.clone();

            let (mut reader, mut new_writer) = stream.split();

            let itx = internal_tx.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match read_packet_reader(&mut reader).await {
                        Ok((op, text)) => {
                            log::debug!("[Discord RPC] Received packet op {}: {}", op, text);
                            if op == 3 {
                                let _ = itx.send(InternalRpcMsg::Pong(text));
                            } else if op == 1 {
                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                                    if val.get("evt").and_then(|v| v.as_str()) == Some("ERROR") {
                                        log::warn!("[Discord RPC] Discord error response: {}", text);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::info!("[Discord RPC] Stream closed: {}", e);
                            let _ = itx.send(InternalRpcMsg::Disconnected(e.to_string()));
                            break;
                        }
                    }
                }
            });

            *nonce_seq += 1;
            let payload = build_activity_payload(
                activity,
                settings,
                icon_url.as_deref(),
                &nonce_seq.to_string(),
            ).to_string();

            if let Err(e) = send_packet_writer(&mut new_writer, 1, &payload).await {
                log::warn!("[Discord RPC] Initial activity send failed: {}", e);
                is_connected.store(false, Ordering::Relaxed);
                let mut err_guard = last_error.write().await;
                *err_guard = Some(format!("Send error: {}", e));
            } else {
                is_connected.store(true, Ordering::Relaxed);
                let mut err_guard = last_error.write().await;
                *err_guard = None;
                *writer = Some(new_writer);
            }
        }
        Err(err) => {
            log::warn!("[Discord RPC] Handshake failed: {}", err);
            is_connected.store(false, Ordering::Relaxed);
            let mut err_guard = last_error.write().await;
            *err_guard = Some(err);
        }
    }
}
