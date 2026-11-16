#![allow(dead_code)]
use super::tlv::*;
use serde::{Deserialize, Serialize};

pub const DEFAULT_PORT: u16 = 20000;
pub const DEFAULT_CLIENT_NAME: &str = "Zvuk Desktop";

// Opcodes
pub const OP_PIN_CONNECT: u32 = 4;
pub const OP_GET_META_DATA: u32 = 10;
pub const OP_GET_STATE: u32 = 12;
pub const OP_FIND_REMOTE: u32 = 13;
pub const OP_SET_VOLUME: u32 = 14;
pub const OP_SET_TRACK_POS: u32 = 15;
pub const OP_MEDIA_COMMAND: u32 = 16;
pub const OP_GET_PLAYING_QUEUE: u32 = 17;
pub const OP_KEEP_ALIVE: u32 = 18;
pub const OP_SET_PLAYBACK_SPEED: u32 = 23;

// Media commands
pub const MEDIA_CMD_MUTE: u64 = 0;
pub const MEDIA_CMD_UNMUTE: u64 = 1;
pub const MEDIA_CMD_NEXT: u64 = 2;
pub const MEDIA_CMD_PREV: u64 = 3;
pub const MEDIA_CMD_PLAY: u64 = 4;
pub const MEDIA_CMD_PAUSE: u64 = 5;
pub const MEDIA_CMD_LIKE: u64 = 6;
pub const MEDIA_CMD_REMOVE_LIKE: u64 = 7;
pub const MEDIA_CMD_START_MULTIROOM: u64 = 8;
pub const MEDIA_CMD_SHUFFLE_ON: u64 = 9;
pub const MEDIA_CMD_SHUFFLE_OFF: u64 = 10;
pub const MEDIA_CMD_REPEAT_NONE: u64 = 11;
pub const MEDIA_CMD_REPEAT_PLAYLIST: u64 = 12;
pub const MEDIA_CMD_REPEAT_TRACK: u64 = 13;
pub const MEDIA_CMD_DISLIKE: u64 = 14;
pub const MEDIA_CMD_REMOVE_DISLIKE: u64 = 15;

pub const TOKEN_TYPE_PIN_AUTH: u64 = 1;

// Envelope field tags
pub const ENVELOPE_TAG_TYPE: u32 = 1;
pub const ENVELOPE_TAG_MSG_ID: u32 = 2;
pub const ENVELOPE_TAG_TOKEN: u32 = 3;
pub const ENVELOPE_TAG_SERVER_ACTION: u32 = 4;
pub const ENVELOPE_TAG_REQUEST_DATA: u32 = 5;
pub const ENVELOPE_TAG_TOKEN_TYPE: u32 = 6;
pub const ENVELOPE_TAG_CLIENT_NAME: u32 = 7;
pub const ENVELOPE_TAG_IS_REQUEST: u32 = 10;
pub const ENVELOPE_TAG_CLIENT_ID: u32 = 11;

// Pair statuses
pub const PAIR_STATUS_WAITING: u64 = 1;
pub const PAIR_STATUS_AUTHORIZED: u64 = 2;
pub const PAIR_STATUS_BUSY: u64 = 3;
pub const PAIR_STATUS_DISABLED: u64 = 5;

