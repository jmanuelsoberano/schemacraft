use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::canvas::CanvasState;
use super::connection::SavedConnection;
use crate::inspectors::InspectionOptions;
use crate::model::{SchemaSnapshot, UnknownFields};

/// Newest project format this build writes and reads. Format 3 adds the snapshot's
/// `programmability` and optional state facts to indexes, keys, constraints and the access
/// profile; every one is a key that format 2 readers keep or ignore (ADR-042).
pub const FORMAT_VERSION: u32 = 3;

/// Oldest format a reader must understand to open the files this build writes. A reader whose
/// format is older than a file's but at least the file's `minReaderVersion` opens it read-only;
/// an older reader refuses it. Format 3 changes no meaning and no closed enum of format 2, so
/// SchemaCraft 1.1 still opens these files, read-only.
pub const MIN_READER_VERSION: u32 = 2;

/// Keys of the file header. Content arriving from the frontend may still carry them among its
/// unknown keys, and writing them twice would make the header ambiguous.
const HEADER_KEYS: [&str; 4] = ["formatVersion", "minReaderVersion", "savedAt", "savedWith"];

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
    /// Keys written by a newer version, kept as they are.
    #[serde(flatten)]
    #[ts(skip)]
    pub unknown: UnknownFields,
}

impl ProjectContent {
    /// Replaces the snapshot after a refresh, keeping the diagram state of the entities that
    /// survived. New entities carry no state until a layout places them.
    ///
    /// Facts the fresh snapshot could not check are kept from the saved one first, the same
    /// merge the refresh review compares against
    /// ([`SchemaSnapshot::with_unchecked_facts_from`]), so a login that sees less never removes
    /// a table or a text from the project.
    #[must_use]
    pub fn with_refreshed_snapshot(self, snapshot: SchemaSnapshot) -> Self {
        let snapshot = snapshot.with_unchecked_facts_from(&self.snapshot);
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
    /// Format the file follows.
    pub format_version: u32,
    /// Oldest format a reader must understand to open the file. A reader older than
    /// `format_version` but at least this version opens the file read-only; an older reader
    /// refuses it. SchemaCraft 1.0 did not write it; reading such a file upgrades it.
    #[serde(default)]
    pub min_reader_version: u32,
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
    pub fn new(mut content: ProjectContent, saved_at: DateTime<Utc>, saved_with: &str) -> Self {
        for key in HEADER_KEYS {
            content.unknown.remove(key);
        }
        Self {
            format_version: FORMAT_VERSION,
            min_reader_version: MIN_READER_VERSION,
            saved_at,
            saved_with: saved_with.to_string(),
            content: content.normalized(),
        }
    }
}

/// A project read from disk, with what the application may do with it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub struct OpenedProject {
    /// The document, upgraded to the current format when it was older.
    pub project: Project,
    /// Whether the file follows a newer format that this version can show but must not write:
    /// saving would lose or misstate facts it does not understand.
    pub is_read_only: bool,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

    use chrono::{TimeZone, Utc};

    use super::{FORMAT_VERSION, MIN_READER_VERSION, Project};
    use crate::diff::SchemaDiff;
    use crate::model::test_fixtures::reader_snapshot;
    use crate::model::{
        ForeignKey, QualifiedName, ReferentialAction, SchemaSnapshot, SnapshotFact,
    };
    use crate::project::test_fixtures::sample_project_content;

    #[test]
    fn files_are_flat_documents_with_a_header() {
        let saved_at = Utc.with_ymd_and_hms(2026, 10, 13, 18, 0, 0).unwrap();
        let project = Project::new(sample_project_content(), saved_at, "SchemaCraft 0.1.0");
        let json = serde_json::to_value(&project).unwrap();

        assert_eq!(json["formatVersion"], FORMAT_VERSION);
        assert_eq!(json["minReaderVersion"], MIN_READER_VERSION);
        assert_eq!(json["savedAt"], "2026-10-13T18:00:00Z");
        assert_eq!(json["savedWith"], "SchemaCraft 0.1.0");
        assert_eq!(json["connection"]["provider"], "sqlServer");
        assert_eq!(json["snapshot"]["databaseName"], "Northwind");
        assert_eq!(json["canvas"]["detailLevel"], "keys");
        assert!(json.get("content").is_none());
        assert!(json.get("unknown").is_none());

        let restored: Project = serde_json::from_value(json).unwrap();
        assert_eq!(restored, project);
    }

