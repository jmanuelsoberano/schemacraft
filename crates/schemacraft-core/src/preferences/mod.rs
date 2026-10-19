//! User preferences that survive restarts: the connection history and the recent projects.
//!
//! Everything lives in one JSON file in the per-user configuration directory, written
//! atomically like project files. Passwords are never part of it. A file written by a newer
//! version is refused, so an older build never overwrites what it cannot read.

use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::diagnostics::{ClosedKind, ErrorSummary};
use crate::fs::{FileError, format_version, read_bytes, write_json_atomically};
use crate::project::SavedConnection;

/// Newest preferences format this build writes and reads.
pub const PREFERENCES_FORMAT_VERSION: u32 = 1;
/// How many connections the history keeps.
pub const RECENT_CONNECTIONS_LIMIT: usize = 10;
/// How many projects the recent list keeps.
pub const RECENT_PROJECTS_LIMIT: usize = 10;

/// Preferences as stored on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "preferences/")]
pub struct Preferences {
    /// Format the file follows.
    #[serde(default = "current_format_version")]
    pub format_version: u32,
    /// Connections used recently, most recent first, without passwords.
    #[serde(default)]
    pub recent_connections: Vec<RecentConnection>,
    /// Projects opened recently, most recent first.
    #[serde(default)]
    pub recent_projects: Vec<RecentProject>,
}

fn current_format_version() -> u32 {
    PREFERENCES_FORMAT_VERSION
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            format_version: PREFERENCES_FORMAT_VERSION,
            recent_connections: Vec::new(),
            recent_projects: Vec::new(),
        }
    }
}

/// An entry of the connection history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "preferences/")]
pub struct RecentConnection {
    /// The connection, without its password.
    pub connection: SavedConnection,
    /// When a schema was last read through it.
    pub last_used_at: DateTime<Utc>,
}

/// An entry of the recent projects list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "preferences/")]
pub struct RecentProject {
    /// Absolute path of the `.scraft` file.
    pub path: String,
    /// When it was last opened or saved.
    pub last_opened_at: DateTime<Utc>,
}

impl Preferences {
    /// Reads the preferences file; a missing file means defaults. A file in a newer format
    /// fails with [`PreferencesError::UnsupportedFormatVersion`].
    pub fn load(path: &Path) -> Result<Self, PreferencesError> {
        let bytes = match read_bytes(path) {
            Ok(bytes) => bytes,
            Err(FileError::NotFound) => return Ok(Self::default()),
            Err(error) => {
                return Err(PreferencesError::Read {
                    path: path.display().to_string(),
                    details: error.to_string(),
                });
            }
        };
        let corrupt = |error: serde_json::Error| PreferencesError::Corrupt {
            path: path.display().to_string(),
            details: error.to_string(),
        };
        let found = format_version(&bytes)
            .map_err(corrupt)?
            .unwrap_or(PREFERENCES_FORMAT_VERSION);
        if found > PREFERENCES_FORMAT_VERSION {
            return Err(PreferencesError::UnsupportedFormatVersion {
                path: path.display().to_string(),
                found,
                supported: PREFERENCES_FORMAT_VERSION,
            });
        }
        serde_json::from_slice(&bytes).map_err(corrupt)
    }

    /// Writes the preferences file atomically.
    pub fn save(&self, path: &Path) -> Result<(), PreferencesError> {
        write_json_atomically(path, self)
            .map(|_bytes| ())
            .map_err(|error| PreferencesError::Write {
                path: path.display().to_string(),
                details: error.to_string(),
            })
    }

    /// Moves `connection` to the front of the history, replacing an entry for the same
    /// endpoint, and drops the oldest entries beyond the limit.
    pub fn remember_connection(&mut self, connection: SavedConnection, used_at: DateTime<Utc>) {
        self.recent_connections
            .retain(|entry| !entry.connection.same_endpoint_as(&connection));
        self.recent_connections.insert(
            0,
            RecentConnection {
                connection,
                last_used_at: used_at,
            },
        );
        self.recent_connections.truncate(RECENT_CONNECTIONS_LIMIT);
    }

