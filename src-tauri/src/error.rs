//! Error payload shared by every IPC command.

use schemacraft_core::credentials::{CredentialError, CredentialErrorKind};
use schemacraft_core::diagnostics::{self, ClosedKind, ErrorSummary};
use schemacraft_core::export::{ExportError, ExportErrorKind};
use schemacraft_core::inspectors::{InspectorError, InspectorErrorKind};
use schemacraft_core::preferences::{PreferencesError, PreferencesErrorKind};
use schemacraft_core::project::{ProjectError, ProjectErrorKind};
use serde::Serialize;
use ts_rs::TS;

use crate::support::{SupportError, SupportErrorKind};

/// Why a command failed, in a shape the frontend turns into user guidance.
///
/// The message names servers, logins, databases and files, so the diagnostic log records only
/// the kind, the SQL Server error number and the catalog query, which never cross the IPC.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ipc/")]
pub struct CommandError {
    /// Classification the UI maps to a title and a suggested fix.
    pub kind: CommandErrorKind,
    /// Developer-oriented description, shown as secondary detail.
    pub message: String,
    /// SQL Server error number behind the failure, for the diagnostic log.
    #[serde(skip)]
    error_number: Option<u32>,
    /// Fixed name of the catalog query that failed, for the diagnostic log.
    #[serde(skip)]
    query: Option<&'static str>,
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
    /// A local diagnostic report could not be read or saved.
    Support(SupportErrorKind),
    /// The job id does not belong to a running operation.
    UnknownJob,
    /// A command was called with an argument it cannot act on.
    InvalidArgument,
    /// A failure no other kind describes, such as a blocking task that could not be joined.
    Unexpected,
}

impl ClosedKind for CommandErrorKind {}

impl CommandError {
    /// Error for a job id the application does not know.
    pub fn unknown_job(job_id: &str) -> Self {
        Self::with_message(
            CommandErrorKind::UnknownJob,
            format!("no running operation has the id {job_id:?}"),
        )
    }

    /// Error for an argument a command cannot act on.
    pub fn invalid_argument(message: &str) -> Self {
        Self::with_message(CommandErrorKind::InvalidArgument, message.to_string())
    }

    /// Error for a failure no other kind describes.
    pub fn unexpected(message: &str) -> Self {
        Self::with_message(CommandErrorKind::Unexpected, message.to_string())
    }

    /// Records the failure of `command` in the diagnostic log: the command's fixed name, the
    /// kind, and the SQL Server error number and catalog query when there are ones (ADR-041).
    pub fn log(&self, command: &'static str) {
        diagnostics::command_failed(
            command,
            &ErrorSummary {
                kind: self.kind,
                error_number: self.error_number,
                query: self.query,
            },
        );
    }

    fn with_message(kind: CommandErrorKind, message: String) -> Self {
        Self {
            kind,
            message,
            error_number: None,
            query: None,
        }
    }

    /// The error of a core failure: its summary for the log, its message for the UI.
    fn summarised<K>(
        summary: ErrorSummary<K>,
        to_kind: fn(K) -> CommandErrorKind,
        message: String,
    ) -> Self {
        Self {
            kind: to_kind(summary.kind),
            message,
            error_number: summary.error_number,
            query: summary.query,
        }
    }
}

impl From<ExportError> for CommandError {
    fn from(error: ExportError) -> Self {
        Self::summarised(
            error.log_summary(),
            CommandErrorKind::Export,
            error.to_string(),
        )
    }
}

impl From<SupportError> for CommandError {
    fn from(error: SupportError) -> Self {
        Self::with_message(
            CommandErrorKind::Support(error.kind),
            "the local diagnostic report could not be prepared or saved".to_owned(),
        )
    }
}

impl From<CredentialError> for CommandError {
    fn from(error: CredentialError) -> Self {
        Self::summarised(
            error.log_summary(),
            CommandErrorKind::Credential,
            error.to_string(),
        )
    }
}

impl From<InspectorError> for CommandError {
    fn from(error: InspectorError) -> Self {
        Self::summarised(
            error.log_summary(),
            CommandErrorKind::Inspector,
            error.to_string(),
        )
    }
}

impl From<ProjectError> for CommandError {
    fn from(error: ProjectError) -> Self {
        Self::summarised(
            error.log_summary(),
            CommandErrorKind::Project,
            error.to_string(),
        )
    }
}

impl From<PreferencesError> for CommandError {
    fn from(error: PreferencesError) -> Self {
        Self::summarised(
            error.log_summary(),
            CommandErrorKind::Preferences,
            error.to_string(),
        )
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
            error_number: Some(18456),
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

    #[test]
    fn the_log_summary_stays_out_of_the_payload() {
        let error = CommandError::from(InspectorError::QueryFailed {
            query: "check constraints",
            details: "The SELECT permission was denied".to_string(),
            error_number: Some(229),
        });
        assert_eq!(error.error_number, Some(229));
        assert_eq!(error.query, Some("check constraints"));
        let json = serde_json::to_value(&error).unwrap_or_default();
        let keys: Vec<&String> = json
            .as_object()
            .map(|object| object.keys().collect())
            .unwrap_or_default();
        assert_eq!(keys, ["kind", "message"]);
    }

    #[test]
    fn a_logged_failure_carries_the_command_kind_and_number_but_not_the_message() {
        let error = CommandError::from(InspectorError::AuthenticationFailed {
            details: "Login failed for user 'sentinel_login'.".to_string(),
            error_number: Some(18456),
        });
        let logged = logged_text(|| error.log("test_connection"));
        assert!(logged.contains("command failed"), "{logged}");
        assert!(logged.contains(r#"command="test_connection""#), "{logged}");
        assert!(
            logged.contains("kind=Inspector(AuthenticationFailed)"),
            "{logged}"
        );
        assert!(logged.contains("sql_error=18456"), "{logged}");
        assert!(
            !logged.contains("sentinel") && !logged.contains("Login failed"),
            "{logged}"
        );

        let path = CommandError::from(ProjectError::NotFound {
            path: r"C:\Users\sentinel\shop.scraft".to_string(),
        });
        let logged = logged_text(|| path.log("read_project"));
        assert!(logged.contains("kind=Project(NotFound)"), "{logged}");
        assert!(
            !logged.contains("sentinel") && !logged.contains("scraft"),
            "{logged}"
        );
    }

    /// The events `work` emits, as `name=value` text.
    fn logged_text(work: impl FnOnce()) -> String {
        use std::sync::{Arc, Mutex, PoisonError};
        use tracing_subscriber::layer::SubscriberExt;

        let buffer = Arc::new(Mutex::new(Vec::<u8>::new()));
        let sink = Arc::clone(&buffer);
        let layer = tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .with_writer(move || Sink(Arc::clone(&sink)));
        tracing::subscriber::with_default(tracing_subscriber::registry().with(layer), work);
        let bytes = buffer
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        String::from_utf8(bytes).unwrap_or_default()
    }

    struct Sink(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

    impl std::io::Write for Sink {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
}
