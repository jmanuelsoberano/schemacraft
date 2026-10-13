//! Error payload shared by every IPC command.

use schemacraft_core::credentials::{CredentialError, CredentialErrorKind};
use schemacraft_core::export::{ExportError, ExportErrorKind};
use schemacraft_core::inspectors::{InspectorError, InspectorErrorKind};
use schemacraft_core::preferences::{PreferencesError, PreferencesErrorKind};
use schemacraft_core::project::{ProjectError, ProjectErrorKind};
use serde::Serialize;
use ts_rs::TS;

/// Why a command failed, in a shape the frontend turns into user guidance.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ipc/")]
pub struct CommandError {
    /// Classification the UI maps to a title and a suggested fix.
    pub kind: CommandErrorKind,
    /// Developer-oriented description, shown as secondary detail.
    pub message: String,
}

/// Classification of a command failure.
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
#[ts(export, export_to = "ipc/")]
pub enum CommandErrorKind {
    /// A database inspector failed; the value says how.
    Inspector(InspectorErrorKind),
    /// A project file could not be read or written; the value says why.
    Project(ProjectErrorKind),
    /// The preferences file could not be read or written; the value says why.
    Preferences(PreferencesErrorKind),
    /// The credential store failed; the value says why.
    Credential(CredentialErrorKind),
    /// An export could not be produced; the value says why.
    Export(ExportErrorKind),
    /// The job id does not belong to a running operation.
    UnknownJob,
    /// A command was called with an argument it cannot act on.
    InvalidArgument,
}

impl CommandError {
    /// Error for a job id the application does not know.
    pub fn unknown_job(job_id: &str) -> Self {
        Self {
            kind: CommandErrorKind::UnknownJob,
            message: format!("no running operation has the id {job_id:?}"),
        }
    }

    /// Error for an argument a command cannot act on.
    pub fn invalid_argument(message: &str) -> Self {
        Self {
            kind: CommandErrorKind::InvalidArgument,
            message: message.to_string(),
        }
    }
}

impl From<ExportError> for CommandError {
    fn from(error: ExportError) -> Self {
        Self {
            kind: CommandErrorKind::Export(error.kind()),
            message: error.to_string(),
        }
    }
}

impl From<CredentialError> for CommandError {
    fn from(error: CredentialError) -> Self {
        Self {
            kind: CommandErrorKind::Credential(error.kind()),
            message: error.to_string(),
        }
    }
}

impl From<InspectorError> for CommandError {
    fn from(error: InspectorError) -> Self {
        Self {
            kind: CommandErrorKind::Inspector(error.kind()),
            message: error.to_string(),
        }
    }
}

impl From<ProjectError> for CommandError {
    fn from(error: ProjectError) -> Self {
        Self {
            kind: CommandErrorKind::Project(error.kind()),
            message: error.to_string(),
        }
    }
}

impl From<PreferencesError> for CommandError {
    fn from(error: PreferencesError) -> Self {
        Self {
            kind: CommandErrorKind::Preferences(error.kind()),
            message: error.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::indexing_slicing)]

    use schemacraft_core::inspectors::{InspectorError, InspectorErrorKind};
    use schemacraft_core::project::{ProjectError, ProjectErrorKind};

    use super::{CommandError, CommandErrorKind};

    #[test]
    fn inspector_errors_keep_their_kind_and_message() {
        let error = CommandError::from(InspectorError::AuthenticationFailed {
            details: "Login failed for user 'app'.".to_string(),
        });
        assert!(matches!(
            error.kind,
            CommandErrorKind::Inspector(InspectorErrorKind::AuthenticationFailed)
        ));
        assert!(error.message.contains("Login failed"));
    }

    #[test]
    fn project_errors_keep_their_kind_and_path() {
        let error = CommandError::from(ProjectError::NotFound {
            path: "C:\\work\\shop.scraft".to_string(),
        });
        assert!(matches!(
            error.kind,
            CommandErrorKind::Project(ProjectErrorKind::NotFound)
        ));
        assert!(error.message.contains("shop.scraft"));
    }

    #[test]
    fn serialises_as_tagged_kind() {
        let error = CommandError::from(InspectorError::Cancelled);
        let json = serde_json::to_value(&error).unwrap_or_default();
        assert_eq!(json["kind"]["type"], "inspector");
        assert_eq!(json["kind"]["value"], "cancelled");

        let error = CommandError::from(ProjectError::NotAProject {
            path: "x".to_string(),
            details: "expected value".to_string(),
        });
        let json = serde_json::to_value(&error).unwrap_or_default();
        assert_eq!(json["kind"]["type"], "project");
        assert_eq!(json["kind"]["value"], "notAProject");
    }
}
