//! Remembered passwords. They live in the operating system credential store, never in project
//! files or preferences, and the frontend only learns whether one exists.

use schemacraft_core::project::SavedConnection;
use secrecy::SecretString;
use tauri::{AppHandle, Manager};

use super::run_blocking;
use crate::error::CommandError;
use crate::state::AppState;

/// Whether a password is remembered for the login of `connection`. Windows Authentication has
/// no password, so it never has one.
#[tauri::command]
pub async fn has_stored_password(
    app: AppHandle,
    connection: SavedConnection,
) -> Result<bool, CommandError> {
    let Some(key) = connection.credential_key() else {
        return Ok(false);
    };
    Ok(run_blocking(move || app.state::<AppState>().credentials.contains(&key)).await??)
}

/// Remembers `password` for the login of `connection`, replacing any previous one.
#[tauri::command]
pub async fn remember_password(
    app: AppHandle,
    connection: SavedConnection,
    password: SecretString,
) -> Result<(), CommandError> {
    let Some(key) = connection.credential_key() else {
        return Err(CommandError::invalid_argument(
            "only SQL Server logins have a password to remember",
        ));
    };
    let stored_key = key.clone();
    run_blocking(move || {
        app.state::<AppState>()
            .credentials
            .store(&stored_key, &password)
    })
    .await??;
    tracing::debug!(%key, "password remembered");
    Ok(())
}

/// Forgets the password remembered for the login of `connection`; `false` when there was none.
#[tauri::command]
pub async fn forget_password(
    app: AppHandle,
    connection: SavedConnection,
) -> Result<bool, CommandError> {
    let Some(key) = connection.credential_key() else {
        return Ok(false);
    };
    let removed_key = key.clone();
    let removed =
        run_blocking(move || app.state::<AppState>().credentials.remove(&removed_key)).await??;
    tracing::debug!(%key, removed, "password forgotten");
    Ok(removed)
}
