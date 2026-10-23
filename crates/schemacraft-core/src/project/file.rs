use std::path::Path;
use std::time::Instant;

use serde::Deserialize;
use serde_json::Value;

use super::document::{FORMAT_VERSION, OpenedProject, Project};
use super::error::ProjectError;
use super::migrations;
use crate::diagnostics;
use crate::fs::{FileError, read_bytes, write_json_atomically};

/// The two header fields that decide how a file is read, taken before the rest is parsed.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionHeader {
    format_version: Option<u32>,
    min_reader_version: Option<u32>,
}

/// Reads a project file, checking its versions before the content is interpreted.
///
/// Older formats are upgraded in memory. A newer format opens read-only when its
/// `minReaderVersion` says this version may show it, and is refused otherwise; so is one whose
/// content this version cannot parse, because a value it does not know is not damage.
///
/// A file that opens is recorded in the diagnostic log by its format, size and reading time.
pub fn read_project(path: &Path) -> Result<OpenedProject, ProjectError> {
    let started = Instant::now();
    let bytes = read_bytes(path).map_err(|error| match error {
        FileError::NotFound => ProjectError::NotFound {
            path: display(path),
        },
        FileError::Read(details) | FileError::Write(details) => ProjectError::Read {
            path: display(path),
            details,
        },
    })?;

    let not_a_project = |details: String| ProjectError::NotAProject {
        path: display(path),
        details,
    };
    let mut document: Value =
        serde_json::from_slice(&bytes).map_err(|error| not_a_project(error.to_string()))?;
    if !document.is_object() {
        return Err(not_a_project(
            "the document is not a JSON object".to_string(),
        ));
    }
    let header =
        VersionHeader::deserialize(&document).map_err(|error| not_a_project(error.to_string()))?;
    let found = header
        .format_version
        .ok_or_else(|| not_a_project("the formatVersion field is missing".to_string()))?;
    let unsupported = || ProjectError::UnsupportedFormatVersion {
        path: display(path),
        found,
        supported: FORMAT_VERSION,
    };
    if header.min_reader_version.unwrap_or(found) > FORMAT_VERSION {
        return Err(unsupported());
    }

    let is_read_only = found > FORMAT_VERSION;
    if found < FORMAT_VERSION {
        migrations::upgrade(&mut document, found);
    }
    let project: Project = serde_json::from_value(document).map_err(|error| {
        if is_read_only {
            unsupported()
        } else {
            not_a_project(error.to_string())
        }
    })?;
    project.content.validate().map_err(|details| {
        if is_read_only {
            unsupported()
        } else {
            not_a_project(details.to_string())
        }
    })?;
    diagnostics::project_opened(found, is_read_only, bytes.len(), started.elapsed());
    Ok(OpenedProject {
        project,
        is_read_only,
    })
}

/// Writes a project file atomically: the previous file survives any failure. A written file is
/// recorded in the diagnostic log by its format, size and writing time.
pub fn write_project(path: &Path, project: &Project) -> Result<(), ProjectError> {
    let started = Instant::now();
    project
        .content
        .validate()
        .map_err(|details| ProjectError::Write {
            path: display(path),
            details: details.to_string(),
        })?;
    let bytes = write_json_atomically(path, project).map_err(|error| ProjectError::Write {
        path: display(path),
        details: error.to_string(),
    })?;
    diagnostics::project_saved(project.format_version, bytes, started.elapsed());
    Ok(())
}

