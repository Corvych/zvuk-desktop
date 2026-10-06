use std::path::PathBuf;

pub const DEFAULT_CACHE_LIMIT_MB: u64 = 500;

pub fn get_settings_path() -> Option<PathBuf> {
    if let Some(appdata) = std::env::var_os("APPDATA") {
        return Some(
            PathBuf::from(appdata)
                .join("com.corvych.zvuk-desktop")
                .join("app_settings.json"),
        );
    }
    Some(PathBuf::from("app_settings.json"))
}

pub fn get_saved_cache_limit_mb() -> u64 {
    if let Some(path) = get_settings_path() {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(mb) = val.get("cache_limit_mb").and_then(|v| v.as_u64()) {
                    if (100..=4096).contains(&mb) {
                        return mb;
                    }
                }
            }
        }
    }
    DEFAULT_CACHE_LIMIT_MB
}

#[cfg(target_os = "windows")]
pub fn apply_cache_browser_args() {
    let cache_limit_mb = get_saved_cache_limit_mb();
    let cache_limit_bytes = cache_limit_mb * 1024 * 1024;
    let js_heap_mb = cache_limit_mb.clamp(256, 1024);
    let cache_args = format!(
        "--disk-cache-size={} --media-cache-size={} --js-flags=--max-old-space-size={}",
        cache_limit_bytes, cache_limit_bytes, js_heap_mb
    );

    let combined = match std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
        Ok(existing) if !existing.trim().is_empty() => {
            if !existing.contains("--disk-cache-size") {
                format!("{} {}", existing.trim(), cache_args)
            } else {
                existing
            }
        }
        _ => cache_args,
    };
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", combined);
}

#[cfg(not(target_os = "windows"))]
pub fn apply_cache_browser_args() {}

#[tauri::command]
pub fn get_cache_limit_mb() -> u64 {
    get_saved_cache_limit_mb()
}

#[tauri::command]
pub fn set_cache_limit_mb(limit_mb: u64) -> Result<(), String> {
    if !(100..=4096).contains(&limit_mb) {
        return Err("Лимит кэша должен быть в диапазоне от 100 до 4096 МБ".into());
    }

    if let Some(path) = get_settings_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let mut settings = serde_json::json!({});
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if val.is_object() {
                    settings = val;
                }
            }
        }

        settings["cache_limit_mb"] = serde_json::json!(limit_mb);

        std::fs::write(&path, settings.to_string())
            .map_err(|e| format!("Не удалось сохранить настройки кэша: {}", e))?;
    }

    Ok(())
}
