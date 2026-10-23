//! Independent file comparison and bounded, cancellable source presentation.

use schemacraft_core::comparison::{self, ProjectComparison, SourceDiffOptions, SourceLineDiff};
use schemacraft_core::model::SchemaSnapshot;
use tauri::{State, ipc::Channel};

use super::{logged, run_blocking};
use crate::{error::CommandError, state::AppState};

/// Compares captured values only; never connects or mutates the active project.
#[tauri::command]
pub async fn compare_project_snapshots(
    reference: SchemaSnapshot,
    compared: SchemaSnapshot,
) -> Result<ProjectComparison, CommandError> {
    logged("compare_project_snapshots", async move {
        run_blocking(move || comparison::compare_snapshots(&reference, &compared))
            .await?
            .map_err(|error| CommandError::invalid_argument(&error.to_string()))
    })
    .await
}

/// Produces one literal source page without logging, persisting or exporting either body.
#[tauri::command]
pub async fn compare_project_source(
    state: State<'_, AppState>,
    reference: String,
    compared: String,
    options: SourceDiffOptions,
    on_started: Channel<String>,
) -> Result<SourceLineDiff, CommandError> {
    logged("compare_project_source", async move {
        let (job_id, cancellation) = state.comparison_jobs.start();
        let _ = on_started.send(job_id.clone());
        let result = run_blocking(move || {
            comparison::compare_source_lines(&reference, &compared, options, || {
                cancellation.is_cancelled()
            })
        })
        .await;
        state.comparison_jobs.finish(&job_id);
        result
    })
    .await
}

/// Cancels one comparison computation; a late result must still be discarded by the caller.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn cancel_project_comparison(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<(), CommandError> {
    if state.comparison_jobs.cancel(&job_id) {
        Ok(())
    } else {
        let error = CommandError::unknown_job(&job_id);
        error.log("cancel_project_comparison");
        Err(error)
    }
}
