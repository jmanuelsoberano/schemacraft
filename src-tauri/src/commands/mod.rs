//! IPC commands exposed to the frontend. Each submodule groups one feature area.
//!
//! Synchronous commands run on the main thread, so only those that read memory stay
//! synchronous. Commands that touch a file, the credential store or a large computation are
//! async and hand that work to [`run_blocking`] (ADR-031).

pub mod app_info;
pub mod connection;
pub mod credentials;
pub mod export;
pub mod preferences;
pub mod project;

use crate::error::CommandError;

/// Runs `work` on the blocking thread pool and waits for its result, keeping the window and
/// the async workers responsive.
async fn run_blocking<T>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, CommandError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| CommandError::unexpected(&format!("a worker thread failed: {error}")))
}
