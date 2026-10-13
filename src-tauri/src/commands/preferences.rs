//! Connection history and recent projects. Every change is written to disk before it is
//! returned, so the frontend always holds what the file holds.

use chrono::Utc;
use schemacraft_core::preferences::Preferences;
use schemacraft_core::project::SavedConnection;
use tauri::State;

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
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn remember_connection(
    state: State<'_, AppState>,
    connection: SavedConnection,
) -> Result<Preferences, CommandError> {
    Ok(state.preferences.update(|preferences| {
        preferences.remember_connection(connection, Utc::now());
    })?)
}

/// Removes `connection` from the history.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn forget_connection(
    state: State<'_, AppState>,
    connection: SavedConnection,
) -> Result<Preferences, CommandError> {
    Ok(state.preferences.update(|preferences| {
        preferences.forget_connection(&connection);
    })?)
}

/// Puts `path` at the top of the recent projects.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn remember_project(
    state: State<'_, AppState>,
    path: String,
) -> Result<Preferences, CommandError> {
    Ok(state.preferences.update(|preferences| {
        preferences.remember_project(&path, Utc::now());
    })?)
}

/// Removes `path` from the recent projects, for example after it failed to open.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn forget_project(
    state: State<'_, AppState>,
    path: String,
) -> Result<Preferences, CommandError> {
    Ok(state.preferences.update(|preferences| {
        preferences.forget_project(&path);
    })?)
}
