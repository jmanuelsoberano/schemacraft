//! Connection pooling for `tiberius` on top of `bb8`.
//!
//! `bb8-tiberius` still targets tiberius 0.12, so the manager is implemented here. It is small:
//! resolve the address (named instances go through SQL Browser), open TCP with a timeout, run
//! the login handshake and validate idle connections with a trivial query.

use std::ops::{Deref, DerefMut};
use std::time::Duration;

use bb8::{ManageConnection, Pool, RunError};
use tiberius::{Client, Config, SqlBrowser};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use super::errors::{ConnectionContext, classify_connect_error, query_error};
use crate::inspectors::InspectorError;

/// A logged-in SQL Server session.
pub(super) type SqlServerConnection = Client<Compat<TcpStream>>;
/// Pool of sessions sharing one configuration.
pub(super) type ConnectionPool = Pool<TiberiusConnectionManager>;

/// A pooled session that can be retired after a failed, interrupted code read. The driver
/// cannot recover a response that timed out midway; returning it would poison a table query.
pub(super) struct ManagedConnection {
    client: SqlServerConnection,
    discarded: bool,
}

impl ManagedConnection {
    /// Prevents this session from being offered to another query when its lease ends.
    pub(super) fn discard(&mut self) {
        self.discarded = true;
    }
}

impl Deref for ManagedConnection {
    type Target = SqlServerConnection;

    fn deref(&self) -> &Self::Target {
        &self.client
    }
}

impl DerefMut for ManagedConnection {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.client
    }
}

/// Opens and validates sessions for one connection configuration.
pub(super) struct TiberiusConnectionManager {
    config: Config,
    connect_timeout: Duration,
    target: String,
    database: Option<String>,
}

impl TiberiusConnectionManager {
    fn connection_context(&self) -> ConnectionContext<'_> {
        ConnectionContext {
            target: &self.target,
            database: self.database.as_deref(),
            timeout_seconds: self.connect_timeout.as_secs(),
        }
    }
}

impl ManageConnection for TiberiusConnectionManager {
    type Connection = ManagedConnection;
    type Error = InspectorError;

    async fn connect(&self) -> Result<Self::Connection, Self::Error> {
        let context = self.connection_context();

        let tcp =
            tokio::time::timeout(self.connect_timeout, TcpStream::connect_named(&self.config))
                .await
                .map_err(|_elapsed| InspectorError::Timeout {
                    target: self.target.clone(),
                    seconds: self.connect_timeout.as_secs(),
                })?
                .map_err(|error| classify_connect_error(&error, &context))?;

        tcp.set_nodelay(true)
            .map_err(|error| InspectorError::Unreachable {
                target: self.target.clone(),
                details: error.to_string(),
            })?;

        Client::connect(self.config.clone(), tcp.compat_write())
            .await
            .map(|client| ManagedConnection {
                client,
                discarded: false,
            })
            .map_err(|error| classify_connect_error(&error, &context))
    }

    async fn is_valid(&self, connection: &mut Self::Connection) -> Result<(), Self::Error> {
        connection
            .simple_query("SELECT 1")
            .await
            .map_err(|error| query_error("ping", &error))?
            .into_row()
            .await
            .map_err(|error| query_error("ping", &error))?;
        Ok(())
    }

    fn has_broken(&self, connection: &mut Self::Connection) -> bool {
        connection.discarded
    }
}

/// Settings of a pool bound to one server and database.
pub(super) struct PoolSettings {
    /// Driver configuration shared by every session.
    pub config: Config,
    /// Time allowed per TCP connection attempt.
    pub connect_timeout: Duration,
    /// Server as the user typed it, for error messages.
    pub target: String,
    /// Database that was requested, for error messages.
    pub database: Option<String>,
    /// Upper bound of concurrent sessions.
    pub max_connections: u32,
}

/// Opens a pool and establishes its first session eagerly, so connection problems surface here.
pub(super) async fn open_pool(settings: PoolSettings) -> Result<ConnectionPool, InspectorError> {
    let manager = TiberiusConnectionManager {
        config: settings.config,
        connect_timeout: settings.connect_timeout,
        target: settings.target,
        database: settings.database,
    };

    Pool::builder()
        .max_size(settings.max_connections.max(1))
        .min_idle(Some(1))
        .connection_timeout(settings.connect_timeout.saturating_mul(2))
        .test_on_check_out(false)
        // A failed login or TLS handshake must surface at once, not after a retry loop.
        .retry_connection(false)
        .build(manager)
        .await
}

/// Translates a pool checkout failure into an inspector error.
pub(super) fn checkout_error(
    error: RunError<InspectorError>,
    target: &str,
    connect_timeout: Duration,
) -> InspectorError {
    match error {
        RunError::User(inner) => inner,
        RunError::TimedOut => InspectorError::Timeout {
            target: target.to_string(),
            seconds: connect_timeout.saturating_mul(2).as_secs(),
        },
    }
}
