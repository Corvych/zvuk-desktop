#![allow(dead_code)]
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::Connector;
use uuid::Uuid;

use super::proto::*;
use super::tlv::*;

#[derive(Debug)]
struct NoVerify;

impl rustls::client::danger::ServerCertVerifier for NoVerify {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

pub fn make_danger_tls_client_config() -> Arc<rustls::ClientConfig> {
    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoVerify))
        .with_no_client_auth();
    Arc::new(config)
}

#[derive(Debug, Clone)]
pub enum SberCastEvent {
    TrackUpdated(SberTrackInfo),
    StateUpdated(SberSpeakerState),
    Disconnected,
}

pub struct SberClient {
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub client_name: String,
    pub pin_token: Mutex<Option<String>>,
    send_tx: mpsc::Sender<Vec<u8>>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Vec<u8>>>>>,
    _listen_handle: tokio::task::JoinHandle<()>,
    _keepalive_handle: tokio::task::JoinHandle<()>,
    _poll_handle: tokio::task::JoinHandle<()>,
}

impl SberClient {
    /// Pairs with a speaker: initiates pair, waits for '+' button press, returns token.
    pub async fn pair_with_button(
        host: &str,
        port: u16,
        client_name: &str,
        client_id: &str,
        timeout_secs: u64,
    ) -> Result<String, String> {
        let url = format!("wss://{}:{}/", host, port);
        let mut request = url.as_str().into_client_request().map_err(|e| e.to_string())?;
        request
            .headers_mut()
            .insert("User-Agent", HeaderValue::from_static("WebSocket++/0.8.2"));

        let tls_config = make_danger_tls_client_config();
        let connector = Connector::Rustls(tls_config);

        let (mut ws_stream, _) = tokio_tungstenite::connect_async_tls_with_config(
            request,
            None,
            false,
            Some(connector),
        )
        .await
        .map_err(|e| format!("Pair connect failed to {}: {}", url, e))?;

        // Send OP_PIN_CONNECT
        let req_id = Uuid::new_v4().to_string();
        let pair_init = build_pair_init_data();
        let envelope = build_envelope(&req_id, &pair_init, None, client_name, client_id);

        ws_stream
            .send(Message::Binary(envelope.into()))
            .await
            .map_err(|e| format!("Failed to send pair init: {}", e))?;

        let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);

        while tokio::time::Instant::now() < deadline {
            let remain = deadline - tokio::time::Instant::now();
            let msg = match tokio::time::timeout(remain, ws_stream.next()).await {
                Ok(Some(Ok(m))) => m,
                Ok(Some(Err(e))) => return Err(format!("WS error during pair: {}", e)),
                Ok(None) => return Err("Connection closed by speaker during pair".to_string()),
                Err(_) => return Err("Pairing timed out: '+' was not pressed".to_string()),
            };

            let bytes = match msg {
                Message::Binary(b) => b.to_vec(),
                Message::Text(t) => t.as_bytes().to_vec(),
                _ => continue,
            };

            let decoded = match decode_tlv_repeated(&bytes) {
                Ok(d) => d,
                Err(_) => continue,
            };

            // Inspect field 5 (request_data)
            if let Some(req_data_val) = get_single(&decoded, ENVELOPE_TAG_REQUEST_DATA) {
                if let Some(req_map) = req_data_val.as_nested() {
                    // Check field 4 (pair status)
                    if let Some(p4) = get_single(&req_map, 4).and_then(|v| v.as_nested()) {
                        let status = get_single(&p4, 1).and_then(|v| v.as_u64());
                        if status == Some(PAIR_STATUS_AUTHORIZED) {
                            if let Some(token) = get_single(&p4, 2).and_then(|v| v.as_str()) {
                                if token.len() >= 16 {
                                    return Ok(token.to_string());
                                }
                            }
                        } else if status == Some(PAIR_STATUS_BUSY) {
                            return Err("Speaker pairing is already busy with another client".to_string());
                        } else if status == Some(PAIR_STATUS_DISABLED) {
                            return Err("Pairing mode is disabled on speaker".to_string());
                        }
                    }

                    // Check field 6 (confirm after '+' button press)
                    if let Some(p6) = get_single(&req_map, 6).and_then(|v| v.as_nested()) {
                        let status = get_single(&p6, 1).and_then(|v| v.as_u64());
                        if status == Some(PAIR_CONFIRM_OK) {
                            if let Some(token) = get_single(&p6, 2).and_then(|v| v.as_str()) {
                                if token.len() >= 16 {
                                    return Ok(token.to_string());
                                }
                            }
                        } else if status == Some(PAIR_CONFIRM_REJECTED) {
                            return Err("Pairing was rejected by speaker".to_string());
                        }
                    }
                }
            }
        }