pub const PAIR_CONFIRM_OK: u64 = 1;
pub const PAIR_CONFIRM_REJECTED: u64 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SberTrackInfo {
    pub track_id: Option<String>,
    pub title: Option<String>,
    pub artists: Vec<String>,
    pub album: Option<String>,
    pub duration: Option<u64>,
    pub position: Option<u64>,
    pub position_ts_ms: Option<u64>,
    pub received_at_ms: u64,
    pub playing: bool,
    pub shuffle: bool,
    pub repeat_type: Option<String>,
    pub liked: bool,
    pub provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SberSpeakerState {
    pub volume_percent: Option<u32>,
    pub muted: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SberDevice {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub model: Option<String>,
    pub firmware: Option<String>,
    pub pin_token: Option<String>,
    pub is_paired: bool,
}

/// Builds standard RPC request envelope (type = 2)
pub fn build_envelope(
    req_id: &str,
    request_data: &[u8],
    token: Option<&str>,
    client_name: &str,
    client_id: &str,
) -> Vec<u8> {
    let mut parts = Vec::new();
    parts.extend(encode_field_varint(ENVELOPE_TAG_TYPE, 2)); // REQUEST = 2
    parts.extend(encode_field_bytes(ENVELOPE_TAG_MSG_ID, req_id.as_bytes()));

    if let Some(tok) = token {
        if !tok.is_empty() {
            parts.extend(encode_field_bytes(ENVELOPE_TAG_TOKEN, tok.as_bytes()));
        }
    }

    parts.extend(encode_field_bytes(ENVELOPE_TAG_REQUEST_DATA, request_data));
    parts.extend(encode_field_varint(
        ENVELOPE_TAG_TOKEN_TYPE,
        TOKEN_TYPE_PIN_AUTH,
    ));
    parts.extend(encode_field_bytes(
        ENVELOPE_TAG_CLIENT_NAME,
        client_name.as_bytes(),
    ));
    parts.extend(encode_field_varint(ENVELOPE_TAG_IS_REQUEST, 1));
    parts.extend(encode_field_bytes(
        ENVELOPE_TAG_CLIENT_ID,
        client_id.as_bytes(),
    ));

    parts
}

/// Builds ServerAction envelope (type = 1) for playing deeplinks
pub fn build_server_action(
    req_id: &str,
    name: &str,
    payload: serde_json::Value,
    token: Option<&str>,
    client_name: &str,
    client_id: &str,
) -> Vec<u8> {
    let body = serde_json::json!({
        "name": name,
        "payload": payload,
        "smartAppInfo": {
            "appVersionId": "",
            "applicationId": "",
            "frontendEndpoint": "",
            "frontendType": "",
            "projectId": "",
            "systemName": ""
        },
        "type": 1
    });

    let json_bytes = serde_json::to_vec(&body).unwrap_or_default();
    let server_action = encode_field_bytes(1, &json_bytes);

    let mut parts = Vec::new();
    parts.extend(encode_field_varint(ENVELOPE_TAG_TYPE, 1));
    parts.extend(encode_field_bytes(ENVELOPE_TAG_MSG_ID, req_id.as_bytes()));

    if let Some(tok) = token {
        if !tok.is_empty() {
            parts.extend(encode_field_bytes(ENVELOPE_TAG_TOKEN, tok.as_bytes()));
        }
    }

    parts.extend(encode_field_bytes(
        ENVELOPE_TAG_SERVER_ACTION,
        &server_action,
    ));
    parts.extend(encode_field_varint(
        ENVELOPE_TAG_TOKEN_TYPE,
        TOKEN_TYPE_PIN_AUTH,
    ));
    parts.extend(encode_field_bytes(
        ENVELOPE_TAG_CLIENT_NAME,
        client_name.as_bytes(),
    ));
    parts.extend(encode_field_varint(ENVELOPE_TAG_IS_REQUEST, 1));
    parts.extend(encode_field_bytes(
        ENVELOPE_TAG_CLIENT_ID,
        client_id.as_bytes(),
    ));

    parts
}

/// Builds pair-init message: field(4, 2, field(1, 2, b""))
pub fn build_pair_init_data() -> Vec<u8> {
    let inner = encode_field_bytes(1, b"");
    encode_field_bytes(OP_PIN_CONNECT, &inner)
}

/// Builds media command data: field(16, 2, field(1, 0, action))
pub fn build_media_cmd_data(action: u64) -> Vec<u8> {
    let inner = encode_field_varint(1, action);
    encode_field_bytes(OP_MEDIA_COMMAND, &inner)
}

/// Builds volume command data: field(14, 2, field(1, 0, percent))
pub fn build_set_volume_data(percent: u32) -> Vec<u8> {
    let clamped = percent.min(100);
    let inner = encode_field_varint(1, clamped as u64);
    encode_field_bytes(OP_SET_VOLUME, &inner)
}

/// Builds seek command data: field(15, 2, field(1, 0, position_seconds))
pub fn build_seek_data(seconds: u64) -> Vec<u8> {
    let inner = encode_field_varint(1, seconds);
    encode_field_bytes(OP_SET_TRACK_POS, &inner)
}

/// Helper to parse balanced JSON object from string
pub fn extract_json_object(s: &str, start: usize) -> Option<&str> {
    let bytes = s.as_bytes();
    let mut depth = 0;
    let mut in_str = false;
    let mut esc = false;

    for i in start..bytes.len() {
        let ch = bytes[i];
        if in_str {
            if esc {
                esc = false;
            } else if ch == b'\\' {
                esc = true;
            } else if ch == b'"' {
                in_str = false;
            }
            continue;
        }

        if ch == b'"' {
            in_str = true;
        } else if ch == b'{' {
            depth += 1;
        } else if ch == b'}' {
            depth -= 1;
            if depth == 0 {
                return std::str::from_utf8(&bytes[start..=i]).ok();
            }
        }
    }
    None
}

/// Helper to find outer "player" object preceding `start`
fn find_outer_player(text: &str, start: usize) -> Option<serde_json::Value> {
    let prefix = &text[..start];
    let player_idx = prefix.rfind("\"player\"")?;
    let remainder = &prefix[player_idx..];
    let open_rel = remainder.find('{')?;
    let open_pos = player_idx + open_rel;
    let json_str = extract_json_object(text, open_pos)?;
    serde_json::from_str(json_str).ok()
}

fn parse_json_u64(v: &serde_json::Value) -> Option<u64> {
    if let Some(n) = v.as_u64() {
        Some(n)
    } else if let Some(f) = v.as_f64() {
        Some(f.max(0.0).round() as u64)
    } else if let Some(s) = v.as_str() {
        s.parse::<f64>().ok().map(|f| f.max(0.0).round() as u64)
    } else {
        None
    }
}

/// Finds and parses track metadata JSON in payload
pub fn parse_track_json(raw: &[u8]) -> Option<SberTrackInfo> {
    let text = String::from_utf8_lossy(raw);

    // Look for "trackId"
    let tid_idx = text.find("\"trackId\"")?;

    // Scan backwards from tid_idx to find the matching opening '{'
    let prefix = &text[..tid_idx];
    let candidate_starts: Vec<usize> = prefix
        .char_indices()
        .filter(|&(_, ch)| ch == '{')
        .map(|(i, _)| i)
        .collect();

    for &start in candidate_starts.iter().rev().take(10) {
        if let Some(json_str) = extract_json_object(&text, start) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                if val.get("trackId").is_some() {
                    // Check if state-format (nested inside player)
                    let outer_player = if val.get("playing").is_none() {
                        find_outer_player(&text, start)
                    } else {
                        None
                    };

                    let title = val
                        .get("title")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let track_id = val.get("trackId").map(|v| {
                        if let Some(s) = v.as_str() {
                            s.to_string()
                        } else if let Some(n) = v.as_u64() {
                            n.to_string()
                        } else {
                            v.to_string()
                        }
                    });

                    let artists = val
                        .get("artists")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|a| {
                                    a.get("name")
                                        .and_then(|n| n.as_str())
                                        .map(|s| s.to_string())
                                })
                                .collect()
                        })
                        .unwrap_or_default();

                    let album = val
                        .get("releases")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|r| r.get("name").or_else(|| r.get("title")))
                        .and_then(|n| n.as_str())
                        .map(|s| s.to_string());

                    let mut duration = val
                        .get("duration")
                        .or_else(|| outer_player.as_ref().and_then(|p| p.get("duration")))
                        .and_then(parse_json_u64);

                    if let Some(d) = duration {
                        if d > 20000 {
                            duration = Some(d / 1000);
                        }
                    }

                    let mut position = None;
                    let mut position_ts_ms = None;
                    if let Some(pos_val) = val.get("position") {
                        if let Some(obj) = pos_val.as_object() {
                            position = obj.get("val").and_then(parse_json_u64);
                            position_ts_ms = obj.get("tsMs").and_then(parse_json_u64);
                        } else {
                            position = parse_json_u64(pos_val);
                        }
                    } else if let Some(ref p) = outer_player {
                        if let Some(pos_val) = p.get("position") {
                            if let Some(obj) = pos_val.as_object() {
                                position = obj.get("val").and_then(parse_json_u64);
                                position_ts_ms = obj.get("tsMs").and_then(parse_json_u64);
                            } else {
                                position = parse_json_u64(pos_val);
                            }
                        }
                        if position_ts_ms.is_none() {
                            position_ts_ms =
                                p.get("stateChangedTimestamp").and_then(parse_json_u64);
                        }
                    }
                    if position_ts_ms.is_none() {
                        position_ts_ms =
                            val.get("stateChangedTimestamp").and_then(parse_json_u64);
                    }

                    if let Some(pos) = position {
                        if pos > 20000 {
                            position = Some(pos / 1000);
                        }
                    }

                    let playing = val
                        .get("playing")
                        .or_else(|| outer_player.as_ref().and_then(|p| p.get("playing")))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    let shuffle = val
                        .get("shuffle")
                        .or_else(|| outer_player.as_ref().and_then(|p| p.get("shuffle")))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    let repeat_type = val
                        .get("repeatType")
                        .or_else(|| outer_player.as_ref().and_then(|p| p.get("repeatType")))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let liked = val.get("like").and_then(|v| v.as_bool()).unwrap_or(false);
                    let provider = val
                        .get("provider")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let now_ms = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);

                    return Some(SberTrackInfo {
                        track_id,
                        title,
                        artists,
                        album,
                        duration,
                        position,
                        position_ts_ms,
                        received_at_ms: now_ms,
                        playing,
                        shuffle,
                        repeat_type,
                        liked,
                        provider,
                    });
                }
            }
        }
    }

    None
}

