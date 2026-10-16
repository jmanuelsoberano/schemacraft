use std::path::Path;

use super::document::{FORMAT_VERSION, Project};
use super::error::ProjectError;
use crate::fs::{FileError, format_version, read_bytes, write_json_atomically};

/// Reads a project file, checking the format version before parsing the whole document.
pub fn read_project(path: &Path) -> Result<Project, ProjectError> {
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
    let found = format_version(&bytes)
        .map_err(|error| not_a_project(error.to_string()))?
        .ok_or_else(|| not_a_project("the formatVersion field is missing".to_string()))?;
    if found > FORMAT_VERSION {
        return Err(ProjectError::UnsupportedFormatVersion {
            path: display(path),
            found,
            supported: FORMAT_VERSION,
        });
    }

    serde_json::from_slice(&bytes).map_err(|error| not_a_project(error.to_string()))
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
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use std::fs;

    use super::{read_project, write_project};
    use crate::project::document::{FORMAT_VERSION, Project};
    use crate::project::error::ProjectError;
    use crate::project::test_fixtures::sample_project_content;

    fn sample_project() -> Project {
        Project::from_content(sample_project_content(), "SchemaCraft 0.1.0")
    }

    #[test]
    fn round_trips_through_disk() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("northwind.scraft");
        let project = sample_project();

        write_project(&path, &project).unwrap();
        let restored = read_project(&path).unwrap();

        assert_eq!(restored, project);
        assert!(!directory.path().join("northwind.scraft.tmp").exists());
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("{\n  \"formatVersion\": 1,"));
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

        assert_eq!(read_project(&path).unwrap().saved_with, "SchemaCraft 0.2.0");
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

        fs::write(&path, "just some text").unwrap();
        assert!(matches!(
            read_project(&path),
            Err(ProjectError::NotAProject { .. })
        ));

        fs::write(&path, r#"{ "formatVersion": 1, "snapshot": "nope" }"#).unwrap();
        assert!(matches!(
            read_project(&path),
            Err(ProjectError::NotAProject { .. })
        ));
    }

    #[test]
    fn rejects_newer_format_versions() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("future.scraft");
        let newer = FORMAT_VERSION + 1;
        fs::write(&path, format!(r#"{{ "formatVersion": {newer} }}"#)).unwrap();

        let Err(ProjectError::UnsupportedFormatVersion {
            found, supported, ..
        }) = read_project(&path)
        else {
            panic!("newer formats must be refused");
        };
        assert_eq!(found, newer);
        assert_eq!(supported, FORMAT_VERSION);
    }
}
