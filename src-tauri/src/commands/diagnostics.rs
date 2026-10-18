//! The local diagnostic log (ADR-041): opening its folder, so a user can attach today's file to
//! a bug report after reading it.

use std::fs;

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use super::{logged, run_blocking};
use crate::error::CommandError;
use crate::state::AppState;

/// Opens the folder of the diagnostic log in the file manager. The folder comes from the
/// application state, never from the frontend, so this command opens nothing else, and the
/// opener plugin is called from Rust, so no capability of the window grows.
#[tauri::command]
pub async fn open_log_folder(app: AppHandle) -> Result<(), CommandError> {
    logged("open_log_folder", async move {
        run_blocking(move || {
            let directory = app
                .state::<AppState>()
                .log_directory
                .clone()
                .ok_or_else(|| {
                    CommandError::invalid_argument("this session writes no diagnostic log")
                })?;
            // The user may have deleted the folder since; it is created again so the file manager
            // can open it. Events go on to the file that is already open: the appender creates the
            // folder only when it opens a file, at launch and at the UTC day's rollover, so the
            // folder stays empty until then.
            fs::create_dir_all(&directory).map_err(|error| {
                CommandError::unexpected(&format!("the log folder could not be created: {error}"))
            })?;
            app.opener()
                .open_path(directory.to_string_lossy(), None::<&str>)
                .map_err(|error| {
                    CommandError::unexpected(&format!(
                        "the log folder could not be opened: {error}"
                    ))
                })
        })
        .await?
    })
    .await
}
