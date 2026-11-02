use crate::error::AppError;
use crate::models::*;
use crate::token_manager;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;

const GRAPHQL_URL: &str = "https://zvuk.com/api/v1/graphql";
const TINY_API_URL: &str = "https://zvuk.com/api/v2/tiny";
const APP_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/// Formats image source paths returned by Zvuk GraphQL into full resized CDN URLs.
/// Size parameter values: "small" (300x300), "medium" (600x600), "large" (900x900).
pub fn format_image_url(src: &str, width: u32, _height: u32) -> String {
    if src.is_empty() {
        return String::new();
    }
    let base = if src.starts_with('/') {
        format!("https://zvuk.com{}", src)
    } else {
        src.to_string()
    };
    let size_val = if width <= 300 {
        "small"
    } else if width <= 600 {
        "medium"
    } else {
        "large"
    };

    if base.contains("{size}") {
        base.replace("{size}", size_val)
    } else if base.contains("size=") {
        let mut parts = base.split("size=");
        if let Some(prefix) = parts.next() {
            if let Some(rest) = parts.next() {
                let remainder = if let Some(amp_idx) = rest.find('&') {
                    &rest[amp_idx..]
                } else {
                    ""
                };
                format!("{}size={}{}", prefix, size_val, remainder)
            } else {
                base
            }
        } else {
            base
        }
    } else if base.contains('?') {
        format!("{}&size={}", base, size_val)
    } else {
        format!("{}?size={}", base, size_val)
    }
}

/// Check if an HTTP response was blocked by Zvuk's ServicePipe WAF / anti-bot / VPN geo-blocking.
fn is_vpn_or_waf_blocked(status: reqwest::StatusCode, body: &str) -> bool {
    status.as_u16() == 418
        || body.contains("Servicepipe")
        || body.contains("servicepipe")
        || body.contains("Сайт не работает с включённым VPN")
        || body.contains("Что-то мешает загрузке")
        || (status.as_u16() == 403 && body.contains("<html"))
}

/// Helper to parse a GraphQL track object into our `Track` model.
fn parse_track_from_value(item: &Value) -> Option<Track> {
    let id_val = item.get("id")?;
    let id: i64 = match id_val {
        Value::Number(n) => n.as_i64()?,
        Value::String(s) => s.parse().ok()?,
        _ => return None,
    };

    let title = item
        .get("title")
        .and_then(|t| t.as_str())
        .unwrap_or("Без названия")
        .to_string();
    let duration = item
        .get("duration")
        .and_then(|d| d.as_u64())
        .unwrap_or(0) as u32;

    let artists_arr = item.get("artists").and_then(|a| a.as_array());
    let mut artists: Vec<TrackArtist> = Vec::new();
    if let Some(arr) = artists_arr {
        for a in arr {
            let aid = a.get("id").and_then(|i| match i {
                Value::Number(n) => n.as_i64(),
                Value::String(s) => s.parse().ok(),
                _ => None,
            });
            let image_url = a
                .get("image")
                .and_then(|img| img.get("src"))
                .and_then(|s| s.as_str())
                .map(|src| format_image_url(src, 300, 300));
            let palette = a
                .get("image")
                .and_then(|img| img.get("palette"))
                .and_then(|p| p.as_str())
                .map(|s| s.to_string());
            let aname = a
                .get("title")
                .or_else(|| a.get("name"))
                .and_then(|t| t.as_str());
            if let (Some(aid), Some(aname)) = (aid, aname) {
                artists.push(TrackArtist {
                    id: aid,
                    name: aname.to_string(),
                    image_url,
                    palette,
                });
            }
        }
    }

    let artist: String = if !artists.is_empty() {
        artists.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")
    } else {
        "Неизвестный исполнитель".to_string()
    };
    let artist_id = artists.first().map(|a| a.id);

    let release_obj = item.get("release");
    let album = release_obj
        .and_then(|r| r.get("title"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());
    let album_id = release_obj
        .and_then(|r| r.get("id"))
        .and_then(|i| match i {
            Value::Number(n) => n.as_i64(),
            Value::String(s) => s.parse().ok(),
            _ => None,
        });

    let cover_url = release_obj
        .and_then(|r| r.get("image"))
        .and_then(|img| img.get("src"))
        .and_then(|s| s.as_str())
        .map(|src| format_image_url(src, 300, 300));

    let palette = release_obj
        .and_then(|r| r.get("image"))
        .and_then(|img| img.get("palette"))
        .and_then(|p| p.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            artists.iter().find_map(|a| a.palette.clone())
        });

    let release_year = release_obj
        .and_then(|r| r.get("date"))
        .and_then(|d| d.as_str())
        .and_then(|s| s.get(0..4))
        .and_then(|y| y.parse::<u16>().ok());

    let is_explicit = item
        .get("explicit")
        .and_then(|e| e.as_bool())
        .unwrap_or(false);
    let has_flac = item
        .get("hasFlac")
        .and_then(|f| f.as_bool())
        .unwrap_or(false);

    Some(Track {
        id,
        title,
        duration,
        artist,
        artist_id,
        artists,
        album,
        album_id,
        cover_url,
        palette,
        release_year,
        is_explicit,
        is_liked: None,
        has_flac,
    })
}


/// Central HTTP client for all Zvuk API communication.
#[derive(Clone)]
pub struct ZvukApiClient {
    http: reqwest::Client,
    token: Arc<RwLock<Option<String>>>,
    session: Arc<RwLock<Option<AuthSession>>>,
}

