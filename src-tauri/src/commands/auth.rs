use crate::error::AppError;
use crate::models::{AuthSession, Subscription, UserProfile};
use crate::state::AppState;
use crate::token_manager;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// Login with a manually provided or captured token.
/// Validates the token against the Zvuk API and stores it securely.
#[tauri::command]
pub async fn login_with_token(
    app: AppHandle,
    token: String,
    state: State<'_, AppState>,
) -> Result<UserProfile, AppError> {
    let clean_token = token.trim().trim_matches('"').to_string();
    let session = AuthSession {
        access_token: clean_token,
        refresh_token: None,
        device_id: None,
        at: None,
        rt: None,
    };
    login_with_session(app, session, state).await
}

/// Login with a full authentication session (access token, refresh token, device id).
pub async fn login_with_session(
    app: AppHandle,
    session: AuthSession,
    state: State<'_, AppState>,
) -> Result<UserProfile, AppError> {
    // Set the session on the API client
    state.api_client.set_session(session.clone()).await;

    // Validate by fetching the profile
    match state.api_client.get_profile().await {
        Ok(profile) => {
            // Do NOT allow anonymous guest tokens to masquerade as an authenticated user
            if profile.is_anonymous {
                log::warn!("Rejected anonymous/guest token during login validation: id={}", profile.id);
                state.api_client.clear_token().await;
                return Err(AppError::Unauthorized);
            }

            // Store full session securely in OS credential manager
            token_manager::store_session(&session)?;

            // Cache the user profile
            let mut user = state.current_user.lock().unwrap();
            *user = Some(profile.clone());

            log::info!("User logged in successfully: {:?}", profile.username);

            // Notify all windows (including main window) that auth status changed
            let _ = app.emit("auth-changed", &profile);

            Ok(profile)
        }
        Err(e) => {
            // Clear invalid token
            state.api_client.clear_token().await;
            Err(e)
        }
    }
}

