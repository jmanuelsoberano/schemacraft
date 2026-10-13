//! Error payload shared by every IPC command.

use schemacraft_core::inspectors::{InspectorError, InspectorErrorKind};
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
    /// The job id does not belong to a running operation.
    UnknownJob,
}

impl CommandError {
    /// Error for a job id the application does not know.
    pub fn unknown_job(job_id: &str) -> Self {
        Self {
            kind: CommandErrorKind::UnknownJob,
            message: format!("no running operation has the id {job_id:?}"),
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

#[cfg(test)]
mod tests {
    #![allow(clippy::indexing_slicing)]

    use schemacraft_core::inspectors::{InspectorError, InspectorErrorKind};

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
    fn serialises_as_tagged_kind() {
        let error = CommandError::from(InspectorError::Cancelled);
        let json = serde_json::to_value(&error).unwrap_or_default();
        assert_eq!(json["kind"]["type"], "inspector");
        assert_eq!(json["kind"]["value"], "cancelled");
    }
}
