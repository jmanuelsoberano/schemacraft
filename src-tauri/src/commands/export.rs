//! Writing SVG, HTML, PNG and PDF exports of the diagram.

use schemacraft_core::export::{self, ExportOutcome, ExportRequest, ExportStage};
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;
use ts_rs::TS;

use super::run_blocking;
use crate::error::CommandError;
use crate::state::AppState;

/// Message streamed to the frontend while an export runs. Channels deliver in order.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
#[ts(export, export_to = "ipc/")]
pub enum ExportEvent {
    /// Sent first, so the frontend can cancel the job.
    Started {
        /// Identifier to pass to `cancel_export`.
        #[serde(rename = "jobId")]
        job_id: String,
    },
    /// The export entered a stage.
    Progress(ExportStage),
}

/// Writes the export described by `request`, streaming its stages through `on_event`. The
/// rendering runs on a blocking thread, so the window stays responsive.
#[tauri::command]
pub async fn export_diagram(
    state: State<'_, AppState>,
    request: ExportRequest,
    on_event: Channel<ExportEvent>,
) -> Result<ExportOutcome, CommandError> {
    let (job_id, cancellation) = state.export_jobs.start();
    tracing::debug!(job_id, format = ?request.format, "export_diagram started");
    send(
        &on_event,
        ExportEvent::Started {
            job_id: job_id.clone(),
        },
    );

    let stage_channel = on_event.clone();
    let finished = run_blocking(move || {
        export::export_diagram(
            &request,
            &|stage| send(&stage_channel, ExportEvent::Progress(stage)),
            &cancellation,
        )
    })
    .await;
    state.export_jobs.finish(&job_id);

    let outcome = finished??;
    tracing::info!(path = %outcome.path, bytes = outcome.bytes, "export written");
    Ok(outcome)
}

/// Cancels a running export; the `export_diagram` call then fails with `cancelled`.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn cancel_export(state: State<'_, AppState>, job_id: String) -> Result<(), CommandError> {
    if state.export_jobs.cancel(&job_id) {
        tracing::debug!(job_id, "export cancellation requested");
        Ok(())
    } else {
        Err(CommandError::unknown_job(&job_id))
    }
}

fn send(channel: &Channel<ExportEvent>, event: ExportEvent) {
    if let Err(error) = channel.send(event) {
        // The window is gone or the channel closed; the export still completes on its own.
        tracing::warn!(%error, "could not deliver an export event");
    }
}