/// Opens an embedded window with the official Zvuk Sber ID login page (https://zvuk.com/login).
/// An initialization script monitors for completion and extracts the auth token upon successful login.
#[tauri::command]
pub async fn open_sber_id_login(app: AppHandle) -> Result<(), AppError> {
    // Focus window if it's already open
    if let Some(win) = app.get_webview_window("sberid-login") {
        let _ = win.set_focus();
        return Ok(());
    }

    let script = r#"
        (function() {
            let authCompleted = false;

            function onAuthSuccess(token, cookieData) {
                if (authCompleted) return;
                if (!token) return;
                token = String(token).trim().replace(/^"|"$/g, '');
                if (token.length < 16) return;

                authCompleted = true;

                try {
                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(18,18,18,0.95);color:#21A038;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:18px;font-weight:600;';
                    overlay.innerHTML = '<div style="font-size:36px;margin-bottom:12px;">✔</div><div>Авторизация выполнена! Вход в Zvuk Desktop...</div>';
                    document.body.appendChild(overlay);
                } catch(e) {}

                // Send via local HTTP callback server directly!
                let callbackUrl = 'http://127.0.0.1:14202/callback?token=' + encodeURIComponent(token);
                if (cookieData) {
                    if (cookieData.refresh_token) callbackUrl += '&refresh_token=' + encodeURIComponent(cookieData.refresh_token);
                    if (cookieData.device_id) callbackUrl += '&device_id=' + encodeURIComponent(cookieData.device_id);
                    if (cookieData.AT) callbackUrl += '&at=' + encodeURIComponent(cookieData.AT);
                    if (cookieData.RT) callbackUrl += '&rt=' + encodeURIComponent(cookieData.RT);
                }

                try { fetch(callbackUrl, { mode: 'no-cors' }); } catch(e) {}
                try { (new Image()).src = callbackUrl; } catch(e) {}

                setTimeout(function() {
                    try {
                        window.location.href = callbackUrl;
                    } catch(e) {}
                }, 200);
            }

            async function checkAuth() {
                if (authCompleted) return;
                try {
                    if (!window.location.hostname.includes('zvuk.com')) return;

                    let cookieData = null;
                    try {
                        const cRes = await fetch('/desktop-data/api/cookieAPI', {
                            credentials: 'include',
                            headers: { 'Accept': 'application/json, text/plain, */*' }
                        });
                        if (cRes.ok) {
                            cookieData = await cRes.json();
                        }
                    } catch(e) {}

                    const res = await fetch('/api/tiny/profile', {
                        credentials: 'include',
                        headers: { 'Accept': 'application/json, text/plain, */*' }
                    });

                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.result && data.result.token) {
                            const r = data.result;
                            if (r.is_anonymous !== true && (r.is_registered === true || r.name || r.username || r.external_profile)) {
                                onAuthSuccess(r.token, cookieData);
                            }
                        }
                    }
                } catch(e) {}
            }

            // Continuous background check
            setInterval(checkAuth, 1500);
            window.addEventListener('focus', checkAuth);
            window.addEventListener('load', checkAuth);

            // Floating manual trigger button for instant completion
            function injectBanner() {
                try {
                    if (!window.location.hostname.includes('zvuk.com')) return;
                    if (document.getElementById('__tauri_auth_btn__')) return;

                    const bar = document.createElement('button');
                    bar.id = '__tauri_auth_btn__';
                    bar.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483640;background:#21A038;color:#fff;border:none;padding:12px 24px;border-radius:30px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;font-weight:bold;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,0.6);display:flex;align-items:center;gap:8px;';
                    bar.innerHTML = '<span>✔</span><span>Я вошел — завершить вход</span>';
                    bar.onclick = function() {
                        bar.innerText = 'Проверка авторизации...';
                        checkAuth();
                    };
                    document.body.appendChild(bar);
                } catch(e) {}
            }

            setInterval(injectBanner, 1500);
            setTimeout(injectBanner, 800);
        })();
    "#;

    let login_url = reqwest::Url::parse("https://zvuk.com/login")
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let app_handle = app.clone();

    WebviewWindowBuilder::new(&app, "sberid-login", WebviewUrl::External(login_url))
        .title("Вход через Сбер ID — Звук")
        .inner_size(540.0, 720.0)
        .center()
        .initialization_script(script)
        .on_navigation(move |url| {
            let url_str = url.as_str();
            log::info!("[Tauri Auth Navigation] Navigating to: {}", url_str);

            if url_str.contains("14202") || url_str.contains("__tauri_auth_token__") {
                if let Ok(parsed_url) = reqwest::Url::parse(url_str) {
                    if let Some(session) = extract_session_from_url(&parsed_url) {
                        log::info!("[Tauri Auth] Testing captured session candidate...");
                        let app_clone = app_handle.clone();

                        tauri::async_runtime::spawn(async move {
                            if let Some(state) = app_clone.try_state::<AppState>() {
                                match login_with_session(app_clone.clone(), session, state).await {
                                    Ok(profile) => {
                                        log::info!("[Tauri Auth] Login verified! User: {:?}. Closing login window.", profile.username);
                                        let _ = close_sberid_window(app_clone).await;
                                    }
                                    Err(err) => {
                                        log::warn!("[Tauri Auth] Candidate session invalid ({:?}). Keeping login window open.", err);
                                    }
                                }
                            }
                        });
                        return false; // Intercept dummy URL navigation
                    }
                }
            } else if url_str.contains("zvuk.com") {
                // If user navigates within zvuk.com (e.g. redirected back after Sber ID)
                let app_clone = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
                    if let Some(win) = app_clone.get_webview_window("sberid-login") {
                        let eval_js = r#"
                            (async () => {
                                try {
                                    let cookieData = null;
                                    try {
                                        const cRes = await fetch('/desktop-data/api/cookieAPI', { credentials: 'include', headers: { 'Accept': 'application/json' } });
                                        if (cRes.ok) cookieData = await cRes.json();
                                    } catch(e) {}

                                    const res = await fetch('/api/tiny/profile', { credentials: 'include' });
                                    if (res.ok) {
                                        const d = await res.json();
                                        if (d && d.result && d.result.token) {
                                            const r = d.result;
                                            if (r.is_anonymous !== true && (r.is_registered === true || r.name || r.username || r.external_profile)) {
                                                let cb = 'http://127.0.0.1:14202/callback?token=' + encodeURIComponent(r.token);
                                                if (cookieData) {
                                                    if (cookieData.refresh_token) cb += '&refresh_token=' + encodeURIComponent(cookieData.refresh_token);
                                                    if (cookieData.device_id) cb += '&device_id=' + encodeURIComponent(cookieData.device_id);
                                                    if (cookieData.AT) cb += '&at=' + encodeURIComponent(cookieData.AT);
                                                    if (cookieData.RT) cb += '&rt=' + encodeURIComponent(cookieData.RT);
                                                }
                                                try { fetch(cb, { mode: 'no-cors' }); } catch(e) {}
                                                try { (new Image()).src = cb; } catch(e) {}
                                                window.location.href = cb;
                                            }
                                        }
                                    }
                                } catch(e) {}
                            })();
                        "#;
                        let _ = win.eval(eval_js);
                    }
                });
            }
            true
        })
        .build()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(())
}

