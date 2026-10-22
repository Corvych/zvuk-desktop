use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
}

#[cfg(not(windows))]
use tauri_plugin_notification::NotificationExt;

#[cfg(windows)]
fn get_or_extract_app_icon() -> Option<PathBuf> {
    let base_dir = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("Zvuk Desktop");
    let _ = std::fs::create_dir_all(&base_dir);
    let icon_path = base_dir.join("app_icon.png");

    let icon_bytes = include_bytes!("../../icons/icon.png");
    if !icon_path.exists() || icon_path.metadata().map(|m| m.len()).unwrap_or(0) == 0 {
        let _ = std::fs::write(&icon_path, icon_bytes);
    }

    if icon_path.exists() {
        Some(icon_path)
    } else {
        None
    }
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    url: String,
    filename: Option<String>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("zvuk-desktop")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let mut response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to initiate download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with HTTP status: {}",
            response.status()
        ));
    }

    let total = response.content_length().unwrap_or(0);

    let clean_filename = filename
        .unwrap_or_else(|| "zvuk-desktop-update-setup.exe".to_string())
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect::<String>();

    let temp_dir = std::env::temp_dir();
    let temp_file_path: PathBuf = temp_dir.join(clean_filename);

    log::info!("Downloading update from {} to {:?}", url, temp_file_path);

    let mut file = tokio::fs::File::create(&temp_file_path)
        .await
        .map_err(|e| format!("Failed to create destination file: {}", e))?;

    let mut downloaded: u64 = 0;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Error while downloading chunk: {}", e))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write chunk to disk: {}", e))?;

        downloaded += chunk.len() as u64;

        let percentage = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0).min(100.0)
        } else {
            0.0
        };

        let _ = app.emit(
            "update-download-progress",
            DownloadProgress {
                downloaded,
                total,
                percentage,
            },
        );
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush written file: {}", e))?;

    drop(file);

    log::info!(
        "Update downloaded successfully. Launching installer: {:?}",
        temp_file_path
    );

    let _ = app.emit(
        "update-download-complete",
        temp_file_path.to_string_lossy().to_string(),
    );

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let icon_path = get_or_extract_app_icon();

        // Ensure Windows Registry has Zvuk Desktop AppUserModelId registered
        let _ = std::process::Command::new("reg")
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "add",
                "HKCU\\Software\\Classes\\AppUserModelId\\com.corvych.zvuk-desktop",
                "/v",
                "DisplayName",
                "/t",
                "REG_SZ",
                "/d",
                "Zvuk Desktop",
                "/f",
            ])
            .output();

        if let Some(ref icon) = icon_path {
            let _ = std::process::Command::new("reg")
                .creation_flags(CREATE_NO_WINDOW)
                .args([
                    "add",
                    "HKCU\\Software\\Classes\\AppUserModelId\\com.corvych.zvuk-desktop",
                    "/v",
                    "IconUri",
                    "/t",
                    "REG_SZ",
                    "/d",
                    &icon.to_string_lossy(),
                    "/f",
                ])
                .output();
        }

        // Show native toast notification bound to com.corvych.zvuk-desktop
        let toast = tauri_winrt_notification::Toast::new("com.corvych.zvuk-desktop")
            .title("Обновление загружено")
            .text1("Приложение перезапустится для обновления");

        if let Err(e) = toast.show() {
            log::warn!(
                "Failed to show notification via tauri-winrt-notification: {:?}",
                e
            );
        }
    }

    #[cfg(not(windows))]
    {
        if let Err(e) = app
            .notification()
            .builder()
            .title("Zvuk Desktop")
            .body("Обновление скачано. Приложение перезапустится для обновления.")
            .show()
        {
            log::warn!("Failed to show notification: {}", e);
        }
    }

    // Give user a moment to see the notification and UI state
    tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let current_exe = std::env::current_exe().unwrap_or_default();
        let current_exe_str = current_exe.to_string_lossy().to_string();
        let temp_path_str = temp_file_path.to_string_lossy().to_string();

        let is_msi = temp_file_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|s| s.eq_ignore_ascii_case("msi"))
            .unwrap_or(false);

        // If running in development (target/debug or target/release), prioritize installed application path
        let installed_exe = std::env::var("LOCALAPPDATA")
            .map(|p| {
                std::path::PathBuf::from(p)
                    .join("Zvuk Desktop")
                    .join("zvuk-desktop.exe")
            })
            .ok();

        let target_exe_str = if current_exe_str.contains("target\\debug")
            || current_exe_str.contains("target\\release")
        {
            if let Some(ref inst) = installed_exe {
                if inst.exists() {
                    inst.to_string_lossy().to_string()
                } else {
                    current_exe_str.clone()
                }
            } else {
                current_exe_str.clone()
            }
        } else {
            current_exe_str.clone()
        };

        let ps_script = if is_msi {
            format!(
                "Start-Process -FilePath msiexec.exe -ArgumentList '/i \"{}\" /qn' -Wait; Start-Sleep -Milliseconds 600; if (Test-Path '{}') {{ Start-Process -FilePath '{}' }} elseif (Test-Path \"$env:LOCALAPPDATA\\Zvuk Desktop\\zvuk-desktop.exe\") {{ Start-Process -FilePath \"$env:LOCALAPPDATA\\Zvuk Desktop\\zvuk-desktop.exe\" }}",
                temp_path_str.replace('\'', "''"),
                target_exe_str.replace('\'', "''"),
                target_exe_str.replace('\'', "''"),
            )
        } else {
            format!(
                "Start-Process -FilePath '{}' -ArgumentList '/S' -Wait; Start-Sleep -Milliseconds 600; if (Test-Path '{}') {{ Start-Process -FilePath '{}' }} elseif (Test-Path \"$env:LOCALAPPDATA\\Zvuk Desktop\\zvuk-desktop.exe\") {{ Start-Process -FilePath \"$env:LOCALAPPDATA\\Zvuk Desktop\\zvuk-desktop.exe\" }}",
                temp_path_str.replace('\'', "''"),
                target_exe_str.replace('\'', "''"),
                target_exe_str.replace('\'', "''"),
            )
        };

        log::info!(
            "Launching silent updater and restart via PowerShell: {}",
            ps_script
        );

        std::process::Command::new("powershell")
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &ps_script,
            ])
            .spawn()
            .map_err(|e| format!("Failed to spawn updater process: {}", e))?;

        // Close current application so installer can overwrite files without locking
        app.exit(0);
    }

    #[cfg(not(windows))]
    {
        log::warn!("Automated install is only supported on Windows for this binary.");
    }

    Ok(())
}
