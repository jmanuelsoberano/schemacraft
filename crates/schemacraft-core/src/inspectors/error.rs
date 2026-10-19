use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

use crate::diagnostics::{ClosedKind, ErrorSummary};

/// Failure of a connection or inspection, structured so the UI can propose a remedy.
///
/// Messages are written for developers; the frontend translates the [`kind`] into user-facing
/// guidance and shows `details` as secondary information. Messages name servers, logins,
/// databases and objects, so the diagnostic log records the [`log_summary`] instead.
///
/// [`kind`]: InspectorError::kind
/// [`log_summary`]: InspectorError::log_summary
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum InspectorError {
    /// The settings cannot produce a connection attempt, e.g. an empty host.
    #[error("invalid connection settings: {reason}")]
    InvalidSettings {
        /// What is wrong with the settings.
        reason: String,
    },
    /// No TCP connection could be established.
    #[error("could not reach {target}: {details}")]
    Unreachable {
        /// Server as the user typed it, e.g. `localhost\SQLEXPRESS`.
        target: String,
        /// Driver or operating system message.
        details: String,
    },
    /// Connecting or logging in exceeded the configured time.
    #[error("connecting to {target} took longer than {seconds} seconds")]
    Timeout {
        /// Server as the user typed it.
        target: String,
        /// Time allowed.
        seconds: u64,
    },
    /// The server rejected the credentials or the login.
    #[error("the server rejected the login: {details}")]
    AuthenticationFailed {
        /// Server message, e.g. `Login failed for user 'app'.`
        details: String,
        /// SQL Server error number, e.g. 18456.
        error_number: Option<u32>,
    },
    /// TLS was required but the server certificate could not be validated.
    #[error("the server certificate could not be verified: {details}")]
    UntrustedCertificate {
        /// TLS layer message.
        details: String,
    },
    /// The requested database does not exist or the login cannot open it.
    #[error("database \"{database}\" is not available: {details}")]
    DatabaseUnavailable {
        /// Database that was requested.
        database: String,
        /// Server message.
        details: String,
        /// SQL Server error number, e.g. 4060.
        error_number: Option<u32>,
    },
    /// The server accepted the connection but refused the session for another reason.
    #[error("the server refused the connection to {target}: {details}")]
    ConnectionRefused {
        /// Server as the user typed it.
        target: String,
        /// Server or driver message.
        details: String,
        /// SQL Server error number, when the server sent the refusal.
        error_number: Option<u32>,
    },
    /// A catalog query failed to execute.
    #[error("catalog query \"{query}\" failed: {details}")]
    QueryFailed {
        /// Name of the query, e.g. `columns`.
        query: &'static str,
        /// Server or driver message.
        details: String,
        /// SQL Server error number, when the server raised one, e.g. 229.
        error_number: Option<u32>,
    },
    /// A catalog query returned data the inspector does not understand.
    #[error("unexpected catalog data in \"{query}\": {details}")]
    UnexpectedCatalogData {
        /// Name of the query.
        query: &'static str,
        /// What was unexpected.
        details: String,
    },
    /// The caller cancelled the operation.
    #[error("the operation was cancelled")]
    Cancelled,
    /// The feature exists on another operating system only, e.g. Windows Authentication.
    #[error("{feature} is not supported on this platform")]
    UnsupportedOnPlatform {
        /// Feature that is unavailable.
        feature: &'static str,
    },
    /// The settings refer to a remembered password the credential store no longer has.
    #[error("no remembered password for {username} on {target}")]
    StoredPasswordMissing {
        /// Server as the user typed it.
        target: String,
        /// Login whose password was expected.
        username: String,
    },
    /// The credential store could not be read.
    #[error("the credential store failed: {details}")]
    CredentialStoreFailed {
        /// Store message.
        details: String,
    },
}

