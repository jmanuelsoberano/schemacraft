//! Opening, saving and refreshing `.scraft` projects.

use std::path::PathBuf;

use schemacraft_core::diff::SchemaDiff;
use schemacraft_core::model::SchemaSnapshot;
use schemacraft_core::project::{self, Project, ProjectContent};
use tauri::AppHandle;

use crate::error::CommandError;

/// Reads a project file. Fails with a classified error when the file is missing, damaged or
/// written by a newer version.
#[tauri::command]
pub async fn read_project(path: PathBuf) -> Result<Project, CommandError> {
    tracing::debug!(path = %path.display(), "read_project requested");
    let project = project::read_project(&path)?;
    tracing::info!(
        path = %path.display(),
        tables = project.content.snapshot.tables.len(),
        "project opened"
    );
    Ok(project)
}

/// Writes `content` to `path`, stamping it with the current time and application version, and
/// returns the document as written.
#[tauri::command]
pub async fn write_project(
    app: AppHandle,
    path: PathBuf,
    content: ProjectContent,
) -> Result<Project, CommandError> {
    let project = Project::from_content(content, &saved_with(&app));
    project::write_project(&path, &project)?;
    tracing::info!(path = %path.display(), "project saved");
    Ok(project)
}

/// Compares the snapshot of an open project with a freshly extracted one.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects command arguments by value"
)]
pub fn compute_schema_diff(previous: SchemaSnapshot, current: SchemaSnapshot) -> SchemaDiff {
    SchemaDiff::between(&previous, &current)
}

/// Replaces the snapshot of `content` with `snapshot`, keeping the diagram state of the entities
/// that survived.
#[tauri::command]
pub fn refresh_project_content(
    content: ProjectContent,
    snapshot: SchemaSnapshot,
) -> ProjectContent {
    content.with_refreshed_snapshot(snapshot)
}

fn saved_with(app: &AppHandle) -> String {
    let package = app.package_info();
    format!("{} {}", package.name, package.version)
}
