//! Remembered passwords, kept by the operating system credential store rather than by any
//! SchemaCraft file.
//!
//! When the user ticks "remember password", the secret is handed to a [`CredentialStore`] under
//! a key derived from the server and the login name. Connection settings then refer to it as a
//! stored password, and the application resolves it right before connecting. The store is a
//! strategy: the system store in the application, memory in tests and previews.

mod memory;
mod system;

use std::fmt;

use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

pub use memory::InMemoryCredentialStore;
pub use system::SystemCredentialStore;

/// Service name every SchemaCraft entry is filed under.
pub const SERVICE_NAME: &str = "SchemaCraft";

/// Identifies one remembered password: a login on one server.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CredentialKey {
    account: String,
}

impl CredentialKey {
    /// Key of a SQL Server login. The server is case-folded because server names are; the
    /// login name is kept as typed because logins may be case-sensitive.
    pub fn sql_server_login(target: &str, username: &str) -> Self {
        Self {
            account: format!(
                "sqlserver://{}/{}",
                target.trim().to_lowercase(),
                username.trim()
            ),
        }
    }

    /// Entry name inside the store, e.g. `sqlserver://db.example.com,1433/app`.
    pub fn account(&self) -> &str {
        &self.account
    }
}

impl fmt::Display for CredentialKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.account)
    }
}

/// Failure of the credential store.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CredentialError {
    /// This build has no credential store for the current platform.
    #[error("the operating system credential store is not available on this platform")]
    Unavailable,
    /// The store refused the operation.
    #[error("the credential store failed: {details}")]
    StoreFailed {
        /// Message from the store.
        details: String,
    },
}

impl CredentialError {
    /// Classification for the UI.
    pub fn kind(&self) -> CredentialErrorKind {
        match self {
            Self::Unavailable => CredentialErrorKind::Unavailable,
            Self::StoreFailed { .. } => CredentialErrorKind::StoreFailed,
        }
    }
}

/// Serialisable classification of a [`CredentialError`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "credentials/")]
pub enum CredentialErrorKind {
    /// See [`CredentialError::Unavailable`].
    Unavailable,
    /// See [`CredentialError::StoreFailed`].
    StoreFailed,
}

/// Where remembered passwords live.
pub trait CredentialStore: Send + Sync {
    /// Saves `secret` under `key`, replacing any previous value.
    fn store(&self, key: &CredentialKey, secret: &SecretString) -> Result<(), CredentialError>;

    /// The secret under `key`, if one was stored.
    fn retrieve(&self, key: &CredentialKey) -> Result<Option<SecretString>, CredentialError>;

    /// Deletes the secret under `key`; `false` when there was none.
    fn remove(&self, key: &CredentialKey) -> Result<bool, CredentialError>;

    /// Whether a secret exists under `key`, without handing it out.
    fn contains(&self, key: &CredentialKey) -> Result<bool, CredentialError> {
        Ok(self.retrieve(key)?.is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::{CredentialError, CredentialErrorKind, CredentialKey};

    #[test]
    fn keys_fold_the_server_but_keep_the_login_name() {
        let key = CredentialKey::sql_server_login(" DB.Example.com,1433 ", " App ");
        assert_eq!(key.account(), "sqlserver://db.example.com,1433/App");
        assert_eq!(key.to_string(), key.account());
        assert_eq!(
            key,
            CredentialKey::sql_server_login("db.example.com,1433", "App")
        );
        assert_ne!(
            key,
            CredentialKey::sql_server_login("db.example.com,1433", "sa")
        );
        assert_ne!(key, CredentialKey::sql_server_login("other,1433", "App"));
    }

    #[test]
    fn errors_classify_themselves() {
        assert_eq!(
            CredentialError::Unavailable.kind(),
            CredentialErrorKind::Unavailable
        );
        let failed = CredentialError::StoreFailed {
            details: "access denied".to_string(),
        };
        assert_eq!(failed.kind(), CredentialErrorKind::StoreFailed);
        assert!(failed.to_string().contains("access denied"));
    }
}
