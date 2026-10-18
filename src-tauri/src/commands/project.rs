//! Opening, saving and refreshing `.scraft` projects. File access and the snapshot work run on
//! a blocking thread, so a large schema never freezes the window.

use std::path::PathBuf;

use schemacraft_core::diff::SchemaDiff;
use schemacraft_core::model::SchemaSnapshot;
use schemacraft_core::project::{self, OpenedProject, Project, ProjectContent};
use tauri::AppHandle;

use super::{logged, run_blocking};
use crate::error::CommandError;

/// Reads a project file, upgrading an older format. A file of a newer format opens read-only
/// when it allows older readers. Fails with a classified error when the file is missing,
/// damaged or written by a newer version that older readers must not open.
#[tauri::command]
pub async fn read_project(path: PathBuf) -> Result<OpenedProject, CommandError> {
    logged("read_project", async move {
        tracing::debug!(path = %path.display(), "read_project requested");
        let read_path = path.clone();
        let opened = run_blocking(move || project::read_project(&read_path)).await??;
        tracing::debug!(
            path = %path.display(),
            tables = opened.project.content.snapshot.tables.len(),
            "project opened"
        );
        Ok(opened)
    })
    .await
}

/// Writes `content` to `path`, stamping it with the current time and application version, and
/// returns the document as written.
#[tauri::command]
pub async fn write_project(
    app: AppHandle,
    path: PathBuf,
    content: ProjectContent,
) -> Result<Project, CommandError> {
    logged("write_project", async move {
        let project = Project::from_content(content, &saved_with(&app));
        let written_path = path.clone();
        let project =
            run_blocking(move || project::write_project(&written_path, &project).map(|()| project))
                .await??;
        tracing::debug!(path = %path.display(), "project saved");
        Ok(project)
    })
    .await
}

/// Compares the snapshot of an open project with a freshly extracted one.
#[tauri::command]
pub async fn compute_schema_diff(
    previous: SchemaSnapshot,
    current: SchemaSnapshot,
) -> Result<SchemaDiff, CommandError> {
    logged(
        "compute_schema_diff",
        run_blocking(move || SchemaDiff::between(&previous, &current)),
    )
    .await
}

/// Replaces the snapshot of `content` with `snapshot`, keeping the diagram state of the entities
/// that survived.
#[tauri::command]
pub async fn refresh_project_content(
    content: ProjectContent,
    snapshot: SchemaSnapshot,
) -> Result<ProjectContent, CommandError> {
    logged(
        "refresh_project_content",
        run_blocking(move || content.with_refreshed_snapshot(snapshot)),
    )
    .await
}

fn saved_with(app: &AppHandle) -> String {
    let package = app.package_info();
    format!("{} {}", package.name, package.version)
}
