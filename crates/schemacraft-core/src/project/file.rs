use std::ffi::OsString;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::document::{FORMAT_VERSION, Project};
use super::error::ProjectError;

/// Reads a project file, checking the format version before parsing the whole document.
pub fn read_project(path: &Path) -> Result<Project, ProjectError> {
    let bytes = read_json_bytes(path).map_err(|error| match error {
        FileError::NotFound => ProjectError::NotFound {
            path: display(path),
        },
        FileError::Read(details) | FileError::Write(details) => ProjectError::Read {
            path: display(path),
            details,
        },
    })?;

    let header: ProjectHeader =
        serde_json::from_slice(&bytes).map_err(|error| ProjectError::NotAProject {
            path: display(path),
            details: error.to_string(),
        })?;
    if header.format_version > FORMAT_VERSION {
        return Err(ProjectError::UnsupportedFormatVersion {
            path: display(path),
            found: header.format_version,
            supported: FORMAT_VERSION,
        });
    }

    serde_json::from_slice(&bytes).map_err(|error| ProjectError::NotAProject {
        path: display(path),
        details: error.to_string(),
    })
}

/// Writes a project file atomically: the previous file survives any failure.
pub fn write_project(path: &Path, project: &Project) -> Result<(), ProjectError> {
    write_json_atomically(path, project).map_err(|error| ProjectError::Write {
        path: display(path),
        details: error.to_string(),
    })
}

/// The part of a project file every format version shares.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectHeader {
    format_version: u32,
}

/// Low-level failure of the file helpers shared by projects, preferences and exports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FileError {
    /// No file at the path.
    NotFound,
    /// The file could not be read.
    Read(String),
    /// The document could not be serialised or written.
    Write(String),
}

impl fmt::Display for FileError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("the file does not exist"),
            Self::Read(details) | Self::Write(details) => formatter.write_str(details),
        }
    }
}

/// Reads a whole file, telling a missing file apart from other failures.
pub(crate) fn read_json_bytes(path: &Path) -> Result<Vec<u8>, FileError> {
    fs::read(path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            FileError::NotFound
        } else {
            FileError::Read(error.to_string())
        }
    })
}

/// Serialises `value` as pretty JSON and writes it with [`write_bytes_atomically`].
pub(crate) fn write_json_atomically<T: Serialize>(path: &Path, value: &T) -> Result<(), FileError> {
    let mut bytes =
        serde_json::to_vec_pretty(value).map_err(|error| FileError::Write(error.to_string()))?;
    bytes.push(b'\n');
    write_bytes_atomically(path, &bytes)
}

/// Replaces `path` with `bytes` in one step: the content goes to a sibling temporary file first
/// and is renamed over the destination, so a crash or a full disk never leaves a truncated file
/// behind. Missing parent directories are created.
pub(crate) fn write_bytes_atomically(path: &Path, bytes: &[u8]) -> Result<(), FileError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| FileError::Write(error.to_string()))?;
    }

    let temporary = temporary_path(path);
    fs::write(&temporary, bytes).map_err(|error| FileError::Write(error.to_string()))?;
    if let Err(error) = fs::rename(&temporary, path) {
        // The temporary file is useless once the rename failed; removing it is best effort.
        let _ = fs::remove_file(&temporary);
        return Err(FileError::Write(error.to_string()));
    }
    Ok(())
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map_or_else(|| OsString::from("document"), OsString::from);
    name.push(".tmp");
    path.with_file_name(name)
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