        Err("Pairing timed out: '+' was not pressed".to_string())
    }

    /// Connects to a paired speaker
    pub async fn connect(
        host: &str,
        port: u16,
        token: Option<String>,
        client_name: &str,
        client_id: &str,
        event_tx: mpsc::Sender<SberCastEvent>,
    ) -> Result<Arc<Self>, String> {
        let url = format!("wss://{}:{}/", host, port);
        let mut request = url.as_str().into_client_request().map_err(|e| e.to_string())?;
        request
            .headers_mut()
            .insert("User-Agent", HeaderValue::from_static("WebSocket++/0.8.2"));

        let tls_config = make_danger_tls_client_config();
        let connector = Connector::Rustls(tls_config);

        let (ws_stream, _) = tokio_tungstenite::connect_async_tls_with_config(
            request,
            None,
            false,
            Some(connector),
        )
        .await
        .map_err(|e| format!("Connect failed to {}: {}", url, e))?;

        let (mut ws_sink, mut ws_source) = ws_stream.split();
        let (send_tx, mut send_rx) = mpsc::channel::<Vec<u8>>(32);
        let pending = Arc::new(Mutex::new(HashMap::<String, oneshot::Sender<Vec<u8>>>::new()));

        // Writer task
        tokio::spawn(async move {
            while let Some(data) = send_rx.recv().await {
                if ws_sink.send(Message::Binary(data.into())).await.is_err() {
                    break;
                }
            }
            let _ = ws_sink.close().await;
        });

        // Reader task
        let pending_clone = Arc::clone(&pending);
        let event_tx_clone = event_tx.clone();
        let listen_handle = tokio::spawn(async move {
            while let Some(msg_res) = ws_source.next().await {
                let msg = match msg_res {
                    Ok(m) => m,
                    Err(e) => {
                        log::warn!("[SberCast] ws error: {}", e);
                        break;
                    }
                };

                let raw = match msg {
                    Message::Binary(b) => b.to_vec(),
                    Message::Text(t) => t.as_bytes().to_vec(),
                    _ => continue,
                };

                // Always inspect raw frame for track metadata and speaker state
                if let Some(track) = parse_track_json(&raw) {
                    let _ = event_tx_clone.send(SberCastEvent::TrackUpdated(track)).await;
                }
                if let Some(state) = parse_speaker_state(&raw) {
                    let _ = event_tx_clone.send(SberCastEvent::StateUpdated(state)).await;
                }

                // If TLV envelope, resolve matched request and inspect inner fields
                if let Ok(decoded) = decode_tlv_repeated(&raw) {
                    let msg_id = get_single(&decoded, ENVELOPE_TAG_MSG_ID)
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    if let Some(ref id) = msg_id {
                        let mut p = pending_clone.lock().await;
                        if let Some(tx) = p.remove(id) {
                            let _ = tx.send(raw.to_vec());
                        }
                    }
                }
            }
            log::warn!("[SberCast] WebSocket reader disconnected");
            let _ = event_tx_clone.send(SberCastEvent::Disconnected).await;
        });

        let keepalive_tx = send_tx.clone();
        let poll_tx = send_tx.clone();
        let poll_token = token.clone();
        let poll_client_name = client_name.to_string();
        let poll_client_id = client_id.to_string();

        let client = Arc::new(Self {
            host: host.to_string(),
            port,
            client_id: client_id.to_string(),
            client_name: client_name.to_string(),
            pin_token: Mutex::new(token),
            send_tx: send_tx.clone(),
            pending,
            _listen_handle: listen_handle,
            _keepalive_handle: tokio::spawn(async move {
                // Heartbeat every 25 seconds
                loop {
                    tokio::time::sleep(Duration::from_secs(25)).await;
                    // op=18 keepalive
                    let cast = encode_field_bytes(OP_KEEP_ALIVE, &encode_field_bytes(1, b""));
                    let req_id = Uuid::new_v4().to_string();
                    let envelope = build_envelope(&req_id, &cast, None, "Zvuk Desktop", "keepalive");
                    if keepalive_tx.send(envelope).await.is_err() {
                        break;
                    }
                }
            }),
            _poll_handle: tokio::spawn(async move {
                // Poll OP_GET_STATE every 1500ms for volume/mute; refresh metadata every 10s (counter % 7 == 0)
                let mut counter: u32 = 0;
                loop {
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                    counter = counter.wrapping_add(1);
                    let req_id = Uuid::new_v4().to_string();
                    let inner = encode_field_bytes(1, b"");
                    let op = if counter % 7 == 0 { OP_GET_META_DATA } else { OP_GET_STATE };
                    let cast = encode_field_bytes(op, &inner);
                    let envelope = build_envelope(
                        &req_id,
                        &cast,
                        poll_token.as_deref(),
                        &poll_client_name,
                        &poll_client_id,
                    );
                    if poll_tx.send(envelope).await.is_err() {
                        break;
                    }
                }
            }),
        });

        // Initial metadata fetch to trigger subscription stream
        let client_clone = Arc::clone(&client);
        tokio::spawn(async move {
            let _ = client_clone.get_metadata().await;
            let _ = client_clone.get_state().await;
        });

        Ok(client)
    }

    /// Sends raw request envelope and awaits response matching msg_id
    pub async fn send_raw_request(&self, envelope: Vec<u8>, msg_id: &str, timeout_secs: u64) -> Result<Vec<u8>, String> {
        let (tx, rx) = oneshot::channel();
        {
            let mut p = self.pending.lock().await;
            p.insert(msg_id.to_string(), tx);
        }

        self.send_tx
            .send(envelope)
            .await
            .map_err(|e| format!("Send failed: {}", e))?;

        match tokio::time::timeout(Duration::from_secs(timeout_secs), rx).await {
            Ok(Ok(bytes)) => Ok(bytes),
            Ok(Err(_)) => {
                let mut p = self.pending.lock().await;
                p.remove(msg_id);
                Err("Request channel closed prematurely".to_string())
            }
            Err(_) => {
                let mut p = self.pending.lock().await;
                p.remove(msg_id);
                Err(format!("Request timed out after {}s", timeout_secs))
            }
        }
    }

    /// Sends a standard RPC request (op in request_data)
    pub async fn send_request(&self, request_data: &[u8], timeout_secs: u64) -> Result<Vec<u8>, String> {
        let req_id = Uuid::new_v4().to_string();
        let tok = self.pin_token.lock().await.clone();
        let envelope = build_envelope(&req_id, request_data, tok.as_deref(), &self.client_name, &self.client_id);
        self.send_raw_request(envelope, &req_id, timeout_secs).await
    }

    /// Sends a fire-and-forget RPC request
    pub async fn fire_and_forget(&self, request_data: &[u8]) -> Result<(), String> {
        let req_id = Uuid::new_v4().to_string();
        let tok = self.pin_token.lock().await.clone();
        let envelope = build_envelope(&req_id, request_data, tok.as_deref(), &self.client_name, &self.client_id);
        self.send_tx
            .send(envelope)
            .await
            .map_err(|e| format!("Failed to send: {}", e))
    }

    /// Sends ServerAction (for playing deeplinks)
    pub async fn send_server_action(&self, name: &str, payload: serde_json::Value, timeout_secs: u64) -> Result<(), String> {
        let req_id = Uuid::new_v4().to_string();
        let tok = self.pin_token.lock().await.clone();
        let envelope = build_server_action(&req_id, name, payload, tok.as_deref(), &self.client_name, &self.client_id);
        let resp = self.send_raw_request(envelope, &req_id, timeout_secs).await?;

        let decoded = decode_tlv_repeated(&resp).map_err(|e| format!("TLV decode error: {}", e))?;
        if let Some(sa_val) = get_single(&decoded, ENVELOPE_TAG_SERVER_ACTION) {
            if let Some(nested) = sa_val.as_nested() {
                if let Some(f1) = get_single(&nested, 1).and_then(|v| v.as_str()) {
                    if f1.contains("OK") {
                        return Ok(());
                    } else {
                        return Err(format!("ServerAction failed: {}", f1));
                    }
                }
            }
        }
        Ok(())
    }

    /// Play a music deeplink (staros://music?...)
    pub async fn play_deeplink(&self, deeplink: &str) -> Result<(), String> {
        self.send_server_action("DEEPLINK", serde_json::json!({ "deeplink": deeplink }), 8).await
    }

    /// Play track by ID
    pub async fn play_track(&self, track_id: &str) -> Result<(), String> {
        let deeplink = format!("staros://music?tid={}&pt=track", track_id);
        self.play_deeplink(&deeplink).await
    }

    /// Play playlist by ID
    pub async fn play_playlist(&self, playlist_id: &str) -> Result<(), String> {
        let deeplink = format!("staros://music?pid={}&pt=playlist", playlist_id);
        self.play_deeplink(&deeplink).await
    }

    /// Play artist by ID
    pub async fn play_artist(&self, artist_id: &str) -> Result<(), String> {
        let deeplink = format!("staros://music?pid={}&pt=artist", artist_id);
        self.play_deeplink(&deeplink).await
    }

    /// Play album/release by ID
    pub async fn play_release(&self, release_id: &str) -> Result<(), String> {
        let deeplink = format!("staros://music?pid={}&pt=release", release_id);
        self.play_deeplink(&deeplink).await
    }

    /// Media commands
    pub async fn media_play(&self) -> Result<(), String> {
        self.fire_and_forget(&build_media_cmd_data(MEDIA_CMD_PLAY)).await
    }

    pub async fn media_pause(&self) -> Result<(), String> {
        self.fire_and_forget(&build_media_cmd_data(MEDIA_CMD_PAUSE)).await
    }

    pub async fn media_next(&self) -> Result<(), String> {
        self.fire_and_forget(&build_media_cmd_data(MEDIA_CMD_NEXT)).await
    }

    pub async fn media_prev(&self) -> Result<(), String> {
        self.fire_and_forget(&build_media_cmd_data(MEDIA_CMD_PREV)).await
    }

    pub async fn media_mute(&self) -> Result<(), String> {
        self.fire_and_forget(&build_media_cmd_data(MEDIA_CMD_MUTE)).await
    }

    pub async fn media_unmute(&self) -> Result<(), String> {
        self.fire_and_forget(&build_media_cmd_data(MEDIA_CMD_UNMUTE)).await
    }

    pub async fn media_like(&self) -> Result<(), String> {
        self.fire_and_forget(&build_media_cmd_data(MEDIA_CMD_LIKE)).await
    }

    pub async fn media_remove_like(&self) -> Result<(), String> {
        self.fire_and_forget(&build_media_cmd_data(MEDIA_CMD_REMOVE_LIKE)).await
    }

    pub async fn media_dislike(&self) -> Result<(), String> {
        self.fire_and_forget(&build_media_cmd_data(MEDIA_CMD_DISLIKE)).await
    }

    pub async fn media_shuffle(&self, on: bool) -> Result<(), String> {
        let cmd = if on { MEDIA_CMD_SHUFFLE_ON } else { MEDIA_CMD_SHUFFLE_OFF };
        self.fire_and_forget(&build_media_cmd_data(cmd)).await
    }

    pub async fn media_repeat(&self, mode: &str) -> Result<(), String> {
        let cmd = match mode.to_lowercase().as_str() {
            "all" | "playlist" => MEDIA_CMD_REPEAT_PLAYLIST,
            "one" | "track" => MEDIA_CMD_REPEAT_TRACK,
            _ => MEDIA_CMD_REPEAT_NONE,
        };
        self.fire_and_forget(&build_media_cmd_data(cmd)).await
    }

    pub async fn set_volume(&self, percent: u32) -> Result<(), String> {
        self.fire_and_forget(&build_set_volume_data(percent)).await
    }

    pub async fn seek_to(&self, position_sec: u64) -> Result<(), String> {
        self.fire_and_forget(&build_seek_data(position_sec)).await
    }

    pub async fn get_metadata(&self) -> Result<Option<SberTrackInfo>, String> {
        let inner = encode_field_bytes(1, b"");
        let cast = encode_field_bytes(OP_GET_META_DATA, &inner);
        let resp = self.send_request(&cast, 5).await?;
        Ok(parse_track_json(&resp))
    }

    pub async fn get_state(&self) -> Result<Option<SberSpeakerState>, String> {
        let inner = encode_field_bytes(1, b"");
        let cast = encode_field_bytes(OP_GET_STATE, &inner);
        let resp = self.send_request(&cast, 5).await?;
        Ok(parse_speaker_state(&resp))
    }
}
