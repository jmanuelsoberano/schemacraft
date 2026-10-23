//! IPC commands exposed to the frontend. Each submodule groups one feature area.
//!
//! Synchronous commands run on the main thread, so only those that read memory stay
//! synchronous. Commands that touch a file, the credential store or a large computation are
//! async and hand that work to [`run_blocking`] (ADR-032).
//!
//! Every command that can fail records its failure in the diagnostic log through [`logged`], or
//! [`CommandError::log`] when it is synchronous: its name and the error's kind, never the
//! message (ADR-041).

pub mod app_info;
pub mod comparison;
pub mod connection;
pub mod credentials;
pub mod diagnostics;
pub mod export;
pub mod preferences;
pub mod project;
pub mod support;

use crate::error::CommandError;

/// Awaits the work of `command` and records its failure, if any, in the diagnostic log.
async fn logged<T>(
    command: &'static str,
    work: impl Future<Output = Result<T, CommandError>>,
) -> Result<T, CommandError> {
    work.await.inspect_err(|error| error.log(command))
}

/// Runs `work` on the blocking thread pool and waits for its result, keeping the window and
/// the async workers responsive. A task that cannot be joined, for example one cancelled while
/// the application shuts down, is reported as `unexpected`; release builds abort on a panic, so
/// a panic ends the process instead of reaching the frontend.
async fn run_blocking<T>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, CommandError>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| CommandError::unexpected(&format!("a worker thread failed: {error}")))
}
