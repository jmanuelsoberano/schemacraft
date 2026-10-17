use std::path::Path;

use serde::Deserialize;
use serde_json::Value;

use super::document::{FORMAT_VERSION, OpenedProject, Project};
use super::error::ProjectError;
use super::migrations;
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
pub fn read_project(path: &Path) -> Result<OpenedProject, ProjectError> {
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
    Ok(OpenedProject {
        project,
        is_read_only,
    })
}

/// Writes a project file atomically: the previous file survives any failure.
pub fn write_project(path: &Path, project: &Project) -> Result<(), ProjectError> {
    write_json_atomically(path, project).map_err(|error| ProjectError::Write {
        path: display(path),
        details: error.to_string(),
    })
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
    use crate::model::Definition;
    use crate::project::document::{FORMAT_VERSION, MIN_READER_VERSION, Project};
    use crate::project::error::ProjectError;
    use crate::project::test_fixtures::{FORMAT_1_PROJECT, sample_project_content};

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
        assert!(text.starts_with("{\n  \"formatVersion\": 2,\n  \"minReaderVersion\": 2,"));
        assert!(text.ends_with("}\n"));
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
    fn upgrades_a_format_one_file_and_saves_it_as_format_two() {
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

        let resaved = Project::from_content(opened.project.content, "SchemaCraft 1.1.0");
        write_project(&path, &resaved).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("{\n  \"formatVersion\": 2,\n  \"minReaderVersion\": 2,"));
        let reopened = read_project(&path).unwrap();
        assert_eq!(reopened.project, resaved);
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
        ];
        document["reviewNotes"] = extras[0].1.clone();
        document["snapshot"]["lineage"] = extras[1].1.clone();
        document["canvas"]["gridSize"] = extras[2].1.clone();
        document["canvas"]["nodes"][1]["colour"] = extras[3].1.clone();
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
