use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::canvas::CanvasState;
use super::connection::SavedConnection;
use crate::inspectors::InspectionOptions;
use crate::model::SchemaSnapshot;

/// Newest project format this build writes and reads.
pub const FORMAT_VERSION: u32 = 1;

/// Everything the application holds about an open project.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub struct ProjectContent {
    /// Where the snapshot came from, without the password.
    pub connection: SavedConnection,
    /// Schema and view filters used for the extraction.
    #[serde(default)]
    pub inspection: InspectionOptions,
    /// The schema as last extracted.
    pub snapshot: SchemaSnapshot,
    /// The diagram.
    #[serde(default)]
    pub canvas: CanvasState,
}

impl ProjectContent {
    /// Replaces the snapshot after a refresh, keeping the diagram state of the entities that
    /// survived. New entities carry no state until a layout places them.
    #[must_use]
    pub fn with_refreshed_snapshot(self, snapshot: SchemaSnapshot) -> Self {
        Self {
            canvas: self.canvas.retaining_entities_of(&snapshot),
            snapshot,
            ..self
        }
    }

    /// Content in canonical order, as written to disk.
    #[must_use]
    pub fn normalized(self) -> Self {
        Self {
            canvas: self.canvas.normalized(),
            ..self
        }
    }
}

/// A project file as stored on disk: a small header followed by the content.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub struct Project {
    /// Format the file follows; readers refuse newer formats.
    pub format_version: u32,
    /// Moment the file was written, in UTC.
    pub saved_at: DateTime<Utc>,
    /// Application and version that wrote the file, for diagnostics.
    pub saved_with: String,
    /// The project itself.
    #[serde(flatten)]
    pub content: ProjectContent,
}

impl Project {
    /// Wraps content for writing at the current time.
    pub fn from_content(content: ProjectContent, saved_with: &str) -> Self {
        Self::new(content, Utc::now(), saved_with)
    }

    /// Wraps content for writing with an explicit timestamp.
    pub fn new(content: ProjectContent, saved_at: DateTime<Utc>, saved_with: &str) -> Self {
        Self {
            format_version: FORMAT_VERSION,
            saved_at,
            saved_with: saved_with.to_string(),
            content: content.normalized(),
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

    use chrono::{TimeZone, Utc};

    use super::{FORMAT_VERSION, Project};
    use crate::model::{QualifiedName, SchemaSnapshot};
    use crate::project::test_fixtures::sample_project_content;

    #[test]
    fn files_are_flat_documents_with_a_header() {
        let saved_at = Utc.with_ymd_and_hms(2026, 10, 13, 18, 0, 0).unwrap();
        let project = Project::new(sample_project_content(), saved_at, "SchemaCraft 0.1.0");
        let json = serde_json::to_value(&project).unwrap();

        assert_eq!(json["formatVersion"], FORMAT_VERSION);
        assert_eq!(json["savedAt"], "2026-10-13T18:00:00Z");
        assert_eq!(json["savedWith"], "SchemaCraft 0.1.0");
        assert_eq!(json["connection"]["provider"], "sqlServer");
        assert_eq!(json["snapshot"]["databaseName"], "Northwind");
        assert_eq!(json["canvas"]["detailLevel"], "keys");
        assert!(json.get("content").is_none());

        let restored: Project = serde_json::from_value(json).unwrap();
        assert_eq!(restored, project);
    }

    #[test]
    fn new_projects_store_nodes_in_canonical_order() {
        let project = Project::from_content(sample_project_content(), "SchemaCraft 0.1.0");
        let names: Vec<String> = project
            .content
            .canvas
            .nodes
            .iter()
            .map(|node| node.name.to_string())
            .collect();
        assert_eq!(names, ["dbo.Customers", "sales.Orders"]);
    }

    #[test]
    fn refreshing_keeps_positions_of_surviving_entities_only() {
        let content = sample_project_content();
        let mut refreshed_snapshot: SchemaSnapshot = content.snapshot.clone();
        refreshed_snapshot
            .tables
            .retain(|table| table.name != QualifiedName::new("sales", "Orders"));

        let refreshed = content.with_refreshed_snapshot(refreshed_snapshot);

        assert_eq!(refreshed.snapshot.tables.len(), 1);
        assert!(
            refreshed
                .canvas
                .node(&QualifiedName::new("dbo", "Customers"))
                .is_some()
        );
        assert!(
            refreshed
                .canvas
                .node(&QualifiedName::new("sales", "Orders"))
                .is_none()
        );
    }
}
