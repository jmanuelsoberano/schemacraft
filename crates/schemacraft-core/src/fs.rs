//! File helpers shared by projects, preferences and exports: whole-file reads that tell a
//! missing file apart, and atomic writes that never leave a truncated file behind.

use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Low-level failure of the file helpers. Callers wrap it in their own error with the path.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub(crate) enum FileError {
    /// No file at the path.
    #[error("the file does not exist")]
    NotFound,
    /// The file could not be read.
    #[error("{0}")]
    Read(String),
    /// The document could not be serialised or written.
    #[error("{0}")]
    Write(String),
}

/// Reads a whole file, telling a missing file apart from other failures.
pub(crate) fn read_bytes(path: &Path) -> Result<Vec<u8>, FileError> {
    fs::read(path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            FileError::NotFound
        } else {
            FileError::Read(error.to_string())
        }
    })
}

/// The field every versioned JSON document starts with, read before the rest so a file written
/// by a newer version is refused instead of misread.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FormatHeader {
    format_version: Option<u32>,
}

/// The `formatVersion` of a JSON document; `None` when the field is absent.
pub(crate) fn format_version(bytes: &[u8]) -> Result<Option<u32>, serde_json::Error> {
    serde_json::from_slice::<FormatHeader>(bytes).map(|header| header.format_version)
}

/// Serialises `value` as pretty JSON and writes it with [`write_bytes_atomically`].
pub(crate) fn write_json_atomically<T: Serialize>(path: &Path, value: &T) -> Result<(), FileError> {
    let mut bytes =
        serde_json::to_vec_pretty(value).map_err(|error| FileError::Write(error.to_string()))?;
    bytes.push(b'\n');
    write_bytes_atomically(path, &bytes)
}

/// Replaces `path` with `bytes` in one step: the content goes to a sibling temporary file, is
/// flushed to the disk and only then renamed over the destination, so a crash, a power cut or a
/// full disk never leaves a truncated file behind. Missing parent directories are created.
pub(crate) fn write_bytes_atomically(path: &Path, bytes: &[u8]) -> Result<(), FileError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| FileError::Write(error.to_string()))?;
    }

    let temporary = temporary_path(path);
    let written = write_and_flush(&temporary, bytes).and_then(|()| fs::rename(&temporary, path));
    if let Err(error) = written {
        // The temporary file is useless once a step failed; removing it is best effort.
        let _ = fs::remove_file(&temporary);
        return Err(FileError::Write(error.to_string()));
    }
    Ok(())
}

fn write_and_flush(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map_or_else(|| OsString::from("document"), OsString::from);
    name.push(".tmp");
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use std::fs;

    use super::{FileError, read_bytes, write_bytes_atomically, write_json_atomically};

    #[test]
    fn writes_replace_the_file_and_leave_no_temporary_behind() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("nested").join("out.svg");

        write_bytes_atomically(&path, b"first").unwrap();
        write_bytes_atomically(&path, b"second").unwrap();

        assert_eq!(read_bytes(&path).unwrap(), b"second");
        assert!(!directory.path().join("nested").join("out.svg.tmp").exists());
    }

    #[test]
    fn json_is_pretty_printed_with_a_final_newline() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("value.json");

        write_json_atomically(&path, &serde_json::json!({ "a": 1 })).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "{\n  \"a\": 1\n}\n");
    }

    #[test]
    fn a_missing_file_is_told_apart() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            read_bytes(&directory.path().join("gone.json")),
            Err(FileError::NotFound)
        );
    }
}