impl ZvukApiClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent(APP_USER_AGENT)
            .cookie_store(true)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            http,
            token: Arc::new(RwLock::new(None)),
            session: Arc::new(RwLock::new(None)),
        }
    }

    /// Set the full authentication session.
    pub async fn set_session(&self, session: AuthSession) {
        let token = session.access_token.clone();
        {
            let mut guard = self.token.write().await;
            *guard = Some(token);
        }
        {
            let mut guard = self.session.write().await;
            *guard = Some(session);
        }
    }

    /// Set the auth token (convenience method).
    #[allow(dead_code)]
    pub async fn set_token(&self, token: String) {
        let clean = token.trim().trim_matches('"').to_string();
        let session = AuthSession {
            access_token: clean,
            refresh_token: None,
            device_id: None,
            at: None,
            rt: None,
        };
        self.set_session(session).await;
    }

    /// Clear the auth token and session (logout).
    pub async fn clear_token(&self) {
        let mut guard = self.token.write().await;
        *guard = None;
        let mut s_guard = self.session.write().await;
        *s_guard = None;
    }

    /// Check if we have an active token set.
    #[allow(dead_code)]
    pub async fn has_token(&self) -> bool {
        self.token.read().await.is_some()
    }

    /// Refreshes the authentication session using the Zvuk cookieAPI endpoint.
    pub async fn refresh_session(&self) -> Result<AuthSession, AppError> {
        let current_session = {
            let guard = self.session.read().await;
            guard.clone()
        };

        let session = current_session.ok_or(AppError::Unauthorized)?;
        let rt = session.refresh_token.as_deref().unwrap_or("");
        if rt.is_empty() {
            log::warn!("[Zvuk API] Cannot refresh session: no refresh_token available");
            return Err(AppError::Unauthorized);
        }

        log::info!("[Zvuk API] Attempting token refresh via cookieAPI...");

        let mut cookie_parts = vec![
            format!("refresh_token={}", rt),
            "auth_type=v2".to_string(),
        ];
        if let Some(rt_jwt) = session.rt.as_deref() {
            if !rt_jwt.is_empty() {
                cookie_parts.push(format!("RT={}", rt_jwt));
            }
        }
        if let Some(did) = session.device_id.as_deref() {
            if !did.is_empty() {
                cookie_parts.push(format!("device_id={}", did));
            }
        }

        let cookie_header = cookie_parts.join("; ");
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(APP_USER_AGENT));
        headers.insert(
            reqwest::header::ACCEPT,
            HeaderValue::from_static("application/json, text/plain, */*"),
        );
        headers.insert(
            reqwest::header::ORIGIN,
            HeaderValue::from_static("https://zvuk.com"),
        );
        headers.insert(
            reqwest::header::REFERER,
            HeaderValue::from_static("https://zvuk.com/"),
        );
        if let Ok(c_val) = HeaderValue::from_str(&cookie_header) {
            headers.insert(reqwest::header::COOKIE, c_val);
        }

        let url = "https://zvuk.com/desktop-data/api/cookieAPI";
        let res = self.http.get(url).headers(headers).send().await?;
        let status = res.status();
        let body_text = res.text().await.unwrap_or_default();

        if is_vpn_or_waf_blocked(status, &body_text) {
            return Err(AppError::VpnBlocked);
        }

        if !status.is_success() {
            log::warn!("[Zvuk API] Refresh failed with status: {}", status);
            return Err(AppError::Unauthorized);
        }

        let json: Value = match serde_json::from_str(&body_text) {
            Ok(j) => j,
            Err(e) => {
                log::warn!("[Zvuk API] Failed to parse cookieAPI response (WAF?): {}", e);
                return Err(AppError::Unauthorized);
            }
        };

        let new_access_token = json
            .get("auth")
            .or_else(|| json.get("access_token"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Internal("No auth token returned by cookieAPI".into()))?
            .to_string();

        let new_refresh_token = json
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or(session.refresh_token);

        let new_device_id = json
            .get("device_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or(session.device_id);

        let new_at = json
            .get("AT")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let new_rt = json
            .get("RT")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or(session.rt);

        let new_session = AuthSession {
            access_token: new_access_token.clone(),
            refresh_token: new_refresh_token,
            device_id: new_device_id,
            at: new_at,
            rt: new_rt,
        };

        self.set_session(new_session.clone()).await;
        let _ = token_manager::store_session(&new_session);

        log::info!(
            "[Zvuk API] Token refreshed successfully: {}...",
            &new_access_token[..8.min(new_access_token.len())]
        );
        Ok(new_session)
    }

    /// Fetch a fresh anonymous guest token from Zvuk.
    pub async fn fetch_anonymous_token(&self) -> Result<String, AppError> {
        let url = format!("{}/profile", TINY_API_URL);
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static(APP_USER_AGENT));
        headers.insert(
            reqwest::header::ACCEPT,
            HeaderValue::from_static("application/json, text/plain, */*"),
        );
        headers.insert(
            reqwest::header::ORIGIN,
            HeaderValue::from_static("https://zvuk.com"),
        );
        headers.insert(
            reqwest::header::REFERER,
            HeaderValue::from_static("https://zvuk.com/"),
        );

        let res = self.http.get(&url).headers(headers).send().await?;
        let status = res.status();
        let body_text = res.text().await.unwrap_or_default();

        if is_vpn_or_waf_blocked(status, &body_text) {
            return Err(AppError::VpnBlocked);
        }

        if !status.is_success() {
            return Err(AppError::Api {
                status: status.as_u16(),
                message: format!("Failed to fetch guest token (HTTP {})", status),
            });
        }

        let json: Value = serde_json::from_str(&body_text)
            .map_err(|e| AppError::Internal(format!("Failed to parse guest token: {}", e)))?;

        let token = json
            .get("result")
            .and_then(|r| {
                r.get("profile")
                    .and_then(|p| p.get("token"))
                    .or_else(|| r.get("token"))
            })
            .and_then(|t| t.as_str())
            .ok_or_else(|| AppError::Internal("Failed to extract guest token from Zvuk".into()))?;

        log::info!("[Zvuk API] Generated guest token: {}...", &token[..8.min(token.len())]);
        Ok(token.to_string())
    }

    /// Ensure that an authorization token is available (user token or guest fallback).
    pub async fn ensure_token(&self) -> Result<String, AppError> {
        {
            let guard = self.token.read().await;
            if let Some(t) = guard.as_ref() {
                if !t.is_empty() {
                    return Ok(t.clone());
                }
            }
        }

        let anon = self.fetch_anonymous_token().await?;
        let mut guard = self.token.write().await;
        *guard = Some(anon.clone());
        Ok(anon)
    }

    /// Build standard Zvuk headers with `X-Auth-Token`.
    async fn auth_headers(&self) -> Result<HeaderMap, AppError> {
        let token = self.ensure_token().await?;
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-auth-token",
            HeaderValue::from_str(&token).map_err(|e| AppError::Internal(e.to_string()))?,
        );
        headers.insert(USER_AGENT, HeaderValue::from_static(APP_USER_AGENT));
        headers.insert(
            reqwest::header::ORIGIN,
            HeaderValue::from_static("https://zvuk.com"),
        );
        headers.insert(
            reqwest::header::REFERER,
            HeaderValue::from_static("https://zvuk.com/"),
        );
        headers.insert(
            reqwest::header::ACCEPT,
            HeaderValue::from_static("application/json, text/plain, */*"),
        );

        Ok(headers)
    }

    /// Generic GraphQL query executor with optional operation name and auto-refresh on 401.
    pub async fn graphql_op(
        &self,
        query: &str,
        variables: Value,
        operation_name: Option<&str>,
    ) -> Result<Value, AppError> {
        let headers = self.auth_headers().await?;
        let mut payload = serde_json::json!({
            "query": query,
            "variables": variables,
        });
        if let Some(op) = operation_name {
            payload["operationName"] = serde_json::json!(op);
        }

        let response = self
            .http
            .post(GRAPHQL_URL)
            .headers(headers)
            .json(&payload)
            .send()
            .await?;

        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            log::warn!("[GraphQL] 401 Unauthorized for query. Attempting silent session refresh...");
            if self.refresh_session().await.is_ok() {
                let retry_headers = self.auth_headers().await?;
                let retry_res = self
                    .http
                    .post(GRAPHQL_URL)
                    .headers(retry_headers)
                    .json(&payload)
                    .send()
                    .await?;
                if retry_res.status().is_success() {
                    let body_text = retry_res.text().await.unwrap_or_default();
                    let json: Value = serde_json::from_str(&body_text)?;
                    let data = json.get("data").cloned().unwrap_or(Value::Null);
                    return Ok(data);
                }
            }
            return Err(AppError::Unauthorized);
        }

        let body_text = response.text().await.unwrap_or_default();
        if is_vpn_or_waf_blocked(status, &body_text) {
            return Err(AppError::VpnBlocked);
        }

        let json: Value = match serde_json::from_str(&body_text) {
            Ok(j) => j,
            Err(e) => {
                println!("[GraphQL] JSON parse error: {}. Body: {}", e, body_text);
                return Err(AppError::Internal(e.to_string()));
            }
        };

        if let Some(errors) = json.get("errors").and_then(|e| e.as_array()) {
            if !errors.is_empty() {
                println!("[GraphQL Errors] {:?}", errors);
                log::warn!("[GraphQL Errors] {:?}", errors);
            }
        }

        let data = json.get("data").cloned().unwrap_or(Value::Null);
        Ok(data)
    }

    /// Generic GraphQL query executor.
    pub async fn graphql(&self, query: &str, variables: Value) -> Result<Value, AppError> {
        self.graphql_op(query, variables, None).await
    }

    // ─── Auth / Profile ─────────────────────────────────────────────────

    /// Fetches current user subscription details (SberPrime, expiration date, etc.)
    pub async fn get_subscription(&self) -> Result<Option<Subscription>, AppError> {
        let query = r#"query getSubscriptions($status: [ActualUserSubscriptionStatus!]) {
  subscriptions(status: $status) {
    mainSubscription {
      id
      name
      isPrime
      status
      startDate
      expirationDate
      isTrial
      category
      platform
      options
      subscriptionType {
        price
      }
      price
      ageCategory
      hasRecurrent
    }
    secondarySubscriptions {
      id
      name
      isPrime
      status
      startDate
      expirationDate
      isTrial
      category
      platform
      options
      subscriptionType {
        price
      }
      price
      ageCategory
      hasRecurrent
    }
  }
}"#;

        let variables = serde_json::json!({
            "status": ["confirmed", "pending"]
        });

        let data = self
            .graphql_op(query, variables, Some("getSubscriptions"))
            .await?;

        let subs_obj = data.get("subscriptions");
        let candidate = subs_obj
            .and_then(|s| s.get("mainSubscription"))
            .filter(|v| !v.is_null())
            .or_else(|| {
                subs_obj
                    .and_then(|s| s.get("secondarySubscriptions"))
                    .and_then(|arr| arr.as_array())
                    .and_then(|arr| arr.first())
                    .filter(|v| !v.is_null())
            });

        if let Some(sub) = candidate {
            let is_prime = sub.get("isPrime").and_then(|v| v.as_bool()).unwrap_or(false);
            let expiration_date = sub
                .get("expirationDate")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let status = sub.get("status").and_then(|v| v.as_str()).unwrap_or("");
            let is_active = status == "confirmed" || status == "pending" || is_prime;
            let name = sub.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());

            return Ok(Some(Subscription {
                is_prime,
                expiration_date,
                plan: if is_prime {
                    Some("СберПрайм".to_string())
                } else {
                    name
                },
                is_active,
                is_hifi: is_prime || is_active,
            }));
        }

        Ok(None)
    }

    /// Validate the current token and return user profile details.
    pub async fn get_profile(&self) -> Result<UserProfile, AppError> {
        let headers = self.auth_headers().await?;
        let url = format!("{}/profile", TINY_API_URL);

        let response = self.http.get(&url).headers(headers).send().await?;
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();

        if is_vpn_or_waf_blocked(status, &body_text) {
            return Err(AppError::VpnBlocked);
        }

        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Unauthorized);
        }

        if !status.is_success() {
            return Err(AppError::Api {
                status: status.as_u16(),
                message: format!("Profile request failed with status {}", status),
            });
        }

        let data: Value = serde_json::from_str(&body_text)
            .map_err(|e| AppError::Internal(format!("Failed to parse profile JSON: {}", e)))?;

        let target = if let Some(p) = data.get("result").and_then(|r| r.get("profile")).filter(|v| v.is_object()) {
            p
        } else if let Some(res) = data.get("result").filter(|v| v.is_object()) {
            res
        } else {
            &data
        };

        let mut profile: UserProfile = serde_json::from_value(target.clone())
            .map_err(|e| AppError::Internal(format!("Failed to parse profile: {}", e)))?;

        // Enrich profile with subscription details from GraphQL
        if !profile.is_anonymous {
            if let Ok(Some(sub)) = self.get_subscription().await {
                profile.subscription = Some(sub);
            }
        }

        Ok(profile)
    }

    // ─── Audio Stream ───────────────────────────────────────────────────

    fn stream_debug_log(msg: &str) {
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open("stream_debug.log")
        {
            use std::io::Write;
            let _ = writeln!(f, "[STREAM_DEBUG] {}", msg);
        }
        log::info!("[STREAM_DEBUG] {}", msg);
    }

    /// Probes the stream URL header (up to 4096 bytes) to extract accurate container codec,
    /// sample rate (Hz), bit depth (bits per sample), channels, and bitrate directly from file headers.
    pub async fn probe_stream_metadata(
        &self,
        url: &str,
    ) -> (String, Option<u32>, Option<u32>, Option<u8>, Option<u8>) {
        Self::stream_debug_log(&format!("probe_stream_metadata: probing URL: {}", url));
        let mut codec = "MP3".to_string();
        let mut bitrate: Option<u32> = None;
        let mut sample_rate: Option<u32> = None;
        let mut bit_depth: Option<u8> = None;
        let mut channels: Option<u8> = None;

        // Probe first 4096 bytes with a quick 2.5-second timeout
        let client = &self.http;
        let probe_res = tokio::time::timeout(
            std::time::Duration::from_millis(2500),
            client
                .get(url)
                .header(USER_AGENT, APP_USER_AGENT)
                .header(reqwest::header::REFERER, "https://zvuk.com/")
                .header("Range", "bytes=0-4096")
                .send(),
        )
        .await;

        match &probe_res {
            Ok(Ok(resp)) => {
                Self::stream_debug_log(&format!("probe HTTP status: {}", resp.status()));
            }
            Ok(Err(e)) => {
                Self::stream_debug_log(&format!("probe HTTP error: {}", e));
            }
            Err(_) => {
                Self::stream_debug_log("probe timed out (2500ms)");
            }
        }

        if let Ok(Ok(resp)) = probe_res {
            let total_size_from_range = resp
                .headers()
                .get("Content-Range")
                .and_then(|h| h.to_str().ok())
                .and_then(|s| s.split('/').last())
                .and_then(|len_str| len_str.parse::<u64>().ok())
                .or_else(|| resp.content_length());

            if let Ok(bytes) = resp.bytes().await {
                Self::stream_debug_log(&format!(
                    "probe received {} bytes, first 16 bytes: {:02X?}",
                    bytes.len(),
                    &bytes[..std::cmp::min(bytes.len(), 16)]
                ));
                // Check if HLS Playlist ('#EXTM3U' signature or .m3u8 URL)
                if bytes.starts_with(b"#EXTM3U") || url.contains(".m3u8") {
                    let manifest_text = String::from_utf8_lossy(&bytes);

                    // Parse HLS variant streams
                    struct VariantStream {
                        bandwidth: u32,
                        codecs: String,
                        uri: String,
                    }
                    let mut variants = Vec::new();
                    let lines: Vec<&str> = manifest_text.lines().map(|l| l.trim()).collect();
                    for (i, line) in lines.iter().enumerate() {
                        if line.starts_with("#EXT-X-STREAM-INF:") {
                            let mut bw = 0u32;
                            let mut codecs = String::new();
                            let inf_content = &line["#EXT-X-STREAM-INF:".len()..];
                            for part in inf_content.split(',') {
                                let part = part.trim();
                                if let Some(stripped) = part.strip_prefix("BANDWIDTH=") {
                                    let num_str: String = stripped.chars().take_while(|c| c.is_ascii_digit()).collect();
                                    if let Ok(b) = num_str.parse::<u32>() {
                                        bw = b;
                                    }
                                } else if let Some(stripped) = part.strip_prefix("CODECS=") {
                                    codecs = stripped.trim_matches('"').to_string();
                                }
                            }
                            let uri = if i + 1 < lines.len() && !lines[i + 1].starts_with('#') {
                                lines[i + 1].to_string()
                            } else {
                                String::new()
                            };
                            variants.push(VariantStream { bandwidth: bw, codecs, uri });
                        }
                    }

                    // Look for FLAC/Lossless stream first
                    let flac_var = variants.iter().find(|v| {
                        v.codecs.to_lowercase().contains("flac")
                            || v.uri.to_lowercase().contains("lossless")
                            || v.uri.to_lowercase().contains("flac")
                    });

                    if let Some(f) = flac_var {
                        codec = "FLAC".to_string();
                        sample_rate = Some(44100);
                        bit_depth = Some(16);
                        channels = Some(2);
                        if f.bandwidth > 0 {
                            bitrate = Some((f.bandwidth + 500) / 1000);
                        } else {
                            bitrate = Some(920);
                        }
                    } else if !variants.is_empty() {
                        // Pick the highest bandwidth AAC/MP3 variant
                        if let Some(best) = variants.iter().max_by_key(|v| v.bandwidth) {
                            codec = if best.codecs.to_lowercase().contains("mp4a") {
                                "AAC".to_string()
                            } else {
                                "MP3".to_string()
                            };
                            sample_rate = Some(44100);
                            bit_depth = Some(16);
                            channels = Some(2);
                            if best.bandwidth > 0 {
                                bitrate = Some((best.bandwidth + 500) / 1000);
                            }
                        }
                    } else if manifest_text.contains("fLaC")
                        || manifest_text.contains("slossless")
                        || manifest_text.contains("lossless")
                    {
                        codec = "FLAC".to_string();
                        sample_rate = Some(44100);
                        bit_depth = Some(16);
                        channels = Some(2);
                        bitrate = Some(920);
                    } else {
                        codec = "AAC".to_string();
                        sample_rate = Some(44100);
                        bit_depth = Some(16);
                        channels = Some(2);
                        bitrate = Some(256);
                    }
                } else if bytes.len() >= 42 && bytes.starts_with(b"fLaC") {
                    codec = "FLAC".to_string();
                    let is_streaminfo = (bytes[4] & 0x7F) == 0;
                    if is_streaminfo && bytes.len() >= 42 {
                        let info = &bytes[8..];
                        let b10 = info[10] as u32;
                        let b11 = info[11] as u32;
                        let b12 = info[12] as u32;
                        let parsed_sr = (b10 << 12) | (b11 << 4) | (b12 >> 4);
                        let parsed_ch = (((b12 >> 1) & 0x07) + 1) as u8;

                        let b13 = info[13] as u32;
                        let parsed_bd = ((((b12 & 0x01) << 4) | (b13 >> 4)) + 1) as u8;

                        let b14 = info[14] as u64;
                        let b15 = info[15] as u64;
                        let b16 = info[16] as u64;
                        let b17 = info[17] as u64;
                        let total_samples = (((b13 & 0x0F) as u64) << 32)
                            | (b14 << 24)
                            | (b15 << 16)
                            | (b16 << 8)
                            | b17;

                        if parsed_sr > 0 {
                            sample_rate = Some(parsed_sr);
                        }
                        if parsed_ch > 0 {
                            channels = Some(parsed_ch);
                        }
                        if parsed_bd > 0 {
                            bit_depth = Some(parsed_bd);
                        }

                        // Calculate compressed bitrate if total size and duration are known
                        if let (Some(total_bytes), true) = (total_size_from_range, total_samples > 0 && parsed_sr > 0) {
                            let duration_sec = total_samples as f64 / parsed_sr as f64;
                            if duration_sec > 1.0 {
                                let calc_kbps = ((total_bytes as f64 * 8.0) / (duration_sec * 1000.0)).round() as u32;
                                if calc_kbps > 200 && calc_kbps < 10000 {
                                    bitrate = Some(calc_kbps);
                                }
                            }
                        }
                        if bitrate.is_none() && parsed_sr > 0 && parsed_bd > 0 && parsed_ch > 0 {
                            bitrate = Some((parsed_sr * (parsed_bd as u32) * (parsed_ch as u32)) / 1000);
                        }
                    }
                } else if bytes.len() >= 8 && (&bytes[4..8] == b"ftyp" || &bytes[4..8] == b"styp") {
                    // MP4 container (fMP4 / ISO BMFF)
                    if let Some(pos) = bytes.windows(4).position(|w| w == b"dfLa") {
                        codec = "FLAC".to_string();
                        let streaminfo_offset = pos + 4 + 4 + 4;
                        if bytes.len() >= streaminfo_offset + 18 {
                            let info = &bytes[streaminfo_offset..];
                            let b10 = info[10] as u32;
                            let b11 = info[11] as u32;
                            let b12 = info[12] as u32;
                            let parsed_sr = (b10 << 12) | (b11 << 4) | (b12 >> 4);
                            let parsed_ch = (((b12 >> 1) & 0x07) + 1) as u8;
                            let b13 = info[13] as u32;
                            let parsed_bd = ((((b12 & 0x01) << 4) | (b13 >> 4)) + 1) as u8;

                            if parsed_sr > 0 { sample_rate = Some(parsed_sr); }
                            if parsed_ch > 0 { channels = Some(parsed_ch); }
                            if parsed_bd > 0 { bit_depth = Some(parsed_bd); }
                        }
                        if sample_rate.is_none() { sample_rate = Some(44100); }
                        if channels.is_none() { channels = Some(2); }
                        if bit_depth.is_none() { bit_depth = Some(16); }

                        // Check btrt box for average bitrate
                        if let Some(bpos) = bytes.windows(4).position(|w| w == b"btrt") {
                            if bytes.len() >= bpos + 4 + 12 {
                                let avg_bw = u32::from_be_bytes([bytes[bpos + 12], bytes[bpos + 13], bytes[bpos + 14], bytes[bpos + 15]]);
                                if avg_bw > 0 {
                                    bitrate = Some((avg_bw + 500) / 1000);
                                }
                            }
                        }
                        if bitrate.is_none() {
                            bitrate = Some(920);
                        }
                    } else if bytes.windows(4).any(|w| w == b"fLaC" || w == b"flac") {
                        codec = "FLAC".to_string();
                        bit_depth = Some(16);
                        sample_rate = Some(44100);
                        channels = Some(2);
                        bitrate = Some(920);
                    } else {
                        codec = "AAC".to_string();
                        bit_depth = Some(16);
                        sample_rate = Some(44100);
                        channels = Some(2);
                        bitrate = Some(256);
                    }
                } else if bytes.len() >= 10 {
                    codec = "MP3".to_string();
                    bit_depth = Some(16);

                    // Scan for MPEG sync word 0xFFE0
                    for i in 0..bytes.len().saturating_sub(4) {
                        if bytes[i] == 0xFF && (bytes[i + 1] & 0xE0) == 0xE0 {
                            let header = u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
                            let version = (header >> 19) & 0x03; // 3 = MPEG-1
                            let layer = (header >> 17) & 0x03;   // 1 = Layer III (MP3)
                            let bitrate_idx = ((header >> 12) & 0x0F) as usize;
                            let sampling_idx = ((header >> 10) & 0x03) as usize;
                            let channel_mode = (header >> 6) & 0x03;

                            if version == 3 && layer == 1 && bitrate_idx > 0 && bitrate_idx < 15 {
                                const MPEG1_L3_BITRATES: [u32; 15] = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
                                const MPEG1_SAMPLERATES: [u32; 3] = [44100, 48000, 32000];

                                if let Some(&br) = MPEG1_L3_BITRATES.get(bitrate_idx) {
                                    if br > 0 {
                                        bitrate = Some(br);
                                    }
                                }
                                if let Some(&sr) = MPEG1_SAMPLERATES.get(sampling_idx) {
                                    sample_rate = Some(sr);
                                }
                                channels = Some(if channel_mode == 3 { 1 } else { 2 });
                                break;
                            }
                        }
                    }
                }
            }
        }

        Self::stream_debug_log(&format!(
            "probe result: codec={}, bitrate={:?}, sample_rate={:?}, bit_depth={:?}, channels={:?}",
            codec, bitrate, sample_rate, bit_depth, channels
        ));

        (codec, bitrate, sample_rate, bit_depth, channels)
    }

    /// Resolves stream URL for playback via official GraphQL getStream.
    pub async fn get_stream_url(&self, id: i64, quality: &str) -> Result<StreamInfo, AppError> {
        let q_lower = quality.to_lowercase();
        Self::stream_debug_log(&format!("get_stream_url called: id={}, quality={}", id, quality));

        // Query official GraphQL getStream directly
        let (quality_val, encode_val, use_hls_val) = if q_lower == "flac" {
            (Some("hifi"), Some("wv"), true)
        } else {
            (None, None, false)
        };

        let query = r#"
            query getStream($ids: [ID!]!, $quality: String, $encodeType: String, $useHLSv2: Boolean!) {
                mediaContents(ids: $ids, quality: $quality, encodeType: $encodeType) {
                    __typename
                    ... on Track {
                        stream {
                            expire
                            high
                            mid
                            preview
                        }
                        streamV3 @include(if: $useHLSv2) {
                            expire
                            hls
                        }
                    }
                    ... on Episode {
                        stream {
                            expire
                            mid
                        }
                    }
                    ... on Chapter {
                        stream {
                            expire
                            mid
                        }
                    }
                }
            }
        "#;
        let variables = serde_json::json!({
            "ids": [id.to_string()],
            "quality": quality_val,
            "encodeType": encode_val,
            "useHLSv2": use_hls_val
        });
        let data = self
            .graphql_op(query, variables, Some("getStream"))
            .await?;

        if let Some(track_item) = data
            .get("mediaContents")
            .and_then(|m| m.get(0))
        {
            let stream_obj = track_item.get("stream");
            let hls_candidate = track_item
                .get("streamV3")
                .and_then(|v3| v3.get("hls"))
                .and_then(|h| h.as_str());

            let url_candidate = if q_lower == "flac" && hls_candidate.is_some() {
                hls_candidate
            } else if q_lower == "high" || q_lower == "flac" {
                stream_obj
                    .and_then(|s| s.get("high"))
                    .and_then(|h| h.as_str())
                    .or_else(|| stream_obj.and_then(|s| s.get("mid")).and_then(|m| m.as_str()))
            } else {
                stream_obj
                    .and_then(|s| s.get("mid"))
                    .and_then(|m| m.as_str())
                    .or_else(|| stream_obj.and_then(|s| s.get("high")).and_then(|h| h.as_str()))
            };

            if let Some(url) = url_candidate {
                let (codec, bitrate, sample_rate, bit_depth, channels) =
                    self.probe_stream_metadata(url).await;

                let effective_quality = if codec == "FLAC" {
                    StreamQuality::Flac
                } else if bitrate.unwrap_or(0) >= 320 {
                    StreamQuality::High
                } else {
                    StreamQuality::Mid
                };

                return Ok(StreamInfo {
                    url: url.to_string(),
                    quality: effective_quality,
                    codec,
                    bitrate,
                    is_drm: false,
                    license_url: None,
                    sample_rate,
                    bit_depth,
                    channels,
                });
            }
        }

        Err(AppError::NotFound(format!(
            "Аудиопоток для трека {} недоступен",
            id
        )))
    }

    const ZVUK_CIPHER_MASTER_KEY: &'static [u8] = b"T4vNqK8sR2pHcZ6mL9xWjD3yF7gBqA1t";
    const ZVUK_SALT_CHARS: &'static [u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    /// Generates a random 8-character alphanumeric salt for the keyserver X-Encrypted-Key header.
    fn generate_key_salt() -> String {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut state = (now as u64) ^ 0x517cc1b727220a95;
        (0..8)
            .map(|i| {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1 + (i as u64));
                let idx = ((state >> 33) as usize) % Self::ZVUK_SALT_CHARS.len();
                Self::ZVUK_SALT_CHARS[idx] as char
            })
            .collect()
    }

    fn zvuk_derive_seed(key: &[u8], salt: &[u8]) -> u64 {
        let mut t: u64 = 0xcbf29ce484222325;
        for &b in key.iter().chain(salt.iter()) {
            t ^= b as u64;
            t = t.wrapping_mul(1099511628211);
        }
        let mut n = t.wrapping_add(0x9e3779b97f4a7c15);
        n ^= n >> 30;
        n = n.wrapping_mul(0xbf58476d1ce4e5b9);
        n ^= n >> 27;
        n = n.wrapping_mul(0x94d049bb133111eb);
        n ^= n >> 31;
        n
    }

    fn zvuk_xorshift64star(mut e: u64) -> u64 {
        e ^= e >> 12;
        e ^= e << 25;
        e ^= e >> 27;
        e.wrapping_mul(0x2545f4914f6cdd1d)
    }

    /// Decrypts the 16-byte keyserver response using Zvuk's custom stream cipher.
    pub fn decrypt_audio_key(data: &[u8], salt: &str) -> Vec<u8> {
        let mut seed = Self::zvuk_derive_seed(Self::ZVUK_CIPHER_MASTER_KEY, salt.as_bytes());
        let mut out = vec![0u8; data.len()];

        for (e, &byte) in data.iter().enumerate() {
            seed = Self::zvuk_xorshift64star(seed ^ (e as u64));
            let r = ((seed >> 56) & 0xff) as u8;
            let o = (seed & 7) as u32;

            let n = byte.rotate_right(o).wrapping_sub(r);
            out[e] = n;
            seed ^= byte as u64;
        }

        out
    }

    /// Fetches and decrypts the 16-byte AES-128 decryption key for HLS streams via authenticated backend.
    pub async fn fetch_audio_key(&self, url: &str, encrypted_key: Option<&str>) -> Result<Vec<u8>, AppError> {
        let salt = match encrypted_key {
            Some(s) if !s.trim().is_empty() => s.to_string(),
            _ => Self::generate_key_salt(),
        };

        Self::stream_debug_log(&format!("fetch_audio_key: requesting key from {} with salt={}", url, salt));
        
        let mut headers = self.auth_headers().await?;
        if let Ok(hv) = HeaderValue::from_str(&salt) {
            headers.insert("X-Encrypted-Key", hv);
        }

        Self::stream_debug_log(&format!("fetch_audio_key: target URL {}", url));
        let res = self.http.get(url).headers(headers).send().await?;
        let status = res.status();
        Self::stream_debug_log(&format!("fetch_audio_key: HTTP status {}", status));
        if status.is_success() {
            let bytes = res.bytes().await?;
            Self::stream_debug_log(&format!("fetch_audio_key: received {} encrypted bytes from keyserver", bytes.len()));
            
            let decrypted_key = Self::decrypt_audio_key(&bytes, &salt);
            Self::stream_debug_log(&format!(
                "fetch_audio_key: successfully decrypted 16-byte key: {:02X?}",
                decrypted_key.as_slice()
            ));
            Ok(decrypted_key)
        } else {
            let body = res.text().await.unwrap_or_default();
            Self::stream_debug_log(&format!("fetch_audio_key error: status={}, body={}", status, &body[..std::cmp::min(body.len(), 200)]));
            Err(AppError::Api {
                status: status.as_u16(),
                message: format!("Keyserver error {}", status),
            })
        }
    }

    // ─── Search ─────────────────────────────────────────────────────────

    /// Unified search across tracks, albums, artists, and playlists.
    /// Unified search across tracks, albums, artists, and playlists.
    pub async fn search(&self, query: &str) -> Result<SearchResults, AppError> {
        let gql = r#"
            query search($query: String, $limit: Int) {
                search(query: $query) {
                    tracks(limit: $limit) {
                        items {
                            id
                            title
                            duration
                            explicit
                            hasFlac
                            artists { id title }
                            release { id title date image { src } }
                        }
                    }
                    artists(limit: 20) {
                        items {
                            id
                            title
                            image { src }
                        }
                    }
                    releases(limit: 20) {
                        items {
                            id
                            title
                            date
                            image { src }
                            artists { id title }
                            tracks { id }
                        }
                    }
                    playlists(limit: 20) {
                        items {
                            id
                            title
                            description
                            image { src }
                        }
                    }
                }
            }
        "#;

        let data = self
            .graphql(gql, serde_json::json!({ "query": query, "limit": 50 }))
            .await?;

        let search_obj = data.get("search");

        let mut tracks = Vec::new();
        let mut albums = Vec::new();
        let mut artists = Vec::new();
        let mut playlists = Vec::new();

        if let Some(track_items) = search_obj
            .and_then(|s| s.get("tracks"))
            .and_then(|t| t.get("items"))
            .and_then(|i| i.as_array())
        {
            for item in track_items {
                if let Some(t) = parse_track_from_value(item) {
                    tracks.push(t);
                }
            }
        }

        if let Some(artist_items) = search_obj
            .and_then(|s| s.get("artists"))
            .and_then(|a| a.get("items"))
            .and_then(|i| i.as_array())
        {
            for item in artist_items {
                if let Some(id) = item.get("id").and_then(|i| match i {
                    Value::Number(n) => n.as_i64(),
                    Value::String(s) => s.parse().ok(),
                    _ => None,
                }) {
                    let name = item
                        .get("title")
                        .and_then(|t| t.as_str())
                        .unwrap_or("Исполнитель")
                        .to_string();
                    let avatar_url = item
                        .get("image")
                        .and_then(|img| img.get("src"))
                        .and_then(|s| s.as_str())
                        .map(|src| format_image_url(src, 300, 300));
                    artists.push(Artist {
                        id,
                        name,
                        avatar_url,
                        description: None,
                        albums: None,
                        top_tracks: None,
                    });
                }
            }
        }

        if let Some(release_items) = search_obj
            .and_then(|s| s.get("releases"))
            .and_then(|r| r.get("items"))
            .and_then(|i| i.as_array())
        {
            for item in release_items {
                if let Some(id) = item.get("id").and_then(|i| match i {
                    Value::Number(n) => n.as_i64(),
                    Value::String(s) => s.parse().ok(),
                    _ => None,
                }) {
                    let title = item
                        .get("title")
                        .and_then(|t| t.as_str())
                        .unwrap_or("Альбом")
                        .to_string();
                    let mut album_artists: Vec<TrackArtist> = Vec::new();
                    if let Some(arr) = item.get("artists").and_then(|a| a.as_array()) {
                        for a in arr {
                            let aid = a.get("id").and_then(|i| match i {
                                Value::Number(n) => n.as_i64(),
                                Value::String(s) => s.parse().ok(),
                                _ => None,
                            });
                            let aname = a
                                .get("title")
                                .or_else(|| a.get("name"))
                                .and_then(|t| t.as_str());
                            if let (Some(aid), Some(aname)) = (aid, aname) {
                                album_artists.push(TrackArtist {
                                    id: aid,
                                    name: aname.to_string(),
                                    image_url: None,
                                    palette: None,
                                });
                            }
                        }
                    }

                    let artist = if !album_artists.is_empty() {
                        album_artists.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")
                    } else {
                        "Исполнитель".to_string()
                    };
                    let artist_id = album_artists.first().map(|a| a.id);
                    let cover_url = item
                        .get("image")
                        .and_then(|img| img.get("src"))
                        .and_then(|s| s.as_str())
                        .map(|src| format_image_url(src, 300, 300));
                    let release_year = item
                        .get("date")
                        .and_then(|d| d.as_str())
                        .and_then(|s| s.get(0..4))
                        .and_then(|y| y.parse::<u16>().ok());
                    let track_count = item
                        .get("tracks")
                        .and_then(|t| t.as_array())
                        .map(|arr| arr.len() as u32)
                        .unwrap_or(0);

                    albums.push(Album {
                        id,
                        title,
                        artist,
                        artist_id,
                        artists: album_artists,
                        cover_url,
                        release_year,
                        track_count,
                        tracks: None,
                        is_liked: None,
                    });

                }
            }
        }

        if let Some(playlist_items) = search_obj
            .and_then(|s| s.get("playlists"))
            .and_then(|p| p.get("items"))
            .and_then(|i| i.as_array())
        {
            for item in playlist_items {
                if let Some(id) = item.get("id").and_then(|i| match i {
                    Value::Number(n) => n.as_i64(),
                    Value::String(s) => s.parse().ok(),
                    _ => None,
                }) {
                    let title = item
                        .get("title")
                        .and_then(|t| t.as_str())
                        .unwrap_or("Плейлист")
                        .to_string();
                    let description = item
                        .get("description")
                        .and_then(|d| d.as_str())
                        .map(|s| s.to_string());
                    let cover_url = item
                        .get("image")
                        .and_then(|img| img.get("src"))
                        .and_then(|s| s.as_str())
                        .map(|src| format_image_url(src, 300, 300));
                    let duration = item
                        .get("duration")
                        .and_then(|d| d.as_u64())
                        .unwrap_or(0) as u32;

                    let is_public = item
                        .get("isPublic")
                        .or_else(|| item.get("is_public"))
                        .and_then(|v| v.as_bool());

                    playlists.push(Playlist {
                        id,
                        title,
                        description,
                        cover_url,
                        cover_urls: None,
                        track_count: 0,
                        duration,
                        is_editable: false,
                        is_public,
                        owner: None,
                        tracks: None,
                        track_ids: None,
                    });
                }
            }
        }

        Ok(SearchResults {
            tracks,
            albums,
            artists,
            playlists,
        })
    }

    /// Autocomplete search for instant drop-down results.
    pub async fn autocomplete(&self, query: &str) -> Result<Vec<AutocompleteResult>, AppError> {
        let gql = r#"
            query quickSearch($query: String, $limit: Int) {
                quickSearch(query: $query, limit: $limit) {
                    content {
                        __typename
                        ... on Track { id title }
                        ... on Artist { id title }
                        ... on Release { id title }
                        ... on Playlist { id title }
                    }
                }
            }
        "#;

        let data = self
            .graphql(gql, serde_json::json!({ "query": query, "limit": 10 }))
            .await?;

        let mut results = Vec::new();
        if let Some(items) = data
            .get("quickSearch")
            .and_then(|qs| qs.get("content"))
            .and_then(|c| c.as_array())
        {
            for item in items {
                let id = item.get("id").and_then(|i| match i {
                    Value::Number(n) => n.as_i64(),
                    Value::String(s) => s.parse().ok(),
                    _ => None,
                });
                let text = item
                    .get("title")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();
                let type_name = item
                    .get("__typename")
                    .and_then(|t| t.as_str())
                    .unwrap_or("track")
                    .to_lowercase();

                if !text.is_empty() {
                    results.push(AutocompleteResult {
                        text,
                        result_type: type_name,
                        id,
                    });
                }
            }
        }

        Ok(results)
    }

    // ─── Tracks ─────────────────────────────────────────────────────────

    /// Batch fetch multiple tracks by their IDs.
    pub async fn get_tracks_by_ids(&self, ids: &[String]) -> Result<Vec<Track>, AppError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let gql = r#"
            query getTracks($ids: [ID!]!) {
                getTracks(ids: $ids) {
                    id
                    title
                    duration
                    explicit
                    hasFlac
                    artists { id title image { src palette } }
                    release { id title date image { src palette } }
                }
            }
        "#;

        let mut tracks = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(50) {
            let data = self
                .graphql(gql, serde_json::json!({ "ids": chunk }))
                .await?;

            let mut chunk_map = std::collections::HashMap::new();
            if let Some(items) = data.get("getTracks").and_then(|t| t.as_array()) {
                for it in items {
                    if let Some(track) = parse_track_from_value(it) {
                        chunk_map.insert(track.id.to_string(), track);
                    }
                }
            }

            for id in chunk {
                if let Some(track) = chunk_map.get(id) {
                    tracks.push(track.clone());
                }
            }
        }
        Ok(tracks)
    }

    /// Single track metadata by ID.
    pub async fn get_track(&self, id: i64) -> Result<Track, AppError> {
        let tracks = self.get_tracks_by_ids(&[id.to_string()]).await?;
        tracks
            .into_iter()
            .next()
            .ok_or_else(|| AppError::NotFound(format!("Трек {} не найден", id)))
    }

    // ─── Playlists ──────────────────────────────────────────────────────

    /// Fetch playlist by ID and resolve its tracks.
    pub async fn get_playlist(&self, id: i64) -> Result<Playlist, AppError> {
        let gql = r#"
            query getPlaylists($ids: [ID!]!) {
                getPlaylists(ids: $ids) {
                    id
                    title
                    description
                    duration
                    image { src }
                    userId
                    isPublic
                    tracks { id }
                }
            }
        "#;

        let data = self
            .graphql(gql, serde_json::json!({ "ids": [id.to_string()] }))
            .await?;

        let pl_val = data
            .get("getPlaylists")
            .and_then(|p| p.get(0))
            .ok_or_else(|| AppError::NotFound(format!("Плейлист {} не найден", id)))?;

        let track_ids: Vec<String> = pl_val
            .get("tracks")
            .and_then(|t| t.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| {
                        t.get("id").and_then(|i| match i {
                            Value::Number(n) => Some(n.to_string()),
                            Value::String(s) => Some(s.clone()),
                            _ => None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let initial_ids = &track_ids[..50.min(track_ids.len())];
        let tracks = if !initial_ids.is_empty() {
            Some(self.get_tracks_by_ids(initial_ids).await.unwrap_or_default())
        } else {
            None
        };

        let is_public = pl_val
            .get("isPublic")
            .or_else(|| pl_val.get("is_public"))
            .and_then(|v| v.as_bool());

        let cover_urls: Vec<String> = tracks
            .as_ref()
            .map(|ts| {
                ts.iter()
                    .take(4)
                    .filter_map(|t| t.cover_url.clone())
                    .collect()
            })
            .unwrap_or_default();

        let explicit_cover = pl_val
            .get("image")
            .and_then(|img| img.get("src"))
            .and_then(|s| s.as_str())
            .map(|src| format_image_url(src, 300, 300));

        let cover_url = explicit_cover.or_else(|| cover_urls.first().cloned());

        Ok(Playlist {
            id,
            title: pl_val
                .get("title")
                .and_then(|t| t.as_str())
                .unwrap_or("Плейлист")
                .to_string(),
            description: pl_val
                .get("description")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string()),
            cover_url,
            cover_urls: if cover_urls.is_empty() { None } else { Some(cover_urls) },
            track_count: track_ids.len() as u32,
            duration: pl_val
                .get("duration")
                .and_then(|d| d.as_u64())
                .unwrap_or(0) as u32,
            is_editable: false,
            is_public,
            owner: pl_val
                .get("userId")
                .or_else(|| pl_val.get("user").and_then(|u| u.get("id")))
                .and_then(|u| match u {
                    Value::Number(n) => Some(n.to_string()),
                    Value::String(s) => Some(s.clone()),
                    _ => None,
                }),
            tracks,
            track_ids: Some(track_ids),
        })
    }

    /// Multiple playlists by IDs.
    pub async fn get_playlists_by_ids(&self, ids: &[String]) -> Result<Vec<Playlist>, AppError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let gql = r#"
            query getPlaylists($ids: [ID!]!) {
                getPlaylists(ids: $ids) {
                    id
                    title
                    description
                    duration
                    image { src }
                    userId
                    isPublic
                    tracks { id }
                }
            }
        "#;

        let data = self
            .graphql(gql, serde_json::json!({ "ids": ids }))
            .await?;

        let mut raw_list = Vec::new();
        if let Some(items) = data.get("getPlaylists").and_then(|p| p.as_array()) {
            for pl_val in items {
                if let Some(id) = pl_val.get("id").and_then(|i| match i {
                    Value::Number(n) => n.as_i64(),
                    Value::String(s) => s.parse().ok(),
                    _ => None,
                }) {
                    let track_ids: Vec<String> = pl_val
                        .get("tracks")
                        .and_then(|t| t.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|t| {
                                    t.get("id").and_then(|i| match i {
                                        Value::Number(n) => Some(n.to_string()),
                                        Value::String(s) => Some(s.clone()),
                                        _ => None,
                                    })
                                })
                                .collect()
                        })
                        .unwrap_or_default();

                    let track_count = track_ids.len() as u32;

                    let is_public = pl_val
                        .get("isPublic")
                        .or_else(|| pl_val.get("is_public"))
                        .and_then(|v| v.as_bool());

                    let title = pl_val
                        .get("title")
                        .and_then(|t| t.as_str())
                        .unwrap_or("Плейлист")
                        .to_string();

                    let description = pl_val
                        .get("description")
                        .and_then(|d| d.as_str())
                        .map(|s| s.to_string());

                    let cover_url = pl_val
                        .get("image")
                        .and_then(|img| img.get("src"))
                        .and_then(|s| s.as_str())
                        .map(|src| format_image_url(src, 300, 300));

                    let duration = pl_val
                        .get("duration")
                        .and_then(|d| d.as_u64())
                        .unwrap_or(0) as u32;

                    let owner = pl_val
                        .get("userId")
                        .or_else(|| pl_val.get("user").and_then(|u| u.get("id")))
                        .and_then(|u| match u {
                            Value::Number(n) => Some(n.to_string()),
                            Value::String(s) => Some(s.clone()),
                            _ => None,
                        });

                    raw_list.push((id, title, description, cover_url, track_count, duration, is_public, owner, track_ids));
                }
            }
        }

        // Collect up to first 4 track IDs for playlists that need track covers
        let mut needed_ids = Vec::new();
        for (_, _, _, cover_url, _, _, _, _, track_ids) in &raw_list {
            if cover_url.is_none() {
                for tid in track_ids.iter().take(4) {
                    if !needed_ids.contains(tid) {
                        needed_ids.push(tid.clone());
                    }
                }
            }
        }

        let tracks_map: std::collections::HashMap<String, Track> = if !needed_ids.is_empty() {
            self.get_tracks_by_ids(&needed_ids)
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|t| (t.id.to_string(), t))
                .collect()
        } else {
            std::collections::HashMap::new()
        };

        let mut playlists = Vec::with_capacity(raw_list.len());
        for (id, title, description, explicit_cover, track_count, duration, is_public, owner, track_ids) in raw_list {
            let first_tracks: Vec<Track> = track_ids
                .iter()
                .take(4)
                .filter_map(|tid| tracks_map.get(tid).cloned())
                .collect();

            let cover_urls: Vec<String> = first_tracks
                .iter()
                .filter_map(|t| t.cover_url.clone())
                .collect();

            let cover_url = explicit_cover.or_else(|| cover_urls.first().cloned());

            playlists.push(Playlist {
                id,
                title,
                description,
                cover_url,
                cover_urls: if cover_urls.is_empty() { None } else { Some(cover_urls) },
                track_count,
                duration,
                is_editable: false,
                is_public,
                owner,
                tracks: if first_tracks.is_empty() { None } else { Some(first_tracks) },
                track_ids: Some(track_ids),
            });
        }

        Ok(playlists)
    }

    /// Get user's saved and created playlists.
    pub async fn get_user_playlists(
        &self,
        offset: u32,
        limit: u32,
    ) -> Result<CollectionPage<Playlist>, AppError> {
        let gql = r#"
            query userPlaylists {
                collection {
                    playlists {
                        id
                    }
                }
            }
        "#;

        let data = self.graphql(gql, serde_json::json!({})).await?;
        let all_ids: Vec<String> = data
            .get("collection")
            .and_then(|c| c.get("playlists"))
            .and_then(|p| p.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| {
                        x.get("id").and_then(|i| match i {
                            Value::Number(n) => Some(n.to_string()),
                            Value::String(s) => Some(s.clone()),
                            _ => None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let total = all_ids.len() as u32;
        let start = offset as usize;
        let end = (start + limit as usize).min(all_ids.len());

        if start >= all_ids.len() {
            return Ok(CollectionPage {
                items: Vec::new(),
                total,
                has_next: false,
                offset,
            });
        }

        let paged_ids = &all_ids[start..end];
        let items = self.get_playlists_by_ids(paged_ids).await?;

        Ok(CollectionPage {
            items,
            total,
            has_next: end < all_ids.len(),
            offset,
        })
    }

    /// Curated / Editorial playlists from Zvuk for Discovery and Home Page.
    pub async fn get_editorial_playlists(&self) -> Result<Vec<Playlist>, AppError> {
        let path = format!(
            "{}/grid/content?name=editorial_playlist&ranker_enabled=true",
            TINY_API_URL
        );
        let headers = self.auth_headers().await?;

        if let Ok(res) = self.http.get(&path).headers(headers).send().await {
            if let Ok(body) = res.json::<Value>().await {
                let mut ids = Vec::new();
                if let Some(items) = body
                    .get("result")
                    .and_then(|r| r.get("page"))
                    .and_then(|p| p.get("data"))
                    .and_then(|d| d.as_array())
                {
                    for it in items.iter().take(12) {
                        if let Some(id_val) = it.get("id") {
                            if let Some(id_num) = id_val.as_i64() {
                                ids.push(id_num.to_string());
                            } else if let Some(id_str) = id_val.as_str() {
                                ids.push(id_str.to_string());
                            }
                        }
                    }
                }

                if !ids.is_empty() {
                    return self.get_playlists_by_ids(&ids).await;
                }
            }
        }

        Ok(Vec::new())
    }

    pub async fn create_playlist(&self, req: &CreatePlaylistRequest) -> Result<Playlist, AppError> {
        let gql = r#"
            mutation createPlayList($name: String!, $items: [PlaylistItem!]!) {
                playlist {
                    create(name: $name, items: $items)
                }
            }
        "#;
        let data = self
            .graphql(
                gql,
                serde_json::json!({ "name": req.title, "items": [] }),
            )
            .await?;

        let created_id = data
            .get("playlist")
            .and_then(|p| p.get("create"))
            .and_then(|id| match id {
                Value::Number(n) => n.as_i64(),
                Value::String(s) => s.parse().ok(),
                _ => None,
            })
            .unwrap_or(0);

        Ok(Playlist {
            id: created_id,
            title: req.title.clone(),
            description: req.description.clone(),
            cover_url: None,
            cover_urls: None,
            track_count: 0,
            duration: 0,
            is_editable: true,
            is_public: Some(false),
            owner: None,
            tracks: Some(Vec::new()),
            track_ids: Some(Vec::new()),
        })
    }

    pub async fn delete_playlist(&self, id: i64) -> Result<(), AppError> {
        let gql = r#"
            mutation deletePlaylist($id: ID!) {
                playlist {
                    delete(id: $id)
                }
            }
        "#;
        self.graphql(gql, serde_json::json!({ "id": id.to_string() }))
            .await?;
        Ok(())
    }

    pub async fn get_user_short_playlists(
        &self,
        limit: u32,
        offset: Option<String>,
    ) -> Result<ShortPlaylistsResult, AppError> {
        let gql = r#"
            query getProfilesShortPlaylistsInfo($limit: Int = 6, $offset: String = null) {
              getUserPlaylists {
                paginated(pagination: {first: $limit, after: $offset}) {
                  playlists {
                    id
                    title
                  }
                  page {
                    endCursor
                    hasNextPage
                  }
                }
              }
            }
        "#;
        let offset_val = offset.unwrap_or_default();
        let data = self
            .graphql_op(
                gql,
                serde_json::json!({
                    "limit": limit,
                    "offset": offset_val,
                }),
                Some("getProfilesShortPlaylistsInfo"),
            )
            .await?;

        let paginated = data
            .get("getUserPlaylists")
            .and_then(|u| u.get("paginated"));

        let playlists = paginated
            .and_then(|p| p.get("playlists"))
            .and_then(|arr| arr.as_array())
            .map(|list| {
                list.iter()
                    .filter_map(|item| {
                        let id = match item.get("id") {
                            Some(Value::String(s)) => s.clone(),
                            Some(Value::Number(n)) => n.to_string(),
                            _ => return None,
                        };
                        let title = item
                            .get("title")
                            .and_then(|t| t.as_str())
                            .unwrap_or("Плейлист")
                            .to_string();
                        Some(ShortPlaylist { id, title })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let page_val = paginated.and_then(|p| p.get("page"));
        let end_cursor = page_val
            .and_then(|p| p.get("endCursor"))
            .and_then(|c| c.as_str())
            .map(|s| s.to_string());
        let has_next_page = page_val
            .and_then(|p| p.get("hasNextPage"))
            .and_then(|h| h.as_bool())
            .unwrap_or(false);

        Ok(ShortPlaylistsResult {
            playlists,
            page: ShortPlaylistsPage {
                end_cursor,
                has_next_page,
            },
        })
    }

    pub async fn add_items_to_playlist(
        &self,
        id: &str,
        items: Vec<PlaylistItemInput>,
    ) -> Result<(), AppError> {
        let gql = r#"
            mutation addItems($id: ID!, $items: [PlaylistItem!] = []) {
              playlist {
                addItemsV1(id: $id, items: $items) {
                  id
                }
              }
            }
        "#;
        self.graphql_op(
            gql,
            serde_json::json!({
                "id": id,
                "items": items,
            }),
            Some("addItems"),
        )
        .await?;
        Ok(())
    }

    pub async fn update_playlist(
        &self,
        id: &str,
        name: &str,
        is_public: bool,
        items: Vec<PlaylistItemInput>,
    ) -> Result<(), AppError> {
        let gql = r#"
            mutation updatePlaylist($id: ID!, $isPublic: Boolean!, $items: [PlaylistItem!] = [], $name: String!) {
              playlist {
                updateV1(id: $id, isPublic: $isPublic, items: $items, name: $name) {
                  id
                }
              }
            }
        "#;
        self.graphql_op(
            gql,
            serde_json::json!({
                "id": id,
                "isPublic": is_public,
                "name": name,
                "items": items,
            }),
            Some("updatePlaylist"),
        )
        .await?;
        Ok(())
    }

    pub async fn add_track_to_playlist(
        &self,
        playlist_id: i64,
        track_id: i64,
    ) -> Result<(), AppError> {
        self.add_items_to_playlist(
            &playlist_id.to_string(),
            vec![PlaylistItemInput {
                item_id: track_id.to_string(),
                r#type: "track".to_string(),
            }],
        )
        .await
    }

    pub async fn remove_track_from_playlist(
        &self,
        _playlist_id: i64,
        _track_id: i64,
    ) -> Result<(), AppError> {
        // Zvuk API uses playlist update mutation to adjust tracks
        Ok(())
    }

    // ─── Favourites / Collection ────────────────────────────────────────

    pub async fn get_liked_tracks(
        &self,
        offset: u32,
        limit: u32,
    ) -> Result<CollectionPage<Track>, AppError> {
        let gql = r#"
            query userTracks {
                collection {
                    tracks {
                        id
                    }
                }
            }
        "#;

        let data = self.graphql(gql, serde_json::json!({})).await?;
        let all_ids: Vec<String> = data
            .get("collection")
            .and_then(|c| c.get("tracks"))
            .and_then(|t| t.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| {
                        x.get("id").and_then(|i| match i {
                            Value::Number(n) => Some(n.to_string()),
                            Value::String(s) => Some(s.clone()),
                            _ => None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let total = all_ids.len() as u32;
        let start = offset as usize;
        let end = (start + limit as usize).min(all_ids.len());

        if start >= all_ids.len() {
            return Ok(CollectionPage {
                items: Vec::new(),
                total,
                has_next: false,
                offset,
            });
        }

        let paged_ids = &all_ids[start..end];
        let mut items = self.get_tracks_by_ids(paged_ids).await?;
        for t in items.iter_mut() {
            t.is_liked = Some(true);
        }

        Ok(CollectionPage {
            items,
            total,
            has_next: end < all_ids.len(),
            offset,
        })
    }

    /// Fetches all liked track IDs in one quick call for global heart status checking.
    pub async fn get_liked_track_ids(&self) -> Result<Vec<i64>, AppError> {
        let gql = r#"
            query userTracks {
                collection {
                    tracks {
                        id
                    }
                }
            }
        "#;

        let data = self.graphql(gql, serde_json::json!({})).await?;
        let all_ids: Vec<i64> = data
            .get("collection")
            .and_then(|c| c.get("tracks"))
            .and_then(|t| t.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| {
                        x.get("id").and_then(|i| match i {
                            Value::Number(n) => n.as_i64(),
                            Value::String(s) => s.parse::<i64>().ok(),
                            _ => None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(all_ids)
    }

    /// Fetch multiple releases/albums by IDs.
    pub async fn get_releases_by_ids(&self, ids: &[String]) -> Result<Vec<Album>, AppError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let gql = r#"
            query getReleases($ids: [ID!]!) {
                getReleases(ids: $ids) {
                    id
                    title
                    date
                    image { src }
                    artists { id title }
                    tracks { id }
                }
            }
        "#;

        let data = self
            .graphql(gql, serde_json::json!({ "ids": ids }))
            .await?;

        let mut albums = Vec::new();
        if let Some(items) = data.get("getReleases").and_then(|r| r.as_array()) {
            for item in items {
                if let Some(id) = item.get("id").and_then(|i| match i {
                    Value::Number(n) => n.as_i64(),
                    Value::String(s) => s.parse().ok(),
                    _ => None,
                }) {
                    let title = item
                        .get("title")
                        .and_then(|t| t.as_str())
                        .unwrap_or("Альбом")
                        .to_string();
                    let mut album_artists: Vec<TrackArtist> = Vec::new();
                    if let Some(arr) = item.get("artists").and_then(|a| a.as_array()) {
                        for a in arr {
                            let aid = a.get("id").and_then(|i| match i {
                                Value::Number(n) => n.as_i64(),
                                Value::String(s) => s.parse().ok(),
                                _ => None,
                            });
                            let aname = a
                                .get("title")
                                .or_else(|| a.get("name"))
                                .and_then(|t| t.as_str());
                            if let (Some(aid), Some(aname)) = (aid, aname) {
                                album_artists.push(TrackArtist {
                                    id: aid,
                                    name: aname.to_string(),
                                    image_url: None,
                                    palette: None,
                                });
                            }
                        }
                    }

                    let artist = if !album_artists.is_empty() {
                        album_artists.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")
                    } else {
                        "Исполнитель".to_string()
                    };
                    let artist_id = album_artists.first().map(|a| a.id);
                    let cover_url = item
                        .get("image")
                        .and_then(|img| img.get("src"))
                        .and_then(|s| s.as_str())
                        .map(|src| format_image_url(src, 400, 400));
                    let release_year = item
                        .get("date")
                        .and_then(|d| d.as_str())
                        .and_then(|s| s.get(0..4))
                        .and_then(|y| y.parse::<u16>().ok());
                    let track_ids: Vec<String> = item
                        .get("tracks")
                        .and_then(|t| t.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|x| {
                                    x.get("id").and_then(|i| match i {
                                        Value::Number(n) => Some(n.to_string()),
                                        Value::String(s) => Some(s.clone()),
                                        _ => None,
                                    })
                                })
                                .collect()
                        })
                        .unwrap_or_default();

                    albums.push(Album {
                        id,
                        title,
                        artist,
                        artist_id,
                        artists: album_artists,
                        cover_url,
                        release_year,
                        track_count: track_ids.len() as u32,
                        tracks: None,
                        is_liked: None,
                    });

                }
            }
        }
        Ok(albums)
    }

    /// Single release/album metadata with resolved tracks.
    pub async fn get_album(&self, id: i64) -> Result<Album, AppError> {
        let gql = r#"
            query getReleases($ids: [ID!]!) {
                getReleases(ids: $ids) {
                    id
                    title
                    date
                    image { src }
                    artists { id title }
                    tracks { id }
                }
            }
        "#;

        let data = self
            .graphql(gql, serde_json::json!({ "ids": [id.to_string()] }))
            .await?;

        let item = data
            .get("getReleases")
            .and_then(|r| r.get(0))
            .ok_or_else(|| AppError::NotFound(format!("Альбом {} не найден", id)))?;

        let title = item
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("Альбом")
            .to_string();
        let mut album_artists: Vec<TrackArtist> = Vec::new();
        if let Some(arr) = item.get("artists").and_then(|a| a.as_array()) {
            for a in arr {
                let aid = a.get("id").and_then(|i| match i {
                    Value::Number(n) => n.as_i64(),
                    Value::String(s) => s.parse().ok(),
                    _ => None,
                });
                let aname = a
                    .get("title")
                    .or_else(|| a.get("name"))
                    .and_then(|t| t.as_str());
                if let (Some(aid), Some(aname)) = (aid, aname) {
                    album_artists.push(TrackArtist {
                        id: aid,
                        name: aname.to_string(),
                        image_url: None,
                        palette: None,
                    });
                }
            }
        }

        let artist = if !album_artists.is_empty() {
            album_artists.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")
        } else {
            "Исполнитель".to_string()
        };
        let artist_id = album_artists.first().map(|a| a.id);

        let cover_url = item
            .get("image")
            .and_then(|img| img.get("src"))
            .and_then(|s| s.as_str())
            .map(|src| format_image_url(src, 400, 400));
        let release_year = item
            .get("date")
            .and_then(|d| d.as_str())
            .and_then(|s| s.get(0..4))
            .and_then(|y| y.parse::<u16>().ok());
        let track_ids: Vec<String> = item
            .get("tracks")
            .and_then(|t| t.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| {
                        x.get("id").and_then(|i| match i {
                            Value::Number(n) => Some(n.to_string()),
                            Value::String(s) => Some(s.clone()),
                            _ => None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let tracks = if !track_ids.is_empty() {
            Some(self.get_tracks_by_ids(&track_ids).await.unwrap_or_default())
        } else {
            None
        };

        Ok(Album {
            id,
            title,
            artist,
            artist_id,
            artists: album_artists,
            cover_url,
            release_year,
            track_count: track_ids.len() as u32,
            tracks,
            is_liked: None,
        })
    }


    /// Fetches full artist details including popular tracks, releases, and related artists.
    pub async fn get_artist(&self, id: i64) -> Result<ArtistDetail, AppError> {
        let query = r#"query artist($ids: [ID!]!, $withlikesCount: Boolean = false, $withRelatedArtists: Boolean = false, $withPopularTracks: Boolean = false, $withPopularReleases: Boolean = false, $withActualRelease: Boolean = false) {
  getArtists(ids: $ids) {
    id
    title
    mark
    description
    detailedDescription {
      src
    }
    genres {
      id
      name
      rname
    }
    image {
      src
      palette
    }
    releasesPage: getCursorReleases(limit: 100, cursor: null) {
      pageInfo: page_info {
        endCursor
        hasNextPage
      }
      releases {
        id
        title
        date
        type
        image {
          src
          palette
        }
        mark
        explicit
      }
    }
    popularReleases(limit: 1) @include(if: $withPopularReleases) {
      releases {
        id
        title
        image {
          src
          palette
        }
        mediaContentCount
        mark
        explicit
        __typename
      }
    }
    actualRelease @include(if: $withActualRelease) {
      id
      title
      image {
        src
        palette
      }
      mark
      explicit
      artists {
        id
        title
      }
      __typename
    }
    popularTracks(limit: 20, offset: 0) @include(if: $withPopularTracks) {
      ...PlayerTrackData
    }
    allTracks: popularTracks(limit: 200, offset: 0) {
      id
    }
    relatedArtists(limit: 10) @include(if: $withRelatedArtists) {
      id
      title
      image {
        src
        palette
      }
      mark
    }
    collectionItemData {
      likesCount @include(if: $withlikesCount)
    }
  }
}

fragment PlayerTrackData on Track {
  id
  title
  lyrics
  hasFlac
  duration
  explicit
  availability
  artistTemplate
  childParam
  mark
  artists {
    id
    title
    image {
      src
      palette
    }
    mark
  }
  release {
    id
    title
    image {
      src
      palette
    }
  }
  zchan
  __typename
}"#;

        let variables = serde_json::json!({
            "ids": id.to_string(),
            "withlikesCount": true,
            "withActualRelease": true,
            "withPopularTracks": true,
            "withRelatedArtists": true,
            "withPopularReleases": true,
        });

        let data = self
            .graphql_op(query, variables, Some("artist"))
            .await?;

        let artist_obj = data
            .get("getArtists")
            .and_then(|a| a.as_array())
            .and_then(|arr| arr.first())
            .ok_or_else(|| AppError::NotFound(format!("Артист {} не найден", id)))?;

        let title = artist_obj
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("Артист")
            .to_string();

        let description = artist_obj
            .get("description")
            .and_then(|d| d.as_str())
            .map(|s| s.to_string());

        let img_obj = artist_obj.get("image");
        let image_url = img_obj
            .and_then(|i| i.get("src"))
            .and_then(|s| s.as_str())
            .map(|src| format_image_url(src, 600, 600));

        let palette = img_obj
            .and_then(|i| i.get("palette"))
            .and_then(|p| p.as_str())
            .map(|s| s.to_string());

        let genres = artist_obj
            .get("genres")
            .and_then(|g| g.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|g| {
                        let gid = g.get("id")?.as_str()?.to_string();
                        let name = g.get("name")?.as_str()?.to_string();
                        let rname = g.get("rname").and_then(|r| r.as_str()).map(|s| s.to_string());
                        Some(ArtistGenre { id: gid, name, rname })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let likes_count = artist_obj
            .get("collectionItemData")
            .and_then(|c| c.get("likesCount"))
            .and_then(|l| l.as_u64());

        let popular_tracks = artist_obj
            .get("popularTracks")
            .and_then(|p| p.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(parse_track_from_value)
                    .collect()
            })
            .unwrap_or_default();

        let all_track_ids = artist_obj
            .get("allTracks")
            .and_then(|a| a.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        item.get("id").and_then(|i| match i {
                            Value::Number(n) => n.as_i64(),
                            Value::String(s) => s.parse().ok(),
                            _ => None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let actual_release = artist_obj.get("actualRelease").and_then(|r| {
            if r.is_null() {
                return None;
            }
            let rid: i64 = match r.get("id")? {
                Value::Number(n) => n.as_i64()?,
                Value::String(s) => s.parse().ok()?,
                _ => return None,
            };
            let rtitle = r.get("title").and_then(|t| t.as_str()).unwrap_or("").to_string();
            let r_img = r.get("image");
            let cover_url = r_img
                .and_then(|i| i.get("src"))
                .and_then(|s| s.as_str())
                .map(|src| format_image_url(src, 400, 400));
            let r_palette = r_img
                .and_then(|i| i.get("palette"))
                .and_then(|p| p.as_str())
                .map(|s| s.to_string());
            let explicit = r.get("explicit").and_then(|e| e.as_bool()).unwrap_or(false);

            Some(ArtistRelease {
                id: rid,
                title: rtitle,
                date: None,
                release_type: Some("actual".to_string()),
                cover_url,
                palette: r_palette,
                explicit,
            })
        });

        let releases_page = artist_obj.get("releasesPage");
        let end_cursor = releases_page
            .and_then(|p| p.get("pageInfo"))
            .and_then(|pi| pi.get("endCursor"))
            .and_then(|c| c.as_str())
            .map(|s| s.to_string());
        let has_more_releases = releases_page
            .and_then(|p| p.get("pageInfo"))
            .and_then(|pi| pi.get("hasNextPage"))
            .and_then(|b| b.as_bool())
            .unwrap_or(false);

        let releases = releases_page
            .and_then(|p| p.get("releases"))
            .and_then(|r| r.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|r| {
                        let rid: i64 = match r.get("id")? {
                            Value::Number(n) => n.as_i64()?,
                            Value::String(s) => s.parse().ok()?,
                            _ => return None,
                        };
                        let rtitle = r.get("title").and_then(|t| t.as_str()).unwrap_or("").to_string();
                        let date = r.get("date").and_then(|d| d.as_str()).map(|s| s.to_string());
                        let release_type = r.get("type").and_then(|t| t.as_str()).map(|s| s.to_string());
                        let r_img = r.get("image");
                        let cover_url = r_img
                            .and_then(|i| i.get("src"))
                            .and_then(|s| s.as_str())
                            .map(|src| format_image_url(src, 400, 400));
                        let r_palette = r_img
                            .and_then(|i| i.get("palette"))
                            .and_then(|p| p.as_str())
                            .map(|s| s.to_string());
                        let explicit = r.get("explicit").and_then(|e| e.as_bool()).unwrap_or(false);

                        Some(ArtistRelease {
                            id: rid,
                            title: rtitle,
                            date,
                            release_type,
                            cover_url,
                            palette: r_palette,
                            explicit,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let related_artists = artist_obj
            .get("relatedArtists")
            .and_then(|ra| ra.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|a| {
                        let aid: i64 = match a.get("id")? {
                            Value::Number(n) => n.as_i64()?,
                            Value::String(s) => s.parse().ok()?,
                            _ => return None,
                        };
                        let atitle = a.get("title").and_then(|t| t.as_str()).unwrap_or("").to_string();
                        let a_img = a.get("image");
                        let a_image_url = a_img
                            .and_then(|i| i.get("src"))
                            .and_then(|s| s.as_str())
                            .map(|src| format_image_url(src, 300, 300));
                        let a_palette = a_img
                            .and_then(|i| i.get("palette"))
                            .and_then(|p| p.as_str())
                            .map(|s| s.to_string());

                        Some(RelatedArtist {
                            id: aid,
                            title: atitle,
                            image_url: a_image_url,
                            palette: a_palette,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(ArtistDetail {
            id,
            title,
            description,
            image_url,
            palette,
            genres,
            likes_count,
            popular_tracks,
            all_track_ids,
            actual_release,
            releases,
            has_more_releases,
            end_cursor,
            related_artists,
        })
    }

    /// Fetches a paginated list of artist releases using cursor and limit.
    pub async fn get_artist_releases(
        &self,
        artist_id: i64,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> Result<ArtistReleasesPage, AppError> {
        let query = r#"query artistReleases($ids: [ID!]!, $limit: Int = 50, $cursor: String) {
  getArtists(ids: $ids) {
    id
    releasesPage: getCursorReleases(limit: $limit, cursor: $cursor) {
      pageInfo: page_info {
        endCursor
        hasNextPage
      }
      releases {
        id
        title
        date
        type
        image {
          src
          palette
        }
        mark
        explicit
      }
    }
  }
}"#;

        let variables = serde_json::json!({
            "ids": artist_id.to_string(),
            "limit": limit.unwrap_or(50),
            "cursor": cursor,
        });

        let data = self
            .graphql_op(query, variables, Some("artistReleases"))
            .await?;

        let artist_obj = data
            .get("getArtists")
            .and_then(|a| a.as_array())
            .and_then(|arr| arr.first())
            .ok_or_else(|| AppError::NotFound(format!("Артист {} не найден", artist_id)))?;

        let releases_page = artist_obj.get("releasesPage");
        let end_cursor = releases_page
            .and_then(|p| p.get("pageInfo"))
            .and_then(|pi| pi.get("endCursor"))
            .and_then(|c| c.as_str())
            .map(|s| s.to_string());
        let has_more_releases = releases_page
            .and_then(|p| p.get("pageInfo"))
            .and_then(|pi| pi.get("hasNextPage"))
            .and_then(|b| b.as_bool())
            .unwrap_or(false);

        let releases = releases_page
            .and_then(|p| p.get("releases"))
            .and_then(|r| r.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|r| {
                        let rid: i64 = match r.get("id")? {
                            Value::Number(n) => n.as_i64()?,
                            Value::String(s) => s.parse().ok()?,
                            _ => return None,
                        };
                        let rtitle = r.get("title").and_then(|t| t.as_str()).unwrap_or("").to_string();
                        let date = r.get("date").and_then(|d| d.as_str()).map(|s| s.to_string());
                        let release_type = r.get("type").and_then(|t| t.as_str()).map(|s| s.to_string());
                        let r_img = r.get("image");
                        let cover_url = r_img
                            .and_then(|i| i.get("src"))
                            .and_then(|s| s.as_str())
                            .map(|src| format_image_url(src, 400, 400));
                        let r_palette = r_img
                            .and_then(|i| i.get("palette"))
                            .and_then(|p| p.as_str())
                            .map(|s| s.to_string());
                        let explicit = r.get("explicit").and_then(|e| e.as_bool()).unwrap_or(false);

                        Some(ArtistRelease {
                            id: rid,
                            title: rtitle,
                            date,
                            release_type,
                            cover_url,
                            palette: r_palette,
                            explicit,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(ArtistReleasesPage {
            releases,
            has_more_releases,
            end_cursor,
        })
    }

    /// Fetches all liked album IDs.

    pub async fn get_liked_album_ids(&self) -> Result<Vec<i64>, AppError> {
        let gql = r#"
            query userReleases {
                collection {
                    releases {
                        id
                    }
                }
            }
        "#;

        let data = self.graphql(gql, serde_json::json!({})).await?;
        let all_ids: Vec<i64> = data
            .get("collection")
            .and_then(|c| c.get("releases"))
            .and_then(|t| t.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| {
                        x.get("id").and_then(|i| match i {
                            Value::Number(n) => n.as_i64(),
                            Value::String(s) => s.parse::<i64>().ok(),
                            _ => None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(all_ids)
    }

    /// Fetches all subscribed / followed artist IDs.
    pub async fn get_liked_artist_ids(&self) -> Result<Vec<i64>, AppError> {
        let gql = r#"
            query userArtists {
                collection {
                    artists {
                        id
                    }
                }
            }
        "#;

        let data = self.graphql(gql, serde_json::json!({})).await?;
        let all_ids: Vec<i64> = data
            .get("collection")
            .and_then(|c| c.get("artists"))
            .and_then(|t| t.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| {
                        x.get("id").and_then(|i| match i {
                            Value::Number(n) => n.as_i64(),
                            Value::String(s) => s.parse::<i64>().ok(),
                            _ => None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(all_ids)
    }

    pub async fn get_liked_albums(
        &self,
        offset: u32,
        limit: u32,
    ) -> Result<CollectionPage<Album>, AppError> {
        let all_ids = self.get_liked_album_ids().await?;
        let total = all_ids.len() as u32;
        let start = offset as usize;
        let end = (start + limit as usize).min(all_ids.len());

        if start >= all_ids.len() {
            return Ok(CollectionPage {
                items: Vec::new(),
                total,
                has_next: false,
                offset,
            });
        }

        let paged_ids: Vec<String> = all_ids[start..end].iter().map(|id| id.to_string()).collect();
        let items = self.get_releases_by_ids(&paged_ids).await?;

        Ok(CollectionPage {
            items,
            total,
            has_next: end < all_ids.len(),
            offset,
        })
    }

    pub async fn like_track(&self, track_id: i64) -> Result<(), AppError> {
        let gql = r#"
            mutation addItemToCollection($id: ID, $type: CollectionItemType) {
                collection {
                    addItemV1(id: $id, type: $type) {
                        collectionSubtype
                    }
                }
            }
        "#;
        self.graphql_op(
            gql,
            serde_json::json!({ "id": track_id.to_string(), "type": "track" }),
            Some("addItemToCollection"),
        )
        .await?;
        Ok(())
    }

    pub async fn unlike_track(&self, track_id: i64) -> Result<(), AppError> {
        let gql = r#"
            mutation removeItemFromCollection($id: ID, $type: CollectionItemType) {
                collection {
                    removeItem(id: $id, type: $type)
                }
            }
        "#;
        self.graphql_op(
            gql,
            serde_json::json!({ "id": track_id.to_string(), "type": "track" }),
            Some("removeItemFromCollection"),
        )
        .await?;
        Ok(())
    }

    pub async fn like_album(&self, album_id: i64) -> Result<(), AppError> {
        let gql = r#"
            mutation addItemToCollection($id: ID, $type: CollectionItemType) {
                collection {
                    addItemV1(id: $id, type: $type) {
                        collectionSubtype
                    }
                }
            }
        "#;
        self.graphql_op(
            gql,
            serde_json::json!({ "id": album_id.to_string(), "type": "release" }),
            Some("addItemToCollection"),
        )
        .await?;
        Ok(())
    }

    pub async fn unlike_album(&self, album_id: i64) -> Result<(), AppError> {
        let gql = r#"
            mutation removeItemFromCollection($id: ID, $type: CollectionItemType) {
                collection {
                    removeItem(id: $id, type: $type)
                }
            }
        "#;
        self.graphql_op(
            gql,
            serde_json::json!({ "id": album_id.to_string(), "type": "release" }),
            Some("removeItemFromCollection"),
        )
        .await?;
        Ok(())
    }

    pub async fn like_artist(&self, artist_id: i64) -> Result<(), AppError> {
        let gql = r#"
            mutation addItemToCollection($id: ID, $type: CollectionItemType) {
                collection {
                    addItemV1(id: $id, type: $type) {
                        collectionSubtype
                    }
                }
            }
        "#;
        self.graphql_op(
            gql,
            serde_json::json!({ "id": artist_id.to_string(), "type": "artist" }),
            Some("addItemToCollection"),
        )
        .await?;
        Ok(())
    }

    pub async fn unlike_artist(&self, artist_id: i64) -> Result<(), AppError> {
        let gql = r#"
            mutation removeItemFromCollection($id: ID, $type: CollectionItemType) {
                collection {
                    removeItem(id: $id, type: $type)
                }
            }
        "#;
        self.graphql_op(
            gql,
            serde_json::json!({ "id": artist_id.to_string(), "type": "artist" }),
            Some("removeItemFromCollection"),
        )
        .await?;
        Ok(())
    }

    // ─── Dislikes / Hidden Collection ─────────────────────────────────

    pub async fn get_disliked_track_ids(&self) -> Result<Vec<i64>, AppError> {
        let gql = r#"
            query paginatedHiddenCollectionTracksIds($first: Int!, $endCursor: String) {
                paginatedHiddenCollection {
                    tracks(pagination: { first: $first, after: $endCursor }) {
                        items {
                            id
                        }
                        page {
                            hasNextPage
                            endCursor
                        }
                    }
                }
            }
        "#;

        let mut all_ids = Vec::new();
        let mut cursor: Option<String> = None;

        for _ in 0..50 {
            let mut variables = serde_json::json!({ "first": 100 });
            if let Some(ref c) = cursor {
                variables["endCursor"] = serde_json::json!(c);
            }

            let data = match self
                .graphql_op(
                    gql,
                    variables,
                    Some("paginatedHiddenCollectionTracksIds"),
                )
                .await
            {
                Ok(d) => d,
                Err(e) => {
                    log::warn!("[Zvuk API] get_disliked_track_ids warning: {}", e);
                    break;
                }
            };

            let tracks_obj = data
                .get("paginatedHiddenCollection")
                .and_then(|p| p.get("tracks"));

            if let Some(items) = tracks_obj.and_then(|t| t.get("items")).and_then(|i| i.as_array()) {
                for item in items {
                    let id_val = item.get("id").unwrap_or(item);
                    if let Some(id) = match id_val {
                        Value::Number(n) => n.as_i64(),
                        Value::String(s) => s.parse::<i64>().ok(),
                        _ => None,
                    } {
                        all_ids.push(id);
                    }
                }
            }

            let page = tracks_obj.and_then(|t| t.get("page"));
            let has_next = page
                .and_then(|p| p.get("hasNextPage"))
                .and_then(|h| h.as_bool())
                .unwrap_or(false);

            let next_cursor = page
                .and_then(|p| p.get("endCursor"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string());

            if has_next && next_cursor.is_some() {
                cursor = next_cursor;
            } else {
                break;
            }
        }

        Ok(all_ids)
    }

    pub async fn get_disliked_artist_ids(&self) -> Result<Vec<i64>, AppError> {
        let gql = r#"
            query paginatedHiddenCollectionArtistsIds($first: Int!, $endCursor: String) {
                paginatedHiddenCollection {
                    artists(pagination: { first: $first, after: $endCursor }) {
                        items {
                            id
                        }
                        page {
                            hasNextPage
                            endCursor
                        }
                    }
                }
            }
        "#;

        let mut all_ids = Vec::new();
        let mut cursor: Option<String> = None;

        for _ in 0..50 {
            let mut variables = serde_json::json!({ "first": 100 });
            if let Some(ref c) = cursor {
                variables["endCursor"] = serde_json::json!(c);
            }

            let data = match self
                .graphql_op(
                    gql,
                    variables,
                    Some("paginatedHiddenCollectionArtistsIds"),
                )
                .await
            {
                Ok(d) => d,
                Err(e) => {
                    log::warn!("[Zvuk API] get_disliked_artist_ids warning: {}", e);
                    break;
                }
            };

            let artists_obj = data
                .get("paginatedHiddenCollection")
                .and_then(|p| p.get("artists"));

            if let Some(items) = artists_obj.and_then(|t| t.get("items")).and_then(|i| i.as_array()) {
                for item in items {
                    let id_val = item.get("id").unwrap_or(item);
                    if let Some(id) = match id_val {
                        Value::Number(n) => n.as_i64(),
                        Value::String(s) => s.parse::<i64>().ok(),
                        _ => None,
                    } {
                        all_ids.push(id);
                    }
                }
            }

            let page = artists_obj.and_then(|t| t.get("page"));
            let has_next = page
                .and_then(|p| p.get("hasNextPage"))
                .and_then(|h| h.as_bool())
                .unwrap_or(false);

            let next_cursor = page
                .and_then(|p| p.get("endCursor"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string());

            if has_next && next_cursor.is_some() {
                cursor = next_cursor;
            } else {
                break;
            }
        }

        Ok(all_ids)
    }

    pub async fn dislike_track(&self, track_id: i64) -> Result<(), AppError> {
        let gql = r#"
            mutation addHiddenItem($id: ID!, $type: CollectionItemType!) {
                hiddenCollection {
                    addItem(id: $id, type: $type)
                }
            }
        "#;
        self.graphql_op(
            gql,
            serde_json::json!({ "id": track_id.to_string(), "type": "TRACK" }),
            Some("addHiddenItem"),
        )
        .await?;
        Ok(())
    }

    pub async fn undislike_track(&self, track_id: i64) -> Result<(), AppError> {
        let gql = r#"
            mutation removeHiddenItem($id: ID!, $type: CollectionItemType!) {
                hiddenCollection {
                    removeItem(id: $id, type: $type)
                }
            }
        "#;
        self.graphql_op(
            gql,
            serde_json::json!({ "id": track_id.to_string(), "type": "TRACK" }),
            Some("removeHiddenItem"),
        )
        .await?;
        Ok(())
    }

    pub async fn dislike_artist(&self, artist_id: i64) -> Result<(), AppError> {
        let gql = r#"
            mutation addHiddenItem($id: ID!, $type: CollectionItemType!) {
                hiddenCollection {
                    addItem(id: $id, type: $type)
                }
            }
        "#;
        self.graphql_op(
            gql,
            serde_json::json!({ "id": artist_id.to_string(), "type": "ARTIST" }),
            Some("addHiddenItem"),
        )
        .await?;
        Ok(())
    }

    pub async fn undislike_artist(&self, artist_id: i64) -> Result<(), AppError> {
        let gql = r#"
            mutation removeHiddenItem($id: ID!, $type: CollectionItemType!) {
                hiddenCollection {
                    removeItem(id: $id, type: $type)
                }
            }
        "#;
        self.graphql_op(
            gql,
            serde_json::json!({ "id": artist_id.to_string(), "type": "ARTIST" }),
            Some("removeHiddenItem"),
        )
        .await?;
        Ok(())
    }

    // ─── Sound Energy / Recommendations / Personal Wave ────────────────

    /// Fetches tracks for Personal Wave (Сила Звука).
    /// When starting, `content_input` is None.
    /// When switching or completing a track, pass `content_input` with playback metrics
    /// (trackId, trackDuration, playDuration, isSkipped).
    pub async fn get_personal_wave(
        &self,
        content_input: Option<PersonalWaveContentInput>,
        first: Option<u32>,
        options: Option<PersonalWaveOptions>,
        wave_src: Option<String>,
        wave_type: Option<String>,
        wave_input: Option<serde_json::Value>,
    ) -> Result<Vec<Track>, AppError> {
        let query = r#"query getPersonalWave($contentInput: PersonalWaveContentInput, $first: PositiveInt! = 2, $options: PersonalWaveOptions, $waveInput: WaveInput, $waveSrc: MagicSource) {
  personalWaveContent(
    contentInput: $contentInput
    first: $first
    options: $options
    waveInput: $waveInput
    waveSrc: $waveSrc
  ) {
    ...PlayerTrackData
  }
}

fragment PlayerTrackData on Track {
  id
  title
  lyrics
  hasFlac
  duration
  explicit
  availability
  artistTemplate
  childParam
  mark
  artists {
    id
    title
    image {
      src
      palette
    }
    mark
  }
  release {
    id
    title
    image {
      src
      palette
    }
  }
  zchan
  __typename
}"#;

        let req_first = match first {
            Some(f) if f > 0 => f,
            _ => {
                if content_input.is_some() {
                    2
                } else {
                    15
                }
            }
        };

        let mut variables = serde_json::json!({
            "waveSrc": wave_src.unwrap_or_else(|| "AMAZME".to_string()),
            "first": req_first,
        });

        let mut effective_wave_type = wave_type;
        if let Some(opts) = &options {
            if let Some(serde_json::Value::String(s)) = &opts.popular {
                if s == "favorite" && effective_wave_type.is_none() {
                    effective_wave_type = Some("FAVTRACKS".to_string());
                }
            }
        }

        if let Some(opts) = &options {
            let mut opts_obj = serde_json::Map::new();
            if let Some(mood_val) = &opts.mood {
                opts_obj.insert("mood".to_string(), serde_json::json!(mood_val));
            } else {
                opts_obj.insert("mood".to_string(), serde_json::json!("energy:0.5,fun:0.5"));
            }
            if let Some(pop) = &opts.popular {
                if pop.is_number() || pop.is_null() {
                    opts_obj.insert("popular".to_string(), pop.clone());
                }
            }
            variables["options"] = serde_json::Value::Object(opts_obj);
        }

        if let Some(wt) = &effective_wave_type {
            variables["waveType"] = serde_json::json!(wt);
        }

        if let Some(wi) = &wave_input {
            variables["waveInput"] = wi.clone();
        } else if let Some(wt) = &effective_wave_type {
            variables["waveInput"] = serde_json::json!({ "waveType": wt });
        }

        if let Some(ci) = content_input {
            variables["contentInput"] = serde_json::to_value(ci)?;
        }

        println!("[PersonalWave] Query variables: {}", variables);

        let data = self
            .graphql_op(query, variables, Some("getPersonalWave"))
            .await?;

        println!("[PersonalWave] Response: {}", data);

        let tracks = data
            .get("personalWaveContent")
            .and_then(|c| c.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(parse_track_from_value)
                    .collect::<Vec<Track>>()
            })
            .unwrap_or_default();

        println!("[PersonalWave] Parsed tracks count: {}", tracks.len());

        Ok(tracks)
    }

    /// Fetch artist radio stream ("Поток по артисту / В стиле [артист]").
    pub async fn get_artist_radio(
        &self,
        artist_id: &str,
        cursor: Option<u32>,
        limit: Option<u32>,
    ) -> Result<ArtistRadioResult, AppError> {
        let query = r#"query getRadioByArtistTracks($id: ID!, $type: RecommenderRadioEntityType!, $limit: NonNegativeInt! = 25, $cursor: NonNegativeInt = 0) {
  recommenderRadio(
    onEntity: {id: $id, type: $type}
    first: $limit
    cursor: $cursor
  ) {
    cursor
    tracks {
      ...PlayerTrackData
    }
  }
}

fragment PlayerTrackData on Track {
  id
  title
  lyrics
  hasFlac
  duration
  explicit
  availability
  artistTemplate
  childParam
  mark
  artists {
    id
    title
    image {
      src
      palette
    }
    mark
  }
  release {
    id
    title
    image {
      src
      palette
    }
  }
  zchan
  __typename
}"#;

        let variables = serde_json::json!({
            "id": artist_id,
            "type": "ARTIST",
            "limit": limit.unwrap_or(25),
            "cursor": cursor.unwrap_or(0),
        });

        let data = self
            .graphql_op(query, variables, Some("getRadioByArtistTracks"))
            .await?;

        let radio_obj = data.get("recommenderRadio");
        let next_cursor = radio_obj
            .and_then(|r| r.get("cursor"))
            .and_then(|c| c.as_u64())
            .unwrap_or(0) as u32;

        let tracks = radio_obj
            .and_then(|r| r.get("tracks"))
            .and_then(|t| t.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(parse_track_from_value)
                    .collect::<Vec<Track>>()
            })
            .unwrap_or_default();

        Ok(ArtistRadioResult {
            cursor: next_cursor,
            tracks,
        })
    }

    /// Returns recommended tracks for the player flow/wave.
    pub async fn get_flow(&self, _session_id: Option<&str>) -> Result<FlowState, AppError> {
        let tracks = match self.get_personal_wave(None, Some(15), None, None, None, None).await {
            Ok(t) if !t.is_empty() => t,
            Err(e) => {
                log::warn!("[Zvuk API] Personal wave failed, falling back to editorial: {}", e);
                let editorial = self.get_editorial_playlists().await.unwrap_or_default();
                let mut tracks = Vec::new();

                if let Some(first_pl) = editorial.first() {
                    if let Ok(full_pl) = self.get_playlist(first_pl.id).await {
                        if let Some(pl_tracks) = full_pl.tracks {
                            tracks = pl_tracks;
                        }
                    }
                }

                if tracks.is_empty() {
                    if let Ok(results) = self.search("хиты").await {
                        tracks = results.tracks;
                    }
                }
                tracks
            }
            Ok(_) => Vec::new(),
        };

        Ok(FlowState {
            tracks,
            session_id: Some("personal-wave".to_string()),
        })
    }

    pub async fn tune_flow(
        &self,
        session_id: &str,
        settings: &TunerSettings,
    ) -> Result<FlowState, AppError> {
        let norm_energy = ((settings.energy + 1.0) / 2.0).clamp(0.0, 1.0);
        let norm_mood = ((settings.mood + 1.0) / 2.0).clamp(0.0, 1.0);
        let mood_str = format!("energy:{:.1},fun:{:.1}", norm_energy, norm_mood);
        let pop_val = if settings.popularity <= -0.33 {
            Some(serde_json::json!(0))
        } else if settings.popularity >= 0.33 {
            Some(serde_json::json!(1))
        } else {
            None
        };
        let options = PersonalWaveOptions {
            popular: pop_val,
            mood: Some(mood_str),
        };
        let tracks = self
            .get_personal_wave(None, Some(15), Some(options), None, None, None)
            .await?;
        Ok(FlowState {
            tracks,
            session_id: Some(session_id.to_string()),
        })
    }

    // ─── Lyrics ─────────────────────────────────────────────────────────

    /// Fetch lyrics & synced subtitles (LRC) for a track.
    pub async fn get_lyrics(&self, track_id: i64) -> Result<Option<LyricsInfo>, AppError> {
        let path = format!("{}/lyrics?track_id={}", TINY_API_URL, track_id);
        let headers = self.auth_headers().await?;

        if let Ok(res) = self.http.get(&path).headers(headers).send().await {
            if res.status().is_success() {
                if let Ok(body) = res.json::<Value>().await {
                    if let Some(res_obj) = body.get("result") {
                        if let Some(lyrics_text) = res_obj.get("lyrics").and_then(|l| l.as_str()) {
                            let l_type = res_obj
                                .get("type")
                                .and_then(|t| t.as_str())
                                .unwrap_or("lyrics");
                            let translation = res_obj
                                .get("translation")
                                .and_then(|t| t.as_str())
                                .map(|s| s.to_string());

                            return Ok(Some(LyricsInfo {
                                lyrics: lyrics_text.to_string(),
                                is_synced: l_type == "subtitle",
                                translation,
                            }));
                        }
                    }
                }
            }
        }

        Ok(None)
    }

    /// Fetch recommendations for the home screen dynamic block ("Рекомендуем послушать").
    pub async fn get_music_recommendations(
        &self,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<MusicRecommendationItem>, AppError> {
        let query = r#"query getMusicRecommendations($contentType: DynamicBlockContentType!, $blockName: BlockName!, $itemType: [DynamicBlockItemType!], $segment: Segment!, $limit: Int!, $offset: Int!) {
  dynamicBlockV2(
    contentType: $contentType
    blockName: $blockName
    itemType: $itemType
    segment: $segment
    limit: $limit
    offset: $offset
  ) {
    meta {
      total
    }
    items {
      ... on Artist {
        __typename
        id
        title
        image {
          src
          palette
        }
        mark
      }
      ... on Release {
        __typename
        id
        title
        explicit
        image {
          src
          palette
        }
        mark
      }
      ... on Playlist {
        __typename
        id
        title
        trackCount
        image {
          src
          palette
        }
      }
      ... on FavoriteTracks {
        __typename
        id
        positionName
      }
      ... on PersonalWave {
        __typename
        id
        positionName
      }
    }
  }
}"#;

        let variables = serde_json::json!({
            "contentType": "Music",
            "blockName": "DYNAMIC_BLOCK",
            "itemType": ["Artist", "Release", "Playlist", "FavoriteTracks", "PersonalWave"],
            "segment": "UNKNOWN",
            "limit": limit.unwrap_or(30),
            "offset": offset.unwrap_or(0)
        });

        let data = self
            .graphql_op(query, variables, Some("getMusicRecommendations"))
            .await?;

        let items_val = data
            .get("dynamicBlockV2")
            .and_then(|b| b.get("items"))
            .and_then(|i| i.as_array());

        let mut result = Vec::new();
        if let Some(arr) = items_val {
            for item in arr {
                let typename = item
                    .get("__typename")
                    .and_then(|t| t.as_str())
                    .unwrap_or("");

                let id = item
                    .get("id")
                    .map(|v| match v {
                        Value::String(s) => s.clone(),
                        Value::Number(n) => n.to_string(),
                        _ => String::new(),
                    })
                    .unwrap_or_default();

                if id.is_empty() && typename != "FavoriteTracks" && typename != "PersonalWave" {
                    continue;
                }

                let title = item
                    .get("title")
                    .and_then(|t| t.as_str())
                    .or_else(|| item.get("positionName").and_then(|p| p.as_str()))
                    .unwrap_or("")
                    .to_string();

                let img_obj = item.get("image");
                let img_src = img_obj
                    .and_then(|i| i.get("src"))
                    .and_then(|s| s.as_str());
                let image_url = img_src.map(|s| format_image_url(s, 400, 400));
                let palette = img_obj
                    .and_then(|i| i.get("palette"))
                    .and_then(|p| p.as_str())
                    .map(|s| s.to_string());

                let explicit = item
                    .get("explicit")
                    .and_then(|e| e.as_bool())
                    .unwrap_or(false);

                let track_count = item
                    .get("trackCount")
                    .or_else(|| item.get("track_count"))
                    .or_else(|| item.get("count"))
                    .and_then(|tc| match tc {
                        Value::Number(n) => n.as_u64().map(|x| x as u32),
                        Value::String(s) => s.parse::<u32>().ok(),
                        _ => None,
                    });

                if typename == "Playlist" {
                    match track_count {
                        Some(tc) if tc > 0 => {}
                        _ => continue,
                    }
                }

                let subtitle = match typename {
                    "Playlist" => {
                        if let Some(tc) = track_count {
                            Some(format!("{} треков", tc))
                        } else {
                            Some("Плейлист".to_string())
                        }
                    }
                    "Release" => Some("Альбом".to_string()),
                    "Artist" => Some("Исполнитель".to_string()),
                    "FavoriteTracks" => Some("Любимые треки".to_string()),
                    "PersonalWave" => Some("Моя волна".to_string()),
                    _ => None,
                };

                result.push(MusicRecommendationItem {
                    item_type: typename.to_string(),
                    id,
                    title,
                    subtitle,
                    image_url,
                    palette,
                    explicit,
                    track_count,
                });
            }
        }

        Ok(result)
    }

    /// Fetch listening history using the listeningHistory GraphQL query (from trudenboy/zvuk-music).
    pub async fn get_listening_history(
        &self,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<ListeningHistoryItem>, AppError> {
        let query = r#"query listeningHistory($limit: Int = 50, $offset: Int) {
  listeningHistory(limit: $limit, offset: $offset) {
    lastListeningDttm
    mediaContent {
      ... on Track {
        id
        title
        searchTitle
        position
        duration
        availability
        artistTemplate
        condition
        explicit
        lyrics
        zchan
        hasFlac
        artists {
          id
          title
        }
        release {
          id
          title
          image {
            src
            palette
            paletteBottom
          }
        }
      }
      ... on Episode {
        id
        availability
        description
        duration
        explicit
        image {
          src
          palette
          paletteBottom
        }
        link
        listenState
        podcast {
          id
          title
          image {
            src
            palette
            paletteBottom
          }
          authors {
            id
            name
          }
        }
        publicationDate
        title
        trackId
        season {
          seasonNumber
          id
          name
        }
      }
    }
  }
}"#;

        let variables = serde_json::json!({
            "limit": limit.unwrap_or(50),
            "offset": offset.unwrap_or(0),
        });

        let data = self
            .graphql_op(query, variables, Some("listeningHistory"))
            .await?;

        let mut items = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();
        if let Some(arr) = data.get("listeningHistory").and_then(|v| v.as_array()) {
            for item in arr {
                let last_listening_dttm = item
                    .get("lastListeningDttm")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                if let Some(mc) = item.get("mediaContent") {
                    // Try parsing as standard Track
                    if let Some(track) = parse_track_from_value(mc) {
                        if seen_ids.insert(track.id) {
                            items.push(ListeningHistoryItem {
                                last_listening_dttm,
                                track,
                            });
                        }
                        continue;
                    }

                    // Try parsing as Episode
                    let id = mc
                        .get("id")
                        .or_else(|| mc.get("trackId"))
                        .and_then(|i| match i {
                            Value::Number(n) => n.as_i64(),
                            Value::String(s) => s.parse().ok(),
                            _ => None,
                        });

                    if let Some(id) = id {
                        if !seen_ids.insert(id) {
                            continue;
                        }
                        let title = mc
                            .get("title")
                            .and_then(|t| t.as_str())
                            .unwrap_or("Эпизод подкаста")
                            .to_string();

                        let duration = mc
                            .get("duration")
                            .and_then(|d| d.as_u64())
                            .unwrap_or(0) as u32;

                        let podcast_obj = mc.get("podcast");
                        let album = podcast_obj
                            .and_then(|p| p.get("title"))
                            .and_then(|t| t.as_str())
                            .map(|s| s.to_string());
                        let album_id = podcast_obj
                            .and_then(|p| p.get("id"))
                            .and_then(|i| match i {
                                Value::Number(n) => n.as_i64(),
                                Value::String(s) => s.parse().ok(),
                                _ => None,
                            });

                        let mut artists: Vec<TrackArtist> = Vec::new();
                        if let Some(authors_arr) =
                            podcast_obj.and_then(|p| p.get("authors")).and_then(|a| a.as_array())
                        {
                            for a in authors_arr {
                                let aid = a.get("id").and_then(|i| match i {
                                    Value::Number(n) => n.as_i64(),
                                    Value::String(s) => s.parse().ok(),
                                    _ => None,
                                });
                                let aname = a
                                    .get("name")
                                    .or_else(|| a.get("title"))
                                    .and_then(|t| t.as_str());
                                if let (Some(aid), Some(aname)) = (aid, aname) {
                                    artists.push(TrackArtist {
                                        id: aid,
                                        name: aname.to_string(),
                                        image_url: None,
                                        palette: None,
                                    });
                                }
                            }
                        }

                        let artist = if !artists.is_empty() {
                            artists
                                .iter()
                                .map(|a| a.name.as_str())
                                .collect::<Vec<_>>()
                                .join(", ")
                        } else if let Some(ref alb) = album {
                            alb.clone()
                        } else {
                            "Подкаст".to_string()
                        };
                        let artist_id = artists.first().map(|a| a.id);

                        let cover_url = mc
                            .get("image")
                            .or_else(|| podcast_obj.and_then(|p| p.get("image")))
                            .and_then(|img| img.get("src"))
                            .and_then(|s| s.as_str())
                            .map(|src| format_image_url(src, 300, 300));

                        let palette = mc
                            .get("image")
                            .or_else(|| podcast_obj.and_then(|p| p.get("image")))
                            .and_then(|img| img.get("palette"))
                            .and_then(|p| p.as_str())
                            .map(|s| s.to_string());

                        let is_explicit =
                            mc.get("explicit").and_then(|e| e.as_bool()).unwrap_or(false);

                        let track = Track {
                            id,
                            title,
                            duration,
                            artist,
                            artist_id,
                            artists,
                            album,
                            album_id,
                            cover_url,
                            palette,
                            release_year: None,
                            is_explicit,
                            is_liked: None,
                            has_flac: false,
                        };

                        items.push(ListeningHistoryItem {
                            last_listening_dttm,
                            track,
                        });
                    }
                }
            }
        }

        log::info!("[Zvuk API] Fetched {} listening history items", items.len());
        Ok(items)
    }

    /// Fetches raw text from an external URL (e.g. lyrics providers like NetEase, LRC APIs)
    /// bypassing browser CORS limitations.
    pub async fn fetch_proxy(
        &self,
        url: &str,
        headers: Option<std::collections::HashMap<String, String>>,
    ) -> Result<String, AppError> {
        let mut req = self.http.get(url);
        if let Some(h) = headers {
            for (k, v) in h {
                if let (Ok(hn), Ok(hv)) = (
                    reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                    reqwest::header::HeaderValue::from_str(&v),
                ) {
                    req = req.header(hn, hv);
                }
            }
        }
        let res = req.send().await?;
        let status = res.status();
        if status.is_success() {
            let body = res.text().await?;
            Ok(body)
        } else {
            Err(AppError::Api {
                status: status.as_u16(),
                message: format!("HTTP request to {} failed with status {}", url, status),
            })
        }
    }
}


