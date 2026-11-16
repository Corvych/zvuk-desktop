use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex, RwLock};

use super::client::{SberCastEvent, SberClient};
use super::discovery::{discover_mdns, probe_manual_device, scan_subnet_fallback};
use super::proto::{SberDevice, SberSpeakerState, SberTrackInfo, DEFAULT_CLIENT_NAME};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SberCastStatus {
    pub is_connected: bool,
    pub is_connecting: bool,
    pub is_pairing: bool,
    pub active_device: Option<SberDevice>,
    pub current_track: Option<SberTrackInfo>,
    pub speaker_state: Option<SberSpeakerState>,
}

pub struct SberCastManager {
    app_handle: AppHandle,
    client_id: String,
    storage_path: PathBuf,
    saved_devices: RwLock<HashMap<String, SberDevice>>,
    active_client: Mutex<Option<Arc<SberClient>>>,
    active_device: RwLock<Option<SberDevice>>,
    current_track: Arc<RwLock<Option<SberTrackInfo>>>,
    speaker_state: Arc<RwLock<Option<SberSpeakerState>>>,
    is_connecting: RwLock<bool>,
    is_pairing: RwLock<bool>,
}

impl SberCastManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let base_dir = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("Zvuk Desktop");
        let _ = fs::create_dir_all(&base_dir);
        let storage_path = base_dir.join("sbercast_devices.json");

        let mut saved = HashMap::new();
        let mut modified = false;
        if let Ok(content) = fs::read_to_string(&storage_path) {
            if let Ok(devices) = serde_json::from_str::<Vec<SberDevice>>(&content) {
                for mut d in devices {
                    if let Ok(ip) = d.host.parse::<std::net::Ipv4Addr>() {
                        if !super::discovery::is_valid_private_lan(&ip) {
                            modified = true;
                            continue;
                        }
                    }
                    let clean = super::discovery::sanitize_device_name(&d.name);
                    if clean != d.name {
                        d.name = clean;
                        modified = true;
                    }
                    saved.insert(d.id.clone(), d);
                }
            }
        }

        if modified {
            let list: Vec<SberDevice> = saved.values().cloned().collect();
            if let Ok(json) = serde_json::to_string_pretty(&list) {
                let _ = fs::write(&storage_path, json);
            }
        }

        let client_id = uuid::Uuid::new_v4().to_string();

        Self {
            app_handle,
            client_id,
            storage_path,
            saved_devices: RwLock::new(saved),
            active_client: Mutex::new(None),
            active_device: RwLock::new(None),
            current_track: Arc::new(RwLock::new(None)),
            speaker_state: Arc::new(RwLock::new(None)),
            is_connecting: RwLock::new(false),
            is_pairing: RwLock::new(false),
        }
    }

    fn persist_saved_devices(&self, devices: &HashMap<String, SberDevice>) {
        let list: Vec<SberDevice> = devices.values().cloned().collect();
        if let Ok(json) = serde_json::to_string_pretty(&list) {
            let _ = fs::write(&self.storage_path, json);
        }
    }

    pub async fn get_saved_devices(&self) -> Vec<SberDevice> {
        let saved = self.saved_devices.read().await;
        saved.values().cloned().collect()
    }

    pub async fn save_device(&self, device: SberDevice) {
        let mut saved = self.saved_devices.write().await;
        saved.insert(device.id.clone(), device);
        self.persist_saved_devices(&saved);
    }

    pub async fn remove_device(&self, id: &str) {
        let mut saved = self.saved_devices.write().await;
        saved.remove(id);
        self.persist_saved_devices(&saved);
    }

    pub async fn get_status(&self) -> SberCastStatus {
        let active_client = self.active_client.lock().await;
        let is_connected = active_client.is_some();
        let is_connecting = *self.is_connecting.read().await;
        let is_pairing = *self.is_pairing.read().await;
        let active_device = self.active_device.read().await.clone();
        let current_track = self.current_track.read().await.clone();
        let speaker_state = self.speaker_state.read().await.clone();

        SberCastStatus {
            is_connected,
            is_connecting,
            is_pairing,
            active_device,
            current_track,
            speaker_state,
        }
    }

    pub async fn discover_devices(&self) -> Vec<SberDevice> {
        let mut found = discover_mdns(3).await;

        if found.is_empty() {
            log::info!("[SberCast] mDNS found 0 devices, falling back to subnet scan");
            found = scan_subnet_fallback().await;
        }

        // Merge with saved devices (enrich with tokens and custom names)
        let saved = self.saved_devices.read().await;
        for dev in &mut found {
            dev.name = super::discovery::sanitize_device_name(&dev.name);
            if let Some(s) = saved.get(&dev.id) {
                dev.name = super::discovery::sanitize_device_name(&s.name);
                dev.pin_token = s.pin_token.clone();
                dev.is_paired = s.pin_token.is_some();
            } else {
                // Also check match by IP
                for s in saved.values() {
                    if s.host == dev.host {
                        dev.name = super::discovery::sanitize_device_name(&s.name);
                        dev.pin_token = s.pin_token.clone();
                        dev.is_paired = s.pin_token.is_some();
                        break;
                    }
                }
            }
        }

        // Include any saved devices not in scan list (e.g. offline or other subnet)
        for s in saved.values() {
            if !found.iter().any(|d| d.id == s.id || d.host == s.host) {
                let mut dev = s.clone();
                dev.is_paired = dev.pin_token.is_some();
                found.push(dev);
            }
        }

        found
    }

    pub async fn add_manual_device(&self, host: &str, port: u16) -> Result<SberDevice, String> {
        let mut dev = probe_manual_device(host, port).await?;
        let saved = self.saved_devices.read().await;
        for s in saved.values() {
            if s.host == host {
                dev.pin_token = s.pin_token.clone();
                dev.name = s.name.clone();
                dev.is_paired = dev.pin_token.is_some();
                break;
            }
        }
        Ok(dev)
    }

    pub async fn pair_device(&self, host: &str, port: u16, name: Option<String>) -> Result<SberDevice, String> {
        {
            let mut pairing = self.is_pairing.write().await;
            *pairing = true;
        }
        let _ = self.app_handle.emit("sbercast-pairing-start", serde_json::json!({ "host": host }));

        let token_res = SberClient::pair_with_button(
            host,
            port,
            DEFAULT_CLIENT_NAME,
            &self.client_id,
            120, // 2 minutes wait for + button
        )
        .await;

        {
            let mut pairing = self.is_pairing.write().await;
            *pairing = false;
        }

        match token_res {
            Ok(token) => {
                let dev_id = format!("sber-{}", host.replace('.', "-"));
                let dev_name = name.unwrap_or_else(|| format!("SberBoom ({})", host));
                let dev = SberDevice {
                    id: dev_id,
                    name: dev_name,
                    host: host.to_string(),
                    port,
                    model: Some("SberBoom".to_string()),
                    firmware: None,
                    pin_token: Some(token),
                    is_paired: true,
                };
                self.save_device(dev.clone()).await;
                let _ = self.app_handle.emit("sbercast-pairing-success", serde_json::json!({ "device": &dev }));
                Ok(dev)
            }
            Err(e) => {
                let _ = self.app_handle.emit("sbercast-pairing-error", serde_json::json!({ "error": &e }));
                Err(e)
            }
        }
    }

    pub async fn connect_device(&self, device: SberDevice) -> Result<(), String> {
        self.disconnect().await;

        {
            let mut conn = self.is_connecting.write().await;
            *conn = true;
        }

        let (event_tx, mut event_rx) = mpsc::channel::<SberCastEvent>(32);
        let host = device.host.clone();
        let port = device.port;
        let token = device.pin_token.clone();

        let client = match SberClient::connect(
            &host,
            port,
            token,
            DEFAULT_CLIENT_NAME,
            &self.client_id,
            event_tx,
        )
        .await
        {
            Ok(c) => c,
            Err(e) => {
                let mut conn = self.is_connecting.write().await;
                *conn = false;
                return Err(e);
            }
        };

        {
            let mut cl = self.active_client.lock().await;
            *cl = Some(client);
            let mut ad = self.active_device.write().await;
            *ad = Some(device.clone());
            let mut conn = self.is_connecting.write().await;
            *conn = false;
        }

        let app_handle = self.app_handle.clone();
        let track_holder = Arc::clone(&self.current_track);
        let state_holder = Arc::clone(&self.speaker_state);
        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                match event {
                    SberCastEvent::TrackUpdated(track) => {
                        let should_emit = {
                            let current = track_holder.read().await;
                            match current.as_ref() {
                                Some(curr) => {
                                    let tid_changed = curr.track_id != track.track_id;
                                    let play_changed = curr.playing != track.playing;
                                    let ts_changed = track.position_ts_ms.is_some()
                                        && track.position_ts_ms != curr.position_ts_ms;
                                    let pos_jump = match (curr.position, track.position) {
                                        (Some(cp), Some(np)) => (np as i64 - cp as i64).abs() > 4,
                                        _ => false,
                                    };
                                    tid_changed || play_changed || ts_changed || pos_jump
                                }
                                None => true,
                            }
                        };

                        if should_emit {
                            *track_holder.write().await = Some(track.clone());
                            let _ = app_handle.emit("sbercast-track-updated", track);
                        }
                    }
                    SberCastEvent::StateUpdated(state) => {
                        *state_holder.write().await = Some(state.clone());
                        let _ = app_handle.emit("sbercast-state-updated", state);
                    }
                    SberCastEvent::Disconnected => {
                        *track_holder.write().await = None;
                        *state_holder.write().await = None;
                        let _ = app_handle.emit("sbercast-disconnected", ());
                        break;
                    }
                }
            }
        });

        let _ = self.app_handle.emit("sbercast-connected", serde_json::json!({ "device": device }));
        Ok(())
    }

    pub async fn disconnect(&self) {
        {
            let mut cl = self.active_client.lock().await;
            *cl = None;
            let mut ad = self.active_device.write().await;
            *ad = None;
            let mut tr = self.current_track.write().await;
            *tr = None;
            let mut st = self.speaker_state.write().await;
            *st = None;
        }
        let _ = self.app_handle.emit("sbercast-disconnected", ());
    }

    // Playback and controls delegated to active client
    pub async fn play_deeplink(&self, deeplink: &str) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.play_deeplink(deeplink).await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn play_track(&self, track_id: &str) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.play_track(track_id).await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn play_playlist(&self, playlist_id: &str) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.play_playlist(playlist_id).await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn play_artist(&self, artist_id: &str) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.play_artist(artist_id).await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn play_release(&self, release_id: &str) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.play_release(release_id).await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn media_play(&self) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.media_play().await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn media_pause(&self) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.media_pause().await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn media_next(&self) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.media_next().await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn media_prev(&self) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.media_prev().await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn media_like(&self) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.media_like().await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn media_dislike(&self) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.media_dislike().await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn media_shuffle(&self, on: bool) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.media_shuffle(on).await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn media_repeat(&self, mode: &str) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.media_repeat(mode).await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn set_volume(&self, percent: u32) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.set_volume(percent).await,
            None => Err("No active SberCast connection".to_string()),
        }
    }

    pub async fn seek(&self, seconds: u64) -> Result<(), String> {
        let cl = self.active_client.lock().await;
        match cl.as_ref() {
            Some(client) => client.seek_to(seconds).await,
            None => Err("No active SberCast connection".to_string()),
        }
    }
}