    /// Removes the history entry for the endpoint of `connection`; `false` when there was none.
    pub fn forget_connection(&mut self, connection: &SavedConnection) -> bool {
        let before = self.recent_connections.len();
        self.recent_connections
            .retain(|entry| !entry.connection.same_endpoint_as(connection));
        self.recent_connections.len() != before
    }

    /// Moves `path` to the front of the recent projects, dropping the oldest beyond the limit.
    pub fn remember_project(&mut self, path: &str, opened_at: DateTime<Utc>) {
        self.recent_projects
            .retain(|entry| !same_path(&entry.path, path));
        self.recent_projects.insert(
            0,
            RecentProject {
                path: path.to_string(),
                last_opened_at: opened_at,
            },
        );
        self.recent_projects.truncate(RECENT_PROJECTS_LIMIT);
    }

    /// Removes `path` from the recent projects; `false` when it was not listed.
    pub fn forget_project(&mut self, path: &str) -> bool {
        let before = self.recent_projects.len();
        self.recent_projects
            .retain(|entry| !same_path(&entry.path, path));
        self.recent_projects.len() != before
    }
}

/// Path equality as the platform sees it: Windows file systems ignore case.
fn same_path(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

/// Failure to read or write the preferences file.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PreferencesError {
    /// The file exists but could not be read.
    #[error("could not read preferences from {path}: {details}")]
    Read {
        /// Path of the file.
        path: String,
        /// Operating system message.
        details: String,
    },
    /// The file could not be written.
    #[error("could not write preferences to {path}: {details}")]
    Write {
        /// Path of the file.
        path: String,
        /// Operating system or serialisation message.
        details: String,
    },
    /// The file is not valid preferences JSON.
    #[error("preferences in {path} are damaged: {details}")]
    Corrupt {
        /// Path of the file.
        path: String,
        /// Parser message.
        details: String,
    },
    /// The file was written by a newer SchemaCraft; it is left untouched.
    #[error(
        "preferences in {path} use format {found}; this version reads up to format {supported}"
    )]
    UnsupportedFormatVersion {
        /// Path of the file.
        path: String,
        /// Version declared by the file.
        found: u32,
        /// Newest version this build understands.
        supported: u32,
    },
}

impl PreferencesError {
    /// Classification for the UI.
    pub fn kind(&self) -> PreferencesErrorKind {
        match self {
            Self::Read { .. } => PreferencesErrorKind::Read,
            Self::Write { .. } => PreferencesErrorKind::Write,
            Self::Corrupt { .. } => PreferencesErrorKind::Corrupt,
            Self::UnsupportedFormatVersion { .. } => PreferencesErrorKind::UnsupportedFormatVersion,
        }
    }

    /// What the diagnostic log may record of this error: its kind, never the path or the
    /// parser message, which can quote a server or a login from the file.
    pub fn log_summary(&self) -> ErrorSummary<PreferencesErrorKind> {
        ErrorSummary::of(self.kind())
    }
}

impl ClosedKind for PreferencesErrorKind {}

/// Serialisable classification of a [`PreferencesError`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "preferences/")]
pub enum PreferencesErrorKind {
    /// See [`PreferencesError::Read`].
    Read,
    /// See [`PreferencesError::Write`].
    Write,
    /// See [`PreferencesError::Corrupt`].
    Corrupt,
    /// See [`PreferencesError::UnsupportedFormatVersion`].
    UnsupportedFormatVersion,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

    use std::fs;

    use chrono::{TimeZone, Utc};

    use super::{
        PREFERENCES_FORMAT_VERSION, Preferences, PreferencesError, RECENT_CONNECTIONS_LIMIT,
    };
    use crate::inspectors::sqlserver::EncryptionMode;
    use crate::project::{SavedConnection, SavedSqlServerAuthentication, SavedSqlServerConnection};

    fn connection(host: &str, database: &str) -> SavedConnection {
        SavedConnection::SqlServer(SavedSqlServerConnection {
            host: host.to_string(),
            instance: None,
            port: None,
            database: Some(database.to_string()),
            authentication: SavedSqlServerAuthentication::Integrated,
            encryption: EncryptionMode::Mandatory,
            trust_server_certificate: false,
        })
    }