fn display(path: &Path) -> String {
    path.display().to_string()
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )]

    use std::fs;
    use std::path::Path;

    use serde_json::{Value, json};

    use super::{read_project, write_project};
    use crate::diff::{SchemaDiff, TableChange};
    use crate::model::test_fixtures::sample_programmability;
    use crate::model::{AccessLevel, Completeness, Definition, QualifiedName, SnapshotFact};
    use crate::project::document::{FORMAT_VERSION, MIN_READER_VERSION, Project};
    use crate::project::error::ProjectError;
    use crate::project::test_fixtures::{
        FORMAT_1_PROJECT, FORMAT_2_PROJECT, sample_project_content,
    };

    fn sample_project() -> Project {
        Project::from_content(sample_project_content(), "SchemaCraft 0.1.0")
    }

    /// The sample project as a newer version would write it, with the given header.
    fn newer_document(format_version: u32, min_reader_version: Option<u32>) -> Value {
        let mut json = serde_json::to_value(sample_project()).unwrap();
        json["formatVersion"] = json!(format_version);
        match min_reader_version {
            Some(version) => json["minReaderVersion"] = json!(version),
            None => {
                json.as_object_mut().unwrap().remove("minReaderVersion");
            }
        }
        json
    }

    fn write_json(path: &Path, value: &Value) {
        fs::write(path, serde_json::to_string_pretty(value).unwrap()).unwrap();
    }

    #[test]
    fn round_trips_through_disk() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("northwind.scraft");
        let project = sample_project();

        write_project(&path, &project).unwrap();
        let opened = read_project(&path).unwrap();

        assert_eq!(opened.project, project);
        assert!(!opened.is_read_only);
        assert!(!directory.path().join("northwind.scraft.tmp").exists());
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("{\n  \"formatVersion\": 4,\n  \"minReaderVersion\": 4,"));
        assert!(text.ends_with("}\n"));
    }

    #[test]
    fn maps_and_authored_notes_round_trip_and_invalid_edits_cannot_replace_a_file() {
        use crate::model::UnknownFields;
        use crate::project::{NoteTarget, ProjectNote, SavedPerspective};
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("documented.scraft");
        let mut content = sample_project_content();
        content.perspectives.push(SavedPerspective {
            id: "sales".into(),
            name: "Sales".into(),
            description: Some("Start with orders".into()),
            canvas: content.canvas.clone(),
            unknown: UnknownFields::new(),
        });
        content.active_perspective_id = Some("sales".into());
        let mut note = ProjectNote {
            id: "note-1".into(),
            target: NoteTarget::Table {
                table: QualifiedName::new("sales", "Orders"),
            },
            text: "User text <script> stays literal".into(),
            is_linked: true,
            unknown: UnknownFields::new(),
        };
        note.unknown.insert("futureNoteKey".into(), json!("kept"));
        content.annotations.notes.push(note);
        let project = Project::from_content(content, "SchemaCraft");
        write_project(&path, &project).unwrap();
        assert_eq!(read_project(&path).unwrap().project, project);
        let bytes = fs::read(&path).unwrap();
        let mut invalid = project;
        invalid.content.perspectives[0].name = " ".into();
        assert!(write_project(&path, &invalid).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
        invalid.content.perspectives[0].name = "Sales".into();
        let mut duplicate = invalid.content.annotations.notes[0].clone();
        duplicate.id = "note-2".into();
        invalid.content.annotations.notes.push(duplicate);
        assert!(write_project(&path, &invalid).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn dotted_names_remain_distinct_through_save_load_and_refresh() {
        let dotted_schema = QualifiedName::new("a.b", "c");
        let dotted_object = QualifiedName::new("a", "b.c");
        let mut content = sample_project_content();
        content.snapshot.access = None;
        content.snapshot.tables[0].name = dotted_schema.clone();
        content.snapshot.tables[1].name = dotted_object.clone();
        content.snapshot.views.clear();
        content.snapshot.foreign_keys[0].referencing_table = dotted_object.clone();
        content.snapshot.foreign_keys[0].referenced_table = dotted_schema.clone();
        content.canvas.nodes[0].name = dotted_object.clone();
        content.canvas.nodes[0].is_hidden = true;
        content.canvas.nodes[1].name = dotted_schema.clone();
        let expected_survivor = content.canvas.nodes[0].clone();
        let mut updated_position = content.canvas.nodes[1].clone();
        updated_position.position.x = 740.0;
        content.canvas.nodes.push(updated_position.clone());

        // Saving deduplicates only the repeated structured name, never its dotted spelling.
        let project = Project::from_content(content, "SchemaCraft 1.2.0");
        assert_eq!(project.content.canvas.nodes.len(), 2);
        assert_eq!(
            project.content.canvas.node(&dotted_schema),
            Some(&updated_position)
        );
        assert_eq!(
            project.content.canvas.node(&dotted_object),
            Some(&expected_survivor)
        );
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("dotted-names.scraft");
        write_project(&path, &project).unwrap();
        let opened = read_project(&path).unwrap();
        assert_eq!(opened.project, project);

        // One object changes while the other disappears, although both display as a.b.c.
        let mut fresh = opened.project.content.snapshot.clone();
        fresh.tables.retain(|table| table.name == dotted_object);
        fresh.tables[0].columns[0].is_nullable = true;
        fresh.foreign_keys.clear();
        let diff = SchemaDiff::between(&opened.project.content.snapshot, &fresh);
        assert_eq!(diff.tables.len(), 2);
        assert!(diff.tables.iter().any(|change| matches!(
            change,
            TableChange::Removed { name, .. } if name == &dotted_schema
        )));
        assert!(diff.tables.iter().any(|change| matches!(
            change,
            TableChange::Changed { name, .. } if name == &dotted_object
        )));

        let refreshed = opened.project.content.with_refreshed_snapshot(fresh);
        assert_eq!(refreshed.canvas.nodes, vec![expected_survivor]);
        assert_eq!(refreshed.snapshot.tables[0].name, dotted_object);
        assert!(refreshed.snapshot.tables[0].columns[0].is_nullable);
    }

    #[test]
    fn creates_missing_directories_and_replaces_existing_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join("nested")
            .join("deeper")
            .join("db.scraft");

        write_project(&path, &sample_project()).unwrap();
        let mut updated = sample_project();
        updated.saved_with = "SchemaCraft 0.2.0".to_string();
        write_project(&path, &updated).unwrap();

        assert_eq!(
            read_project(&path).unwrap().project.saved_with,
            "SchemaCraft 0.2.0"
        );
    }

    #[test]
    fn reports_a_missing_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("gone.scraft");
        assert!(matches!(
            read_project(&path),
            Err(ProjectError::NotFound { .. })
        ));
    }

    #[test]
    fn rejects_files_that_are_not_projects() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("notes.scraft");

        for text in [
            "just some text",
            "[2, 2]",
            r#"{ "snapshot": {} }"#,
            r#"{ "formatVersion": "two" }"#,
            r#"{ "formatVersion": 2, "snapshot": "nope" }"#,
            r#"{ "formatVersion": 1, "snapshot": "nope" }"#,
        ] {
            fs::write(&path, text).unwrap();
            assert!(
                matches!(read_project(&path), Err(ProjectError::NotAProject { .. })),
                "{text}"
            );
        }
    }

    #[test]
    fn opens_a_newer_format_read_only_when_its_minimum_reader_allows_it() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("future.scraft");
        let newer = FORMAT_VERSION + 1;
        let mut document = newer_document(newer, Some(MIN_READER_VERSION));
        document["snapshot"]["tables"][0]["comment"] = json!("a fact this version ignores");
        write_json(&path, &document);

        let opened = read_project(&path).unwrap();

        assert!(opened.is_read_only);
        assert_eq!(opened.project.format_version, newer);
        assert_eq!(opened.project.content, sample_project().content);
    }

    #[test]
    fn rejects_newer_formats_that_older_readers_must_not_open() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("future.scraft");
        let newer = FORMAT_VERSION + 1;

        for document in [
            newer_document(newer, None),
            newer_document(newer, Some(newer)),
            json!({ "formatVersion": newer }),
        ] {
            write_json(&path, &document);
            let Err(ProjectError::UnsupportedFormatVersion {
                found, supported, ..
            }) = read_project(&path)
            else {
                panic!("newer formats must be refused: {document}");
            };
            assert_eq!(found, newer);
            assert_eq!(supported, FORMAT_VERSION);
        }
    }

    #[test]
    fn a_newer_file_with_values_this_version_cannot_parse_is_refused_not_damaged() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("future.scraft");
        let mut document = newer_document(FORMAT_VERSION + 1, Some(MIN_READER_VERSION));
        document["snapshot"]["access"]["level"] = json!("restrictedByPolicy");
        write_json(&path, &document);

        assert!(matches!(
            read_project(&path),
            Err(ProjectError::UnsupportedFormatVersion { .. })
        ));
    }

    #[test]
    fn a_newer_compatible_file_opens_read_only() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("from-1.3.scraft");
        let mut document = newer_document(FORMAT_VERSION + 1, Some(MIN_READER_VERSION));
        document["snapshot"]["programmability"] =
            serde_json::to_value(sample_programmability()).unwrap();
        document["snapshot"]["programmability"]["synonyms"] = json!([{ "name": "dbo.Clients" }]);
        document["snapshot"]["programmability"]["capture"]["dependencies"] =
            json!({ "status": "read" });
        write_json(&path, &document);

        let opened = read_project(&path).unwrap();

        assert!(opened.is_read_only);
        assert_eq!(opened.project.format_version, FORMAT_VERSION + 1);
        let programmability = opened.project.content.snapshot.programmability.unwrap();
        assert_eq!(programmability.routines, sample_programmability().routines);
        assert!(programmability.unknown.contains_key("synonyms"));
    }

    #[test]
    fn upgrades_a_format_one_file_and_saves_it_as_the_current_format() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("legacy.scraft");
        fs::write(&path, FORMAT_1_PROJECT).unwrap();

        let opened = read_project(&path).unwrap();
        assert!(!opened.is_read_only);
        let snapshot = &opened.project.content.snapshot;
        assert_eq!(snapshot.access, None);
        let orders = &snapshot.tables[1];
        assert_eq!(
            orders.check_constraints[0].expression,
            Definition::NotRecorded
        );
        assert_eq!(
            orders.column("PlacedAt").unwrap().default_expression,
            Some(Definition::NotRecorded)
        );
        assert_eq!(
            snapshot.tables[0]
                .column("CreatedAt")
                .unwrap()
                .default_expression,
            Some(Definition::readable("(sysutcdatetime())"))
        );

        let resaved = Project::from_content(opened.project.content, "SchemaCraft 1.2.0");
        write_project(&path, &resaved).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("{\n  \"formatVersion\": 4,\n  \"minReaderVersion\": 4,"));
        let reopened = read_project(&path).unwrap();
        assert_eq!(reopened.project, resaved);
    }

    #[test]
    fn the_format_two_fixture_upgrades_and_keeps_every_fact() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("saved-by-1.1.scraft");
        fs::write(&path, FORMAT_2_PROJECT).unwrap();

        let opened = read_project(&path).unwrap();

        assert!(!opened.is_read_only);
        assert_eq!(opened.project.format_version, FORMAT_VERSION);
        assert_eq!(opened.project.saved_with, "SchemaCraft 1.1.0");
        let content = &opened.project.content;
        // The options 1.1 saved, and the code options it did not know, on as decided for 1.2.
        assert_eq!(content.inspection.schemas, ["dbo", "sales"]);
        assert!(content.inspection.include_views);
        assert!(content.inspection.include_programmability);
        assert!(content.inspection.include_module_definitions);

        let snapshot = &content.snapshot;
        let access = snapshot.access.as_ref().unwrap();
        assert_eq!(access.level, AccessLevel::Partial);
        assert_eq!(access.coverage.objects, Completeness::Partial);
        assert_eq!(access.coverage.definitions, Completeness::NotAvailable);
        assert_eq!(
            access
                .probe
                .as_ref()
                .expect("SQL Server probe")
                .database_user
                .as_deref(),
            Some("schemacraft_two_tables")
        );
        assert_eq!(access.counts.foreign_keys_to_invisible_tables, 2);
        assert_eq!(snapshot.tables.len(), 6);
        assert_eq!(snapshot.views.len(), 1);
        assert_eq!(snapshot.foreign_keys.len(), 6);
        assert_eq!(snapshot.carried_over.len(), 14);
        let order_lines = QualifiedName::new("sales", "OrderLines");
        assert!(snapshot.carried_over.iter().any(|carried| {
            carried.object == order_lines
                && carried.fact
                    == SnapshotFact::CheckConstraint {
                        name: "CK_OrderLines_Quantity".to_string(),
                    }
        }));
        let quantity = &snapshot.table(&order_lines).unwrap().check_constraints[0];
        assert_eq!(quantity.name, "CK_OrderLines_Quantity");
        assert_eq!(quantity.is_enabled, Some(false));
        assert_eq!(quantity.expression.text(), Some("([Quantity]>(0))"));
        assert_eq!(
            snapshot
                .foreign_keys_to_invisible_tables
                .iter()
                .map(|key| key.name.as_str())
                .collect::<Vec<_>>(),
            ["FK_Orders_Employees"]
        );
        // Nothing 1.1 could not hold is presented as captured: no code, no index or trust state.
        assert_eq!(snapshot.programmability, None);
        assert_eq!(access.coverage.programmability, None);
        assert_eq!(access.coverage.module_definitions, None);
        assert_eq!(
            access
                .probe
                .as_ref()
                .expect("SQL Server probe")
                .execute_denials,
            None
        );
        assert!(!access.scope.include_programmability);
        for table in &snapshot.tables {
            assert_eq!(
                table.primary_key.as_ref().and_then(|key| key.is_enabled),
                None
            );
            for index in &table.indexes {
                assert_eq!(
                    (&index.included_columns, index.is_filtered, index.is_enabled),
                    (&None, None, None),
                    "{}",
                    index.name
                );
            }
            for constraint in &table.check_constraints {
                assert_eq!(constraint.is_trusted, None, "{}", constraint.name);
            }
        }
        assert!(
            snapshot
                .foreign_keys
                .iter()
                .all(|key| key.is_trusted.is_none())
        );
        // The keys 1.1.0 kept at its four levels are kept too.
        assert!(content.unknown.contains_key("reviewNotes"));
        assert!(snapshot.unknown.contains_key("lineage"));
        assert!(content.canvas.unknown.contains_key("gridSize"));
        assert_eq!(content.canvas.nodes.len(), 7);
        assert!(
            content
                .canvas
                .nodes
                .iter()
                .any(|node| node.unknown.contains_key("colour"))
        );
    }

    #[test]
    fn the_format_two_fixture_saves_with_only_the_header_provider_and_options_new() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("saved-by-1.1.scraft");
        fs::write(&path, FORMAT_2_PROJECT).unwrap();

        let opened = read_project(&path).unwrap();
        let resaved = Project::from_content(opened.project.content, "SchemaCraft 1.2.0");
        write_project(&path, &resaved).unwrap();

        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("{\n  \"formatVersion\": 4,\n  \"minReaderVersion\": 4,"));
        let reopened = read_project(&path).unwrap();
        assert!(!reopened.is_read_only);
        assert_eq!(reopened.project, resaved);

        // Every fact of the 1.1 file is written back as it was. Only explicitly asserted
        // default inspection choices and the SQL Server provider are new, beside the header.
        let original: Value = serde_json::from_str(FORMAT_2_PROJECT).unwrap();
        let mut written: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(written["inspection"]["includeProgrammability"], true);
        assert_eq!(written["inspection"]["includeModuleDefinitions"], true);
        assert_eq!(written["inspection"]["includeDependencies"], true);
        assert_eq!(written["snapshot"]["provider"], "sqlServer");
        let inspection = written["inspection"].as_object_mut().unwrap();
        inspection.remove("includeProgrammability");
        inspection.remove("includeModuleDefinitions");
        inspection.remove("includeDependencies");
        written["snapshot"]
            .as_object_mut()
            .unwrap()
            .remove("provider");
        for header in ["formatVersion", "minReaderVersion", "savedAt", "savedWith"] {
            written[header] = original[header].clone();
        }
        assert_eq!(written, original);
    }

    #[test]
    fn keys_unknown_to_this_version_survive_a_save() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("shared.scraft");
        let mut document = serde_json::to_value(sample_project()).unwrap();
        let extras = [
            ("/reviewNotes", json!({ "by": "dba", "tags": ["audit", 2] })),
            (
                "/snapshot/lineage",
                json!([{ "step": "capture" }, 1.5, null]),
            ),
            ("/canvas/gridSize", json!(16)),
            ("/canvas/nodes/1/colour", json!("teal")),
            (
                "/snapshot/programmability/synonyms",
                json!([{ "name": { "schema": "dbo", "name": "Clients" } }]),
            ),
        ];
        document["reviewNotes"] = extras[0].1.clone();
        document["snapshot"]["lineage"] = extras[1].1.clone();
        document["canvas"]["gridSize"] = extras[2].1.clone();
        document["canvas"]["nodes"][1]["colour"] = extras[3].1.clone();
        // Programmability is the fifth level that keeps keys a newer version wrote.
        document["snapshot"]["programmability"] =
            serde_json::to_value(sample_programmability()).unwrap();
        document["snapshot"]["programmability"]["synonyms"] = extras[4].1.clone();
        write_json(&path, &document);

        let opened = read_project(&path).unwrap();
        let resaved = Project::from_content(opened.project.content, "SchemaCraft 1.1.0");
        write_project(&path, &resaved).unwrap();
        let written: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();

        for (pointer, value) in extras {
            assert_eq!(written.pointer(pointer), Some(&value), "{pointer}");
        }
    }

    #[test]
    fn the_format_one_fixture_keeps_the_keys_1_0_did_not_know() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("legacy.scraft");
        fs::write(&path, FORMAT_1_PROJECT).unwrap();

        let content = read_project(&path).unwrap().project.content;
        let written =
            serde_json::to_value(Project::from_content(content, "SchemaCraft 1.1.0")).unwrap();

        assert_eq!(
            written["reviewNotes"],
            json!("Checked with the DBA on 2026-10-14.")
        );
        assert_eq!(written["canvas"]["gridSize"], json!(16));
        assert_eq!(written["canvas"]["nodes"][1]["isCollapsed"], json!(true));
    }
}
