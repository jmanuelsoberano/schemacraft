//! Static information about the running application.

use serde::Serialize;
use tauri::AppHandle;
use ts_rs::TS;

/// Build-time facts about the application, shown in the status bar and the about dialog.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ipc/")]
pub struct AppInfo {
    /// Product name from the Tauri configuration.
    pub name: String,
    /// Semantic version of the build.
    pub version: String,
    /// `true` for development builds, where extra diagnostics are shown in the UI.
    pub is_debug_build: bool,
}

/// Returns name and version of the running application.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn get_app_info(app: AppHandle) -> AppInfo {
    let package_info = app.package_info();
    tracing::debug!("get_app_info invoked");

    AppInfo {
        name: package_info.name.clone(),
        version: package_info.version.to_string(),
        is_debug_build: cfg!(debug_assertions),
    }
}