/// Helper to extract u32 percent from a JSON value (number, float 0..1, string)
fn parse_volume_number(v: &serde_json::Value) -> Option<u32> {
    if let Some(n) = v.as_u64() {
        Some(n.min(100) as u32)
    } else if let Some(f) = v.as_f64() {
        if f <= 1.0 && f > 0.0 {
            Some((f * 100.0).round().min(100.0) as u32)
        } else {
            Some(f.round().min(100.0) as u32)
        }
    } else if let Some(s) = v.as_str() {
        s.parse::<u32>().ok().map(|n| n.min(100))
    } else {
        None
    }
}

/// Recursively inspects a JSON value for volume and mute state
fn extract_volume_and_mute(val: &serde_json::Value) -> (Option<u32>, Option<bool>) {
    let mut volume: Option<u32> = None;
    let mut muted: Option<bool> = None;

    if let Some(obj) = val.as_object() {
        // 1. Direct volume fields
        let vol_keys = [
            "volume",
            "volume_percent",
            "volumePercent",
            "volume_level",
            "volumeLevel",
            "sound",
            "vol",
            "level",
            "percent",
        ];

        for vk in vol_keys {
            if let Some(vol_val) = obj.get(vk) {
                if vol_val.is_object() {
                    if let Some(p) = vol_val
                        .get("percent")
                        .or_else(|| vol_val.get("level"))
                        .or_else(|| vol_val.get("value"))
                        .or_else(|| vol_val.get("current"))
                        .or_else(|| vol_val.get("volume"))
                        .and_then(parse_volume_number)
                    {
                        volume = Some(p);
                    }
                    if let Some(m) = vol_val.get("muted").and_then(|v| v.as_bool()) {
                        muted = Some(m);
                    }
                } else if let Some(p) = parse_volume_number(vol_val) {
                    volume = Some(p);
                }
            }
            if volume.is_some() {
                break;
            }
        }

        // 2. Check container objects: "player", "state", "audio", "device", "status", "media"
        let container_keys = ["player", "state", "audio", "device", "status", "media"];
        for ck in container_keys {
            if let Some(sub) = obj.get(ck) {
                let (sub_vol, sub_mut) = extract_volume_and_mute(sub);
                if volume.is_none() {
                    volume = sub_vol;
                }
                if muted.is_none() {
                    muted = sub_mut;
                }
            }
        }

        // 3. Direct muted field
        if muted.is_none() {
            if let Some(m) = obj.get("muted").or_else(|| obj.get("isMuted")).and_then(|v| v.as_bool()) {
                muted = Some(m);
            }
        }
    }

    (volume, muted)
}