    fn at(minute: u32) -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 13, 18, minute, 0).unwrap()
    }

    #[test]
    fn remembering_a_connection_moves_it_to_the_front_without_duplicates() {
        let mut preferences = Preferences::default();
        preferences.remember_connection(connection("alpha", "Shop"), at(1));
        preferences.remember_connection(connection("beta", "Shop"), at(2));
        preferences.remember_connection(connection("ALPHA", "shop"), at(3));

        let hosts: Vec<String> = preferences
            .recent_connections
            .iter()
            .map(|entry| entry.connection.display_target())
            .collect();
        assert_eq!(hosts, ["ALPHA,1433", "beta,1433"]);
        assert_eq!(preferences.recent_connections[0].last_used_at, at(3));
    }

    #[test]
    fn history_is_capped_at_the_limit() {
        let mut preferences = Preferences::default();
        for index in 0..=RECENT_CONNECTIONS_LIMIT {
            let minute = u32::try_from(index).unwrap_or(0);
            preferences.remember_connection(connection(&format!("host{index}"), "db"), at(minute));
        }
        assert_eq!(
            preferences.recent_connections.len(),
            RECENT_CONNECTIONS_LIMIT
        );
        assert_eq!(
            preferences.recent_connections[0]
                .connection
                .display_target(),
            format!("host{RECENT_CONNECTIONS_LIMIT},1433")
        );
        assert!(
            preferences
                .recent_connections
                .iter()
                .all(|entry| entry.connection.display_target() != "host0,1433")
        );
    }

    #[test]
    fn forgetting_removes_the_matching_endpoint() {
        let mut preferences = Preferences::default();
        preferences.remember_connection(connection("alpha", "Shop"), at(1));
        preferences.remember_connection(connection("beta", "Shop"), at(2));

        assert!(preferences.forget_connection(&connection("alpha", "SHOP")));
        assert!(!preferences.forget_connection(&connection("alpha", "SHOP")));
        assert_eq!(preferences.recent_connections.len(), 1);
    }

    #[test]
    fn recent_projects_dedupe_by_path_and_keep_the_newest_first() {
        let mut preferences = Preferences::default();
        preferences.remember_project("C:\\work\\shop.scraft", at(1));
        preferences.remember_project("C:\\work\\crm.scraft", at(2));
        preferences.remember_project("C:\\WORK\\shop.scraft", at(3));

        let paths: Vec<&str> = preferences
            .recent_projects
            .iter()
            .map(|entry| entry.path.as_str())
            .collect();
        if cfg!(windows) {
            assert_eq!(paths, ["C:\\WORK\\shop.scraft", "C:\\work\\crm.scraft"]);
        } else {
            assert_eq!(paths.len(), 3);
        }
        assert!(preferences.forget_project("C:\\work\\crm.scraft"));
        assert!(!preferences.forget_project("C:\\work\\crm.scraft"));
    }

    #[test]
    fn round_trips_through_disk_and_defaults_when_missing() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings").join("preferences.json");
        assert_eq!(Preferences::load(&path).unwrap(), Preferences::default());

        let mut preferences = Preferences::default();
        preferences.remember_connection(connection("alpha", "Shop"), at(1));
        preferences.remember_project("C:\\work\\shop.scraft", at(2));
        preferences.save(&path).unwrap();

        let restored = Preferences::load(&path).unwrap();
        assert_eq!(restored, preferences);
        assert_eq!(restored.format_version, PREFERENCES_FORMAT_VERSION);
    }

    #[test]
    fn damaged_files_are_reported() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("preferences.json");
        fs::write(&path, "{ not json").unwrap();

        assert!(matches!(
            Preferences::load(&path),
            Err(PreferencesError::Corrupt { .. })
        ));
    }

    #[test]
    fn newer_formats_are_refused() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("preferences.json");
        let newer = PREFERENCES_FORMAT_VERSION + 1;
        fs::write(&path, format!(r#"{{ "formatVersion": {newer} }}"#)).unwrap();

        assert_eq!(
            Preferences::load(&path),
            Err(PreferencesError::UnsupportedFormatVersion {
                path: path.display().to_string(),
                found: newer,
                supported: PREFERENCES_FORMAT_VERSION,
            })
        );
    }

    #[test]
    fn missing_fields_take_defaults_when_deserialising() {
        let preferences: Preferences = serde_json::from_str("{}").unwrap();
        assert_eq!(preferences, Preferences::default());
    }
}