    #[test]
    fn keys_unknown_to_this_version_are_kept_at_every_level() {
        let saved_at = Utc.with_ymd_and_hms(2026, 10, 13, 18, 0, 0).unwrap();
        let project = Project::new(sample_project_content(), saved_at, "SchemaCraft 1.1.0");
        let mut json = serde_json::to_value(&project).unwrap();
        json["reviewNotes"] = serde_json::json!({ "by": "dba", "approved": true });
        json["snapshot"]["lineage"] = serde_json::json!(["capture", 42]);
        json["canvas"]["gridSize"] = serde_json::json!(16);
        json["canvas"]["nodes"][0]["colour"] = serde_json::json!("teal");

        let restored: Project = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(
            restored.content.unknown.get("reviewNotes"),
            Some(&json["reviewNotes"])
        );
        assert_eq!(
            restored.content.snapshot.unknown.get("lineage"),
            Some(&json["snapshot"]["lineage"])
        );
        assert_eq!(
            restored.content.canvas.unknown.get("gridSize"),
            Some(&json["canvas"]["gridSize"])
        );
        assert_eq!(
            restored.content.canvas.nodes[0].unknown.get("colour"),
            Some(&json["canvas"]["nodes"][0]["colour"])
        );
        // Header fields are never mistaken for unknown content.
        assert!(!restored.content.unknown.contains_key("formatVersion"));
        assert!(!restored.content.unknown.contains_key("minReaderVersion"));

        assert_eq!(serde_json::to_value(&restored).unwrap(), json);
    }

    #[test]
    fn header_keys_sent_back_as_content_are_not_written_twice() {
        let mut content = sample_project_content();
        content
            .unknown
            .insert("formatVersion".to_string(), serde_json::json!(1));
        content.unknown.insert(
            "savedWith".to_string(),
            serde_json::json!("SchemaCraft 1.0.0"),
        );
        content
            .unknown
            .insert("reviewNotes".to_string(), serde_json::json!("kept"));

        let project = Project::from_content(content, "SchemaCraft 1.1.0");
        let text = serde_json::to_string(&project).unwrap();

        assert_eq!(text.matches("\"formatVersion\"").count(), 1);
        assert_eq!(text.matches("\"savedWith\"").count(), 1);
        assert_eq!(project.content.unknown.len(), 1);
        assert_eq!(project.format_version, FORMAT_VERSION);
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

    #[test]
    fn refreshing_with_a_login_that_sees_less_keeps_what_it_could_not_check() {
        let content = sample_project_content();
        let saved = content.snapshot.clone();

        let refreshed = content.with_refreshed_snapshot(reader_snapshot());

        let customers = QualifiedName::new("dbo", "Customers");
        assert_eq!(refreshed.snapshot.tables, saved.tables);
        assert_eq!(refreshed.snapshot.foreign_keys, saved.foreign_keys);
        assert!(refreshed.canvas.node(&customers).is_some());
        assert!(
            refreshed
                .snapshot
                .carried_over
                .iter()
                .any(|carried| carried.object == customers && carried.fact == SnapshotFact::Table)
        );
        // The profile describes the refresh, not the saved snapshot.
        assert_eq!(refreshed.snapshot.access, reader_snapshot().access);
        // The review lists exactly what the refresh keeps.
        assert_eq!(
            SchemaDiff::between(&saved, &reader_snapshot()).not_checked,
            refreshed.snapshot.carried_over
        );
    }

    #[test]
    fn refreshing_records_what_was_read_of_a_key_whose_target_became_invisible() {
        let content = sample_project_content();
        let saved = content.snapshot.foreign_keys[0].clone();
        let mut fresh = reader_snapshot();
        fresh.foreign_keys_to_invisible_tables[0].on_delete = ReferentialAction::Cascade;
        fresh.foreign_keys_to_invisible_tables[0].is_enabled = false;

        let refreshed = content.with_refreshed_snapshot(fresh);

        assert_eq!(
            refreshed.snapshot.foreign_keys,
            [ForeignKey {
                on_delete: ReferentialAction::Cascade,
                is_enabled: false,
                ..saved
            }]
        );
        assert_eq!(refreshed.snapshot.foreign_keys_to_invisible_tables, []);
    }
}