/// Parses speaker volume and muted state from GET_STATE response or push JSON
pub fn parse_state_json(raw: &[u8]) -> Option<SberSpeakerState> {
    let text = String::from_utf8_lossy(raw);

    // 1. First attempt: if there's any opening brace, try extracting from the first '{' (full root JSON)
    if let Some(first_brace) = text.find('{') {
        if let Some(json_str) = extract_json_object(&text, first_brace) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                let (volume, muted) = extract_volume_and_mute(&val);
                if volume.is_some() || muted.is_some() {
                    return Some(SberSpeakerState {
                        volume_percent: volume,
                        muted,
                    });
                }
            }
        }
    }

    // 2. Targeted search for volume-related keys
    let keys = [
        "\"volume\"",
        "\"volume_percent\"",
        "\"volumePercent\"",
        "\"volume_level\"",
        "\"volumeLevel\"",
        "\"sound\"",
        "\"vol\"",
    ];
    for key in keys {
        let mut search_start = 0;
        while let Some(pos) = text[search_start..].find(key) {
            let key_idx = search_start + pos;
            search_start = key_idx + key.len();

            let prefix = &text[..key_idx];
            let candidate_starts: Vec<usize> = prefix
                .char_indices()
                .filter(|&(_, ch)| ch == '{')
                .map(|(i, _)| i)
                .collect();

            for &start in candidate_starts.iter().rev().take(10) {
                if let Some(json_str) = extract_json_object(&text, start) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                        let (volume, muted) = extract_volume_and_mute(&val);
                        if volume.is_some() || muted.is_some() {
                            return Some(SberSpeakerState {
                                volume_percent: volume,
                                muted,
                            });
                        }
                    }
                }
            }
        }
    }

    None
}

