//! PostgreSQL connection policy; secrets never enter a saved connection.

use std::time::Duration;

use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use tokio_postgres::{Config, config::SslMode};
use ts_rs::TS;

use crate::credentials::{CredentialKey, CredentialStore};
use crate::inspectors::{InspectorError, sqlserver::PasswordSource};

/// PostgreSQL's default TCP port.
pub const DEFAULT_PORT: u16 = 5432;

/// Explicit PostgreSQL transport policy. There is no opportunistic plaintext fallback.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
pub enum PostgreSqlEncryptionMode {
    /// Require TLS and validate both the certificate chain and host name.
    #[default]
    VerifyFull,
    /// Require TLS but accept an unverified certificate, for an explicit local test connection.
    Require,
    /// Explicitly use plaintext, for a local development server without TLS.
    Disable,
}

/// A PostgreSQL connection received from the frontend, including its transient password.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
pub struct PostgreSqlConnectionSettings {
    /// Host name or IP address, without URI credentials.
    pub host: String,
    /// TCP port; absent means 5432.
    #[serde(default)]
    pub port: Option<u16>,
    /// Database; absent uses the standard maintenance database for discovery.
    #[serde(default)]
    pub database: Option<String>,
    /// Role name, with its original case preserved.
    pub username: String,
    /// Typed or remembered password; never serialized back to the frontend.
    pub password: PasswordSource,
    /// Transport/certificate policy, strict by default.
    #[serde(default)]
    pub encryption: PostgreSqlEncryptionMode,
    /// An additional public root certificate in PEM format, not a private key or a file path.
    #[serde(default)]
    pub root_certificate: Option<String>,
    /// Seconds allowed for the complete connection and authentication operation.
    #[serde(default = "default_timeout")]
    pub connect_timeout_seconds: u32,
}

fn default_timeout() -> u32 {
    15
}

impl PostgreSqlConnectionSettings {
    /// Validate settings without opening a socket.
    pub fn validate(&self) -> Result<(), InspectorError> {
        if self.host.trim().is_empty() || self.host.contains(['/', '\\', '\0']) {
            return Err(InspectorError::InvalidSettings {
                reason: "a PostgreSQL host must be a host name or IP address".to_string(),
            });
        }
        if self.port == Some(0)
            || self.username.trim().is_empty()
            || self.username.contains('\0')
            || self
                .database
                .as_ref()
                .is_some_and(|name| name.contains('\0'))
        {
            return Err(InspectorError::InvalidSettings {
                reason: "a nonempty PostgreSQL role and a valid TCP port are required".to_string(),
            });
        }
        if let Some(pem) = self
            .root_certificate
            .as_deref()
            .filter(|pem| !pem.trim().is_empty())
        {
            let pem = pem.trim();
            if !pem.starts_with("-----BEGIN CERTIFICATE-----")
                || !pem.ends_with("-----END CERTIFICATE-----")
                || pem.matches("-----BEGIN").count() != 1
                || pem.contains("PRIVATE KEY")
            {
                return Err(InspectorError::InvalidSettings { reason:"the additional root must contain exactly one public PEM certificate and no private key".into() });
            }
        }
        if self.encryption != PostgreSqlEncryptionMode::VerifyFull && !self.is_local() {
            return Err(InspectorError::InvalidSettings {
                reason: "unverified TLS and plaintext are restricted to explicit local development connections".to_string(),
            });
        }
        Ok(())
    }

    fn is_local(&self) -> bool {
        let host = self
            .host
            .trim()
            .trim_start_matches('[')
            .trim_end_matches(']');
        host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    }

