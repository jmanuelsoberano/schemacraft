//! Operation-scoped PostgreSQL sessions and classified driver failures.

use native_tls::{Certificate, TlsConnector};
use postgres_native_tls::MakeTlsConnector;
use std::error::Error as _;
use tokio::task::JoinHandle;
use tokio_postgres::{Client, Error, Row, types::ToSql};

use super::settings::{PostgreSqlConnectionSettings, PostgreSqlEncryptionMode};
use crate::inspectors::InspectorError;

/// The connection task is aborted on every exit, including cancellation of its owning future.
pub(super) struct Session {
    pub(super) client: Client,
    task: JoinHandle<()>,
}

impl Drop for Session {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Session {
    pub(super) async fn connect(
        settings: &PostgreSqlConnectionSettings,
    ) -> Result<Self, InspectorError> {
        let config = settings.config()?;
        let mut builder = TlsConnector::builder();
        if let Some(pem) = settings
            .root_certificate
            .as_deref()
            .filter(|pem| !pem.trim().is_empty())
        {
            let certificate = Certificate::from_pem(pem.as_bytes()).map_err(|_| {
                InspectorError::InvalidSettings {
                    reason: "the additional PostgreSQL root certificate is not valid PEM"
                        .to_string(),
                }
            })?;
            builder.add_root_certificate(certificate);
        }
        if settings.encryption == PostgreSqlEncryptionMode::Require {
            builder
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true);
        }
        let tls = MakeTlsConnector::new(builder.build().map_err(|_| {
            InspectorError::UntrustedCertificate {
                details: "the system TLS connector could not be initialized".to_string(),
            }
        })?);
        let (client, connection) =
            tokio::time::timeout(settings.connect_timeout(), config.connect(tls))
                .await
                .map_err(|_| InspectorError::Timeout {
                    target: settings.display_target(),
                    seconds: settings.connect_timeout().as_secs(),
                })?
                .map_err(|error| connection_error(settings, &error))?;
        let task = tokio::spawn(async move {
            // Driver messages contain host, role, database and SQL text; never log them.
            let _ = connection.await;
        });
        let session = Self { client, task };
        session.client.batch_execute(
            "SET default_transaction_read_only = on; SET search_path = pg_catalog; SET statement_timeout = 120000; SET lock_timeout = 5000;"
        ).await.map_err(|error| query_error("session_policy", &error))?;
        Ok(session)
    }

    /// Each catalog read uses its own implicit read-only transaction. A failed optional read
    /// cannot leave a shared transaction aborted and poison subsequent structural reads.
    pub(super) async fn query(
        &self,
        label: &'static str,
        sql: &str,
        params: &[&(dyn ToSql + Sync)],
    ) -> Result<Vec<Row>, InspectorError> {
        self.client
            .query(sql, params)
            .await
            .map_err(|error| query_error(label, &error))
    }
}

pub(super) fn query_error(query: &'static str, error: &Error) -> InspectorError {
    InspectorError::QueryFailed {
        query,
        // The raw text is available only as the typed operation failure, never a log field.
        details: error.to_string(),
        error_number: None,
    }
}

fn connection_error(settings: &PostgreSqlConnectionSettings, error: &Error) -> InspectorError {
    let details = error.to_string();
    if let Some(database) = error.as_db_error() {
        let code = database.code().code();
        if code.starts_with("28") {
            return InspectorError::AuthenticationFailed {
                details,
                error_number: None,
            };
        }
        if code == "3D000" || code == "42501" {
            return InspectorError::DatabaseUnavailable {
                database: settings
                    .database
                    .clone()
                    .unwrap_or_else(|| "postgres".to_string()),
                details,
                error_number: None,
            };
        }
        return InspectorError::ConnectionRefused {
            target: settings.display_target(),
            details,
            error_number: None,
        };
    }
    let mut source = error.source();
    let mut certificate_failure = false;
    while let Some(cause) = source {
        certificate_failure |= cause.is::<native_tls::Error>();
        source = cause.source();
    }
    if certificate_failure {
        InspectorError::UntrustedCertificate { details }
    } else {
        InspectorError::Unreachable {
            target: settings.display_target(),
            details,
        }
    }
}

/// Reads a catalog column without a driver panic or an unbounded raw debug dump.
pub(super) fn field<T: tokio_postgres::types::FromSqlOwned>(
    row: &Row,
    column: &str,
    query: &'static str,
) -> Result<T, InspectorError> {
    row.try_get(column)
        .map_err(|_| InspectorError::UnexpectedCatalogData {
            query,
            details: format!("catalog column {column} has an unexpected type or NULL state"),
        })
}