/// Closes the Sber ID login popup window once auth is complete.
#[tauri::command]
pub async fn close_sberid_window(app: AppHandle) -> Result<(), AppError> {
    if let Some(win) = app.get_webview_window("sberid-login") {
        let _ = win.destroy();
    }
    Ok(())
}

use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

fn extract_session_from_url(parsed_url: &reqwest::Url) -> Option<AuthSession> {
    let mut token: Option<String> = None;
    let mut refresh_token: Option<String> = None;
    let mut device_id: Option<String> = None;
    let mut at: Option<String> = None;
    let mut rt: Option<String> = None;

    for (k, v) in parsed_url.query_pairs() {
        let clean = v.trim().trim_matches('"').to_string();
        if clean.is_empty() {
            continue;
        }
        match k.as_ref() {
            "token" => token = Some(clean),
            "refresh_token" => refresh_token = Some(clean),
            "device_id" => device_id = Some(clean),
            "at" => at = Some(clean),
            "rt" => rt = Some(clean),
            _ => {}
        }
    }

    token.map(|access_token| AuthSession {
        access_token,
        refresh_token,
        device_id,
        at,
        rt,
    })
}

fn extract_session_from_request(req: &str) -> Option<AuthSession> {
    if let Some(first_line) = req.lines().next() {
        if let Some(pos) = first_line.find("token=") {
            let q_pos = first_line[..pos].rfind('?').map(|p| p + 1).unwrap_or(pos);
            let rest = &first_line[q_pos..];
            let end = rest.find(' ').unwrap_or(rest.len());
            let query = &rest[..end];

            let mut token: Option<String> = None;
            let mut refresh_token: Option<String> = None;
            let mut device_id: Option<String> = None;
            let mut at: Option<String> = None;
            let mut rt: Option<String> = None;

            for part in query.split('&') {
                if let Some((k, v)) = part.split_once('=') {
                    let decoded = percent_encoding_decode(v).trim().trim_matches('"').to_string();
                    if decoded.is_empty() {
                        continue;
                    }
                    match k {
                        "token" => token = Some(decoded),
                        "refresh_token" => refresh_token = Some(decoded),
                        "device_id" => device_id = Some(decoded),
                        "at" => at = Some(decoded),
                        "rt" => rt = Some(decoded),
                        _ => {}
                    }
                }
            }

            if let Some(access_token) = token {
                return Some(AuthSession {
                    access_token,
                    refresh_token,
                    device_id,
                    at,
                    rt,
                });
            }
        }
    }
    None
}