/// Coarse classification of an [`InspectorError`], shared with the frontend to pick a remedy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
pub enum InspectorErrorKind {
    /// See [`InspectorError::InvalidSettings`].
    InvalidSettings,
    /// See [`InspectorError::Unreachable`].
    Unreachable,
    /// See [`InspectorError::Timeout`].
    Timeout,
    /// See [`InspectorError::AuthenticationFailed`].
    AuthenticationFailed,
    /// See [`InspectorError::UntrustedCertificate`].
    UntrustedCertificate,
    /// See [`InspectorError::DatabaseUnavailable`].
    DatabaseUnavailable,
    /// See [`InspectorError::ConnectionRefused`].
    ConnectionRefused,
    /// See [`InspectorError::QueryFailed`].
    QueryFailed,
    /// See [`InspectorError::UnexpectedCatalogData`].
    UnexpectedCatalogData,
    /// See [`InspectorError::Cancelled`].
    Cancelled,
    /// See [`InspectorError::UnsupportedOnPlatform`].
    UnsupportedOnPlatform,
    /// See [`InspectorError::StoredPasswordMissing`].
    StoredPasswordMissing,
    /// See [`InspectorError::CredentialStoreFailed`].
    CredentialStoreFailed,
}

impl InspectorError {
    /// Classification used by the frontend to choose user guidance.
    pub fn kind(&self) -> InspectorErrorKind {
        match self {
            Self::InvalidSettings { .. } => InspectorErrorKind::InvalidSettings,
            Self::Unreachable { .. } => InspectorErrorKind::Unreachable,
            Self::Timeout { .. } => InspectorErrorKind::Timeout,
            Self::AuthenticationFailed { .. } => InspectorErrorKind::AuthenticationFailed,
            Self::UntrustedCertificate { .. } => InspectorErrorKind::UntrustedCertificate,
            Self::DatabaseUnavailable { .. } => InspectorErrorKind::DatabaseUnavailable,
            Self::ConnectionRefused { .. } => InspectorErrorKind::ConnectionRefused,
            Self::QueryFailed { .. } => InspectorErrorKind::QueryFailed,
            Self::UnexpectedCatalogData { .. } => InspectorErrorKind::UnexpectedCatalogData,
            Self::Cancelled => InspectorErrorKind::Cancelled,
            Self::UnsupportedOnPlatform { .. } => InspectorErrorKind::UnsupportedOnPlatform,
            Self::StoredPasswordMissing { .. } => InspectorErrorKind::StoredPasswordMissing,
            Self::CredentialStoreFailed { .. } => InspectorErrorKind::CredentialStoreFailed,
        }
    }

    /// What the diagnostic log may record of this error: its kind, the SQL Server error number
    /// and the fixed name of the catalog query, never a message, a server, a login or a database.
    pub fn log_summary(&self) -> ErrorSummary<InspectorErrorKind> {
        let (error_number, query) = match self {
            Self::AuthenticationFailed { error_number, .. }
            | Self::DatabaseUnavailable { error_number, .. }
            | Self::ConnectionRefused { error_number, .. } => (*error_number, None),
            Self::QueryFailed {
                query,
                error_number,
                ..
            } => (*error_number, Some(*query)),
            Self::UnexpectedCatalogData { query, .. } => (None, Some(*query)),
            Self::InvalidSettings { .. }
            | Self::Unreachable { .. }
            | Self::Timeout { .. }
            | Self::UntrustedCertificate { .. }
            | Self::Cancelled
            | Self::UnsupportedOnPlatform { .. }
            | Self::StoredPasswordMissing { .. }
            | Self::CredentialStoreFailed { .. } => (None, None),
        };
        ErrorSummary {
            kind: self.kind(),
            error_number,
            query,
        }
    }
}

impl ClosedKind for InspectorErrorKind {}

#[cfg(test)]
mod tests {
    #![allow(clippy::indexing_slicing)]

    use std::collections::HashSet;

    use super::{InspectorError, InspectorErrorKind};
    use crate::diagnostics::capture::events_of;
    use crate::diagnostics::command_failed;

