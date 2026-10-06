use thiserror::Error;

#[allow(dead_code)]
#[derive(Error, Debug)]
pub enum AppError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Authentication required")]
    Unauthorized,

    #[error("Token not found in secure storage")]
    TokenNotFound,

    #[error("Keyring error: {0}")]
    Keyring(String),

    #[allow(dead_code)]
    #[error("API error: {status} — {message}")]
    Api { status: u16, message: String },

    #[allow(dead_code)]
    #[error("Rate limited. Retry after {retry_after_secs}s")]
    RateLimited { retry_after_secs: u64 },

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Доступ заблокирован сервисом Звук (HTTP 418 / WAF). Сервис блокирует подключение через VPN и зарубежные IP-адреса. Пожалуйста, отключите VPN или добавьте zvuk.com в исключения (direct routing).")]
    VpnBlocked,

    #[error("{0}")]
    Internal(String),
}

// Allow AppError to be returned from Tauri commands
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