fn percent_encoding_decode(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(&input[i+1..i+3], 16) {
                result.push(val as char);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

/// Start global HTTP callback server listening continuously on port 14202 for auth callbacks
pub fn start_global_auth_listener(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind("127.0.0.1:14202").await {
            Ok(l) => l,
            Err(e) => {
                log::warn!("[Tauri Auth] Could not bind port 14202: {:?}", e);
                return;
            }
        };

        log::info!("[Tauri Auth] Permanent HTTP callback listener active at http://127.0.0.1:14202/callback");

        while let Ok((mut socket, _)) = listener.accept().await {
            let mut buf = [0u8; 4096];
            if let Ok(n) = socket.read(&mut buf).await {
                let req_str = String::from_utf8_lossy(&buf[..n]);

                // Handle CORS OPTIONS Preflight
                if req_str.starts_with("OPTIONS") {
                    let response = "HTTP/1.1 204 No Content\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Allow-Headers: *\r\n\
Access-Control-Allow-Private-Network: true\r\n\
Connection: close\r\n\r\n";
                    let _ = socket.write_all(response.as_bytes()).await;
                    continue;
                }

                if req_str.contains("/callback") || req_str.contains("token=") {
                    if let Some(session) = extract_session_from_request(&req_str) {
                        log::info!("[Tauri Auth Callback] Received session from browser callback!");

                        let app_clone = app.clone();
                        if let Some(state) = app_clone.try_state::<AppState>() {
                            match login_with_session(app_clone.clone(), session, state).await {
                                Ok(profile) => {
                                    log::info!("[Tauri Auth] Browser login successful for: {:?}", profile.username);

                                    let body = r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Звук — Авторизация успешна</title>
    <style>
        body { background: #121212; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #1e1e1e; border: 1px solid #333; border-radius: 16px; padding: 40px; text-align: center; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        h1 { color: #21A038; font-size: 1.8rem; margin: 0 0 12px 0; }
        p { color: #aaa; font-size: 0.95rem; line-height: 1.5; margin: 0 0 20px 0; }
    </style>
</head>
<body>
    <div class="card">
        <h1>✔ Авторизация выполнена!</h1>
        <p>Вы успешно вошли в Zvuk Desktop. Можете закрыть эту вкладку и вернуться в приложение.</p>
        <script>setTimeout(function(){ window.close(); }, 3000);</script>
    </div>
</body>
</html>"#;
                                    let response = format!(
                                        "HTTP/1.1 200 OK\r\n\
Content-Type: text/html; charset=utf-8\r\n\
Content-Length: {}\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Allow-Headers: *\r\n\
Access-Control-Allow-Private-Network: true\r\n\
Connection: close\r\n\r\n{}",
                                        body.as_bytes().len(),
                                        body
                                    );
                                    let _ = socket.write_all(response.as_bytes()).await;
                                }
                                Err(err) => {
                                    log::warn!("[Tauri Auth] Callback session invalid: {:?}", err);
                                    let body = format!("<!DOCTYPE html><html><head><meta charset='utf-8'></head><body style='background:#121212;color:#ff5555;font-family:sans-serif;text-align:center;padding:50px;'><h2>Ошибка авторизации</h2><p>{:?}</p></body></html>", err);
                                    let response = format!(
                                        "HTTP/1.1 400 Bad Request\r\n\
Content-Type: text/html; charset=utf-8\r\n\
Content-Length: {}\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Allow-Headers: *\r\n\
Access-Control-Allow-Private-Network: true\r\n\r\n{}",
                                        body.as_bytes().len(),
                                        body
                                    );
                                    let _ = socket.write_all(response.as_bytes()).await;
                                }
                            }
                        }
                    }
                }
            }
        }
    });
}

/// Open default system browser to https://zvuk.com/login
#[tauri::command]
pub async fn open_browser_login(app: AppHandle) -> Result<(), AppError> {
    app.opener()
        .open_url("https://zvuk.com/login", None::<String>)
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(())
}

/// Check if we have a stored session/token and validate it.
/// If expired, silently refreshes using the stored refresh_token.
#[tauri::command]
pub async fn check_auth_status(
    state: State<'_, AppState>,
) -> Result<Option<UserProfile>, AppError> {
    match token_manager::get_session() {
        Ok(session) => {
            state.api_client.set_session(session.clone()).await;

            match state.api_client.get_profile().await {
                Ok(profile) => {
                    if profile.is_anonymous {
                        log::warn!("Stored token belongs to an anonymous user, discarding from credentials store.");
                        state.api_client.clear_token().await;
                        let _ = token_manager::delete_token();
                        return Ok(None);
                    }
                    let mut user = state.current_user.lock().unwrap();
                    *user = Some(profile.clone());
                    Ok(Some(profile))
                }
                Err(_) => {
                    // Stored access_token might be expired; attempt silent refresh with refresh_token!
                    if session.refresh_token.is_some() {
                        log::info!("[Auth] Stored token invalid or expired. Attempting silent session refresh...");
                        if state.api_client.refresh_session().await.is_ok() {
                            if let Ok(profile) = state.api_client.get_profile().await {
                                if !profile.is_anonymous {
                                    let mut user = state.current_user.lock().unwrap();
                                    *user = Some(profile.clone());
                                    log::info!("[Auth] Silent session refresh succeeded for user: {:?}", profile.username);
                                    return Ok(Some(profile));
                                }
                            }
                        }
                    }

                    state.api_client.clear_token().await;
                    token_manager::delete_token()?;
                    Ok(None)
                }
            }
        }
        Err(AppError::TokenNotFound) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Logout — clear token from memory and credential store.
#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), AppError> {
    state.api_client.clear_token().await;
    token_manager::delete_token()?;

    let mut user = state.current_user.lock().unwrap();
    *user = None;

    log::info!("User logged out");
    Ok(())
}

/// Get the current user's subscription details.
#[tauri::command]
pub async fn get_subscription(
    state: State<'_, AppState>,
) -> Result<Option<Subscription>, AppError> {
    state.api_client.get_subscription().await
}