    const SERVER: &str = "sentinel-server.example.com";
    const DATABASE: &str = "SentinelDatabase";
    const LOGIN: &str = "sentinel_login";
    const PATH: &str = r"C:\Users\sentinel\shop.scraft";

    /// Every variant, each holding the sentinels wherever it holds text.
    fn every_variant() -> Vec<InspectorError> {
        let details =
            format!("Login failed for user '{LOGIN}' on {SERVER} for {DATABASE} at {PATH}");
        vec![
            InspectorError::InvalidSettings {
                reason: details.clone(),
            },
            InspectorError::Unreachable {
                target: SERVER.to_string(),
                details: details.clone(),
            },
            InspectorError::Timeout {
                target: SERVER.to_string(),
                seconds: 15,
            },
            InspectorError::AuthenticationFailed {
                details: details.clone(),
                error_number: Some(18456),
            },
            InspectorError::UntrustedCertificate {
                details: details.clone(),
            },
            InspectorError::DatabaseUnavailable {
                database: DATABASE.to_string(),
                details: details.clone(),
                error_number: Some(4060),
            },
            InspectorError::ConnectionRefused {
                target: SERVER.to_string(),
                details: details.clone(),
                error_number: None,
            },
            InspectorError::QueryFailed {
                query: "columns",
                details: details.clone(),
                error_number: Some(229),
            },
            InspectorError::UnexpectedCatalogData {
                query: "objects",
                details: details.clone(),
            },
            InspectorError::Cancelled,
            InspectorError::UnsupportedOnPlatform {
                feature: "Windows Authentication",
            },
            InspectorError::StoredPasswordMissing {
                target: SERVER.to_string(),
                username: LOGIN.to_string(),
            },
            InspectorError::CredentialStoreFailed { details },
        ]
    }

    #[test]
    fn the_log_summary_of_every_variant_names_no_server_database_login_or_path() {
        let errors = every_variant();
        let kinds: HashSet<String> = errors
            .iter()
            .map(|error| format!("{:?}", error.kind()))
            .collect();
        assert_eq!(kinds.len(), errors.len(), "one error per kind");

        for error in &errors {
            // A new variant fails to compile here, so it is added to every_variant too.
            match error {
                InspectorError::InvalidSettings { .. }
                | InspectorError::Unreachable { .. }
                | InspectorError::Timeout { .. }
                | InspectorError::AuthenticationFailed { .. }
                | InspectorError::UntrustedCertificate { .. }
                | InspectorError::DatabaseUnavailable { .. }
                | InspectorError::ConnectionRefused { .. }
                | InspectorError::QueryFailed { .. }
                | InspectorError::UnexpectedCatalogData { .. }
                | InspectorError::Cancelled
                | InspectorError::UnsupportedOnPlatform { .. }
                | InspectorError::StoredPasswordMissing { .. }
                | InspectorError::CredentialStoreFailed { .. } => {}
            }
            let summary = error.log_summary();
            let events = events_of(|| command_failed("test_connection", &summary));
            let logged = format!("{summary:?} {}", events[0].text());
            for sentinel in [SERVER, DATABASE, LOGIN, PATH, "sentinel", "Login failed"] {
                assert!(
                    !logged.contains(sentinel),
                    "{:?} logs {sentinel:?}: {logged}",
                    error.kind()
                );
            }
        }
    }

    #[test]
    fn the_log_summary_keeps_the_error_number_and_the_query() {
        let errors = every_variant();
        let rejected = errors[3].log_summary();
        assert_eq!(rejected.kind, InspectorErrorKind::AuthenticationFailed);
        assert_eq!(rejected.error_number, Some(18456));
        assert_eq!(rejected.query, None);

        let denied = errors[7].log_summary();
        assert_eq!(denied.error_number, Some(229));
        assert_eq!(denied.query, Some("columns"));

        assert_eq!(errors[8].log_summary().query, Some("objects"));
        assert_eq!(InspectorError::Cancelled.log_summary().error_number, None);
    }
}
