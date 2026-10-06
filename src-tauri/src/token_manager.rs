use crate::error::AppError;
use crate::models::AuthSession;

const SERVICE_NAME: &str = "zvuk-desktop";
const TOKEN_KEY: &str = "zvuk_auth_token";

/// Stores the user's complete authentication session (access token, refresh token, device id, etc.)
pub fn store_session(session: &AuthSession) -> Result<(), AppError> {
    let entry = keyring::Entry::new(SERVICE_NAME, TOKEN_KEY)
        .map_err(|e| AppError::Keyring(e.to_string()))?;
    let json = serde_json::to_string(session)
        .map_err(|e| AppError::Internal(format!("Failed to serialize auth session: {}", e)))?;
    entry
        .set_password(&json)
        .map_err(|e| AppError::Keyring(e.to_string()))?;
    Ok(())
}

/// Stores a simple token (convenience / backwards-compatible wrapper).
#[allow(dead_code)]
pub fn store_token(token: &str) -> Result<(), AppError> {
    store_session(&AuthSession {
        access_token: token.trim().trim_matches('"').to_string(),
        refresh_token: None,
        device_id: None,
        at: None,
        rt: None,
    })
}

/// Retrieves the stored authentication session. Supports backward compatibility with plain legacy tokens.
pub fn get_session() -> Result<AuthSession, AppError> {
    let entry = keyring::Entry::new(SERVICE_NAME, TOKEN_KEY)
        .map_err(|e| AppError::Keyring(e.to_string()))?;
    let raw = entry.get_password().map_err(|_| AppError::TokenNotFound)?;

    if raw.trim_start().starts_with('{') {
        if let Ok(session) = serde_json::from_str::<AuthSession>(&raw) {
            return Ok(session);
        }
    }

    // Fallback: legacy plain access token string
    Ok(AuthSession {
        access_token: raw.trim().trim_matches('"').to_string(),
        refresh_token: None,
        device_id: None,
        at: None,
        rt: None,
    })
}

/// Retrieves the stored access token from the session.
#[allow(dead_code)]
pub fn get_token() -> Result<String, AppError> {
    get_session().map(|s| s.access_token)
}

/// Deletes the stored session/token (logout).
pub fn delete_token() -> Result<(), AppError> {
    let entry = keyring::Entry::new(SERVICE_NAME, TOKEN_KEY)
        .map_err(|e| AppError::Keyring(e.to_string()))?;
    // Ignore "not found" errors on delete — idempotent logout
    let _ = entry.delete_credential();
    Ok(())
}