    /// Driver settings are built with setters, never a connection string containing a password.
    pub(super) fn config(&self) -> Result<Config, InspectorError> {
        self.validate()?;
        let PasswordSource::Provided { value } = &self.password else {
            return Err(InspectorError::InvalidSettings {
                reason: "the remembered PostgreSQL password was not resolved".to_string(),
            });
        };
        let mut config = Config::new();
        config
            .host(
                self.host
                    .trim()
                    .trim_start_matches('[')
                    .trim_end_matches(']'),
            )
            .port(self.port.unwrap_or(DEFAULT_PORT))
            .user(&self.username)
            .password(value.expose_secret())
            .dbname(
                self.database
                    .as_deref()
                    .filter(|name| !name.is_empty())
                    .unwrap_or("postgres"),
            )
            .application_name("SchemaCraft")
            .connect_timeout(self.connect_timeout())
            .ssl_mode(if self.encryption == PostgreSqlEncryptionMode::Disable {
                SslMode::Disable
            } else {
                SslMode::Require
            });
        Ok(config)
    }

    /// Complete connection timeout, including TLS and authentication.
    pub fn connect_timeout(&self) -> Duration {
        Duration::from_secs(u64::from(self.connect_timeout_seconds.max(1)))
    }

    /// Canonical endpoint for history and credential lookup.
    pub fn display_target(&self) -> String {
        format_target(&self.host, self.port)
    }

    /// The engine-specific Windows credential namespace for this role.
    pub fn credential_key(&self) -> CredentialKey {
        CredentialKey::postgresql_login(&self.display_target(), &self.username)
    }

    /// Resolve a remembered password just before the operation connects.
    pub fn resolve_stored_password(
        self,
        store: &dyn CredentialStore,
    ) -> Result<Self, InspectorError> {
        if !matches!(self.password, PasswordSource::Stored) {
            return Ok(self);
        }
        let value = store
            .retrieve(&self.credential_key())
            .map_err(|error| InspectorError::CredentialStoreFailed {
                details: error.to_string(),
            })?
            .ok_or_else(|| InspectorError::StoredPasswordMissing {
                target: self.display_target(),
                username: self.username.clone(),
            })?;
        Ok(Self {
            password: PasswordSource::Provided { value },
            ..self
        })
    }
}

/// Canonical PostgreSQL endpoint, with brackets around an IPv6 address.
pub fn format_target(host: &str, port: Option<u16>) -> String {
    let host = host.trim().trim_start_matches('[').trim_end_matches(']');
    let port = port.unwrap_or(DEFAULT_PORT);
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    fn settings() -> PostgreSqlConnectionSettings {
        PostgreSqlConnectionSettings {
            host: "localhost".into(),
            port: None,
            database: None,
            username: "MixedCase".into(),
            password: PasswordSource::Provided {
                value: "synthetic".into(),
            },
            encryption: PostgreSqlEncryptionMode::VerifyFull,
            root_certificate: None,
            connect_timeout_seconds: 15,
        }
    }

    #[test]
    fn strict_transport_and_native_role_identity_are_preserved() {
        let settings = settings();
        let config = settings.config().unwrap();
        assert_eq!(config.get_user(), Some("MixedCase"));
        assert_eq!(config.get_dbname(), Some("postgres"));
        assert_eq!(config.get_ssl_mode(), SslMode::Require);
        assert_eq!(settings.display_target(), "localhost:5432");
        assert_eq!(format_target("::1", None), "[::1]:5432");
    }

    #[test]
    fn insecure_policies_never_apply_to_remote_hosts() {
        let mut settings = settings();
        settings.host = "db.example.test".into();
        settings.encryption = PostgreSqlEncryptionMode::Require;
        assert!(settings.validate().is_err());
        settings.encryption = PostgreSqlEncryptionMode::Disable;
        assert!(settings.validate().is_err());
        settings.encryption = PostgreSqlEncryptionMode::VerifyFull;
        assert!(settings.validate().is_ok());
    }

    #[test]
    fn a_root_certificate_field_never_accepts_a_private_key() {
        let mut settings = settings();
        settings.root_certificate=Some("-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----".into());
        assert!(settings.validate().is_err());
    }
}
