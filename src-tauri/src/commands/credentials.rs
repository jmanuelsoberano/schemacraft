//! Remembered passwords. They live in the operating system credential store, never in project
//! files or preferences, and the frontend only learns whether one exists.

use schemacraft_core::project::SavedConnection;
use secrecy::SecretString;
use tauri::State;

use crate::error::CommandError;
use crate::state::AppState;

/// Whether a password is remembered for the login of `connection`. Windows Authentication has
/// no password, so it never has one.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn has_stored_password(
    state: State<'_, AppState>,
    connection: SavedConnection,
) -> Result<bool, CommandError> {
    match connection.credential_key() {
        Some(key) => Ok(state.credentials.contains(&key)?),
        None => Ok(false),
    }
}

/// Remembers `password` for the login of `connection`, replacing any previous one.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn remember_password(
    state: State<'_, AppState>,
    connection: SavedConnection,
    password: SecretString,
) -> Result<(), CommandError> {
    let Some(key) = connection.credential_key() else {
        return Err(CommandError::invalid_argument(
            "only SQL Server logins have a password to remember",
        ));
    };
    state.credentials.store(&key, &password)?;
    tracing::debug!(%key, "password remembered");
    Ok(())
}

/// Forgets the password remembered for the login of `connection`; `false` when there was none.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn forget_password(
    state: State<'_, AppState>,
    connection: SavedConnection,
) -> Result<bool, CommandError> {
    match connection.credential_key() {
        Some(key) => {
            let removed = state.credentials.remove(&key)?;
            tracing::debug!(%key, removed, "password forgotten");
            Ok(removed)
        }
        None => Ok(false),
    }
}
