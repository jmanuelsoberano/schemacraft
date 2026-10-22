//! User-controlled support: local report review/export and fixed web destinations (ADR-046).

use std::path::PathBuf;

use chrono::Utc;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use super::{logged, run_blocking};
use crate::error::CommandError;
use crate::state::AppState;
use crate::support::{self, DiagnosticReport, SupportError, SupportErrorKind, SupportPage};

/// Reads the bounded diagnostic report from the host's known log directory.
#[tauri::command]
pub async fn read_diagnostic_report(app: AppHandle) -> Result<DiagnosticReport, CommandError> {
    logged("read_diagnostic_report", async move {
        let directory = app.state::<AppState>().log_directory.clone();
        let runtime = tauri::webview_version().ok();
        run_blocking(move || {
            support::read_report(directory.as_deref(), runtime.as_deref(), Utc::now())
        })
        .await?
        .map_err(CommandError::from)
    })
    .await
}

/// Writes the exact reviewed report to the user-selected text file, without reading app state.
#[tauri::command]
pub async fn write_diagnostic_report(path: PathBuf, text: String) -> Result<(), CommandError> {
    logged("write_diagnostic_report", async move {
        run_blocking(move || support::write_report(&path, &text))
            .await?
            .map_err(CommandError::from)
    })
    .await
}

/// Opens only the selected fixed support page; diagnostic contents never enter the URL.
#[tauri::command]
pub async fn open_support_page(app: AppHandle, page: SupportPage) -> Result<(), CommandError> {
    logged("open_support_page", async move {
        run_blocking(move || app.opener().open_url(page.url(), None::<&str>))
            .await?
            .map_err(|_| CommandError::from(SupportError::from(SupportErrorKind::PageOpenFailed)))
    })
    .await
}
