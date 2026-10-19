//! Connection history and recent projects. Every change is written to disk before it is
//! returned, so the frontend always holds what the file holds.

use std::path::PathBuf;

use chrono::Utc;
use schemacraft_core::preferences::Preferences;
use schemacraft_core::project::SavedConnection;
use tauri::{AppHandle, Manager, State};

use super::{logged, run_blocking};
use crate::error::CommandError;
use crate::state::AppState;

/// The preferences as loaded at startup and updated since.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn read_preferences(state: State<'_, AppState>) -> Preferences {
    state.preferences.current()
}

/// Puts `connection` at the top of the history.
#[tauri::command]
pub async fn remember_connection(
    app: AppHandle,
    connection: SavedConnection,
) -> Result<Preferences, CommandError> {
    update("remember_connection", app, move |preferences| {
        preferences.remember_connection(connection, Utc::now());
    })
    .await
}

/// Removes `connection` from the history.
#[tauri::command]
pub async fn forget_connection(
    app: AppHandle,
    connection: SavedConnection,
) -> Result<Preferences, CommandError> {
    update("forget_connection", app, move |preferences| {
        preferences.forget_connection(&connection);
    })
    .await
}

/// Puts `path` at the top of the recent projects.
#[tauri::command]
pub async fn remember_project(app: AppHandle, path: PathBuf) -> Result<Preferences, CommandError> {
    update("remember_project", app, move |preferences| {
        preferences.remember_project(&path.to_string_lossy(), Utc::now());
    })
    .await
}

/// Removes `path` from the recent projects, for example after it failed to open.
#[tauri::command]
pub async fn forget_project(app: AppHandle, path: PathBuf) -> Result<Preferences, CommandError> {
    update("forget_project", app, move |preferences| {
        preferences.forget_project(&path.to_string_lossy());
    })
    .await
}

/// Applies `change` and saves the file on a blocking thread, for `command`.
async fn update(
    command: &'static str,
    app: AppHandle,
    change: impl FnOnce(&mut Preferences) + Send + 'static,
) -> Result<Preferences, CommandError> {
    logged(command, async move {
        Ok(run_blocking(move || app.state::<AppState>().preferences.update(change)).await??)
    })
    .await
}