/// Parses volume from binary Protobuf/TLV (OP_SET_VOLUME = 14, OP_GET_STATE = 12)
pub fn parse_tlv_volume(raw: &[u8]) -> Option<SberSpeakerState> {
    let decoded = decode_tlv_repeated(raw).ok()?;

    for op in [OP_SET_VOLUME, OP_GET_STATE] {
        if let Some(vol_vals) = decoded.get(&op) {
            for v in vol_vals {
                if let Some(p) = v.as_u64() {
                    return Some(SberSpeakerState {
                        volume_percent: Some(p.min(100) as u32),
                        muted: None,
                    });
                }
                if let Some(nested) = v.as_nested() {
                    if let Some(f1) = nested.get(&1).and_then(|vals| vals.first()).and_then(|val| val.as_u64()) {
                        return Some(SberSpeakerState {
                            volume_percent: Some(f1.min(100) as u32),
                            muted: None,
                        });
                    }
                }
            }
        }
    }

    if let Some(req_data) = decoded.get(&ENVELOPE_TAG_REQUEST_DATA) {
        for rv in req_data {
            if let TlvValue::LengthDelimited(inner) = rv {
                if let Some(st) = parse_tlv_volume(inner) {
                    return Some(st);
                }
            }
        }
    }

    if let Some(sa_data) = decoded.get(&ENVELOPE_TAG_SERVER_ACTION) {
        for sv in sa_data {
            if let TlvValue::LengthDelimited(inner) = sv {
                if let Some(st) = parse_tlv_volume(inner) {
                    return Some(st);
                }
            }
        }
    }

    None
}

