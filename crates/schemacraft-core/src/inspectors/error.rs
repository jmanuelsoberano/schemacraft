use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

/// Failure of a connection or inspection, structured so the UI can propose a remedy.
///
/// Messages are written for logs and developers; the frontend translates the [`kind`] into
/// user-facing guidance and shows `details` as secondary information.
///
/// [`kind`]: InspectorError::kind
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
    },
    /// The server accepted the connection but refused the session for another reason.
    #[error("the server refused the connection to {target}: {details}")]
    ConnectionRefused {
        /// Server as the user typed it.
        target: String,
        /// Server or driver message.
        details: String,
    },
    /// A catalog query failed to execute.
    #[error("catalog query \"{query}\" failed: {details}")]
    QueryFailed {
        /// Name of the query, e.g. `columns`.
        query: &'static str,
        /// Server or driver message.
        details: String,
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
}
