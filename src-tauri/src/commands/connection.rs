//! Connecting to a database and extracting its schema.

use schemacraft_core::inspectors::{
    ConnectionSettings, InspectionOptions, InspectionProgress, ProgressReporter, ServerInformation,
    create_inspector,
};
use schemacraft_core::model::SchemaSnapshot;
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;
use ts_rs::TS;

use crate::error::CommandError;
use crate::state::AppState;

/// Message streamed to the frontend while an inspection runs. Channels deliver in order.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
#[ts(export, export_to = "ipc/")]
pub enum InspectionEvent {
    /// Sent first, so the frontend can cancel the job.
    Started {
        /// Identifier to pass to `cancel_inspection`.
        #[serde(rename = "jobId")]
        job_id: String,
    },
    /// A stage update.
    Progress(InspectionProgress),
}

/// Verifies the connection and returns the server identity.
#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    settings: ConnectionSettings,
) -> Result<ServerInformation, CommandError> {
    let inspector =
        create_inspector(settings.resolve_stored_password(state.credentials.as_ref())?)?;
    tracing::debug!("test_connection requested");
    let information = inspector.test_connection().await?;
    tracing::debug!(product = %information.product, "test_connection succeeded");
    Ok(information)
}

/// Databases the login can open, for the database picker.
#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    settings: ConnectionSettings,
) -> Result<Vec<String>, CommandError> {
    let inspector =
        create_inspector(settings.resolve_stored_password(state.credentials.as_ref())?)?;
    Ok(inspector.list_databases().await?)
}

/// User schemas of the selected database, for the schema filter.
#[tauri::command]
pub async fn list_schemas(
    state: State<'_, AppState>,
    settings: ConnectionSettings,
) -> Result<Vec<String>, CommandError> {
    let inspector =
        create_inspector(settings.resolve_stored_password(state.credentials.as_ref())?)?;
    Ok(inspector.list_schemas().await?)
}

/// Extracts the schema, streaming progress through `on_event`.
#[tauri::command]
pub async fn inspect_database(
    state: State<'_, AppState>,
    settings: ConnectionSettings,
    options: InspectionOptions,
    on_event: Channel<InspectionEvent>,
) -> Result<SchemaSnapshot, CommandError> {
    let inspector =
        create_inspector(settings.resolve_stored_password(state.credentials.as_ref())?)?;
    let (job_id, cancellation) = state.inspection_jobs.start();
    tracing::debug!(job_id, "inspect_database started");
    send(
        &on_event,
        InspectionEvent::Started {
            job_id: job_id.clone(),
        },
    );

    let reporter = ChannelProgress { channel: on_event };
    let result = inspector.inspect(&options, &reporter, cancellation).await;

    state.inspection_jobs.finish(&job_id);
    Ok(result?)
}

/// Cancels a running inspection; the `inspect_database` call then fails with `cancelled`.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn cancel_inspection(state: State<'_, AppState>, job_id: String) -> Result<(), CommandError> {
    if state.inspection_jobs.cancel(&job_id) {
        Ok(())
    } else {
        Err(CommandError::unknown_job(&job_id))
    }
}

struct ChannelProgress {
    channel: Channel<InspectionEvent>,
}

impl ProgressReporter for ChannelProgress {
    fn report(&self, progress: InspectionProgress) {
        send(&self.channel, InspectionEvent::Progress(progress));
    }
}

fn send(channel: &Channel<InspectionEvent>, event: InspectionEvent) {
    if let Err(error) = channel.send(event) {
        tracing::warn!(%error, "could not deliver an inspection event to the window");
    }
}