/// Parses speaker state from both JSON and TLV formats, checking envelope layers
pub fn parse_speaker_state(raw: &[u8]) -> Option<SberSpeakerState> {
    if let Some(st) = parse_state_json(raw) {
        return Some(st);
    }
    if let Some(st) = parse_tlv_volume(raw) {
        return Some(st);
    }
    // Also decode TLV envelope to check raw JSON payloads in request_data / server_action
    if let Ok(decoded) = decode_tlv_repeated(raw) {
        for tag in [ENVELOPE_TAG_REQUEST_DATA, ENVELOPE_TAG_SERVER_ACTION] {
            if let Some(vals) = decoded.get(&tag) {
                for v in vals {
                    if let TlvValue::LengthDelimited(inner) = v {
                        if let Some(st) = parse_state_json(inner) {
                            return Some(st);
                        }
                    }
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_state_json_nested_volume() {
        let json = r#"{"volume": {"percent": 45, "muted": false}}"#;
        let st = parse_state_json(json.as_bytes()).expect("Should parse nested volume");
        assert_eq!(st.volume_percent, Some(45));
        assert_eq!(st.muted, Some(false));
    }

    #[test]
    fn test_parse_state_json_player_volume() {
        let json = r#"{"player": {"volume": 35, "muted": true}}"#;
        let st = parse_state_json(json.as_bytes()).expect("Should parse player volume");
        assert_eq!(st.volume_percent, Some(35));
        assert_eq!(st.muted, Some(true));
    }

    #[test]
    fn test_parse_state_json_direct_volume() {
        let json = r#"{"volume": 60, "muted": false}"#;
        let st = parse_state_json(json.as_bytes()).expect("Should parse direct volume");
        assert_eq!(st.volume_percent, Some(60));
        assert_eq!(st.muted, Some(false));
    }

    #[test]
    fn test_parse_tlv_volume() {
        let tlv = build_set_volume_data(75);
        let st = parse_tlv_volume(&tlv).expect("Should parse TLV volume");
        assert_eq!(st.volume_percent, Some(75));
    }

    #[test]
    fn test_parse_track_flat_format() {
        let json = r#"
        {
          "artists": [{"id": "703663", "name": "Whitesnake"}],
          "title": "Is This Love",
          "duration": 284,
          "playing": true,
          "position": {"tsMs": 1731610000000, "val": 8},
          "playlistTitle": "Персональная волна",
          "provider": "zvuk",
          "trackId": "66740880",
          "shuffle": false,
          "repeatType": "none",
          "explicit": false,
          "like": true
        }
        "#;
        let info = parse_track_json(json.as_bytes()).expect("Should parse flat track json");
        assert_eq!(info.track_id.as_deref(), Some("66740880"));
        assert_eq!(info.title.as_deref(), Some("Is This Love"));
        assert_eq!(info.artists, vec!["Whitesnake"]);
        assert_eq!(info.duration, Some(284));
        assert_eq!(info.position, Some(8));
        assert!(info.playing);
        assert!(info.liked);
    }

    #[test]
    fn test_parse_track_state_format() {
        let json = r#"
        {
          "player": {
            "playing": true,
            "position": 14,
            "duration": 284,
            "stateChangedTimestamp": 1731610000000,
            "shuffle": true,
            "repeatType": "playlist",
            "info": {
              "trackId": "66740880",
              "title": "Is This Love",
              "artists": [{"name": "Whitesnake"}]
            }
          }
        }
        "#;
        let info = parse_track_json(json.as_bytes()).expect("Should parse state track json");
        assert_eq!(info.track_id.as_deref(), Some("66740880"));
        assert_eq!(info.title.as_deref(), Some("Is This Love"));
        assert_eq!(info.artists, vec!["Whitesnake"]);
        assert_eq!(info.duration, Some(284));
        assert_eq!(info.position, Some(14));
        assert!(info.playing);
        assert!(info.shuffle);
        assert_eq!(info.repeat_type.as_deref(), Some("playlist"));
    }
}
