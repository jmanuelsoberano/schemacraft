//! Microsoft SQL Server inspector built on `tiberius`.
//!
//! The inspector owns nothing between calls: each operation opens a short-lived pool, runs its
//! catalog queries and drops the pool, so the application never keeps idle sessions on a
//! production server.

mod access;
mod assembly;
mod bound_defaults;
mod catalog;
mod code_assembly;
mod data_types;
mod dependencies;
mod errors;
mod pool;
mod programmability;
mod settings;

use async_trait::async_trait;
use chrono::Utc;
use tiberius::Config;
use tokio_util::sync::CancellationToken;

pub use settings::{
    EncryptionMode, PasswordSource, SqlServerAuthentication, SqlServerConnectionSettings,
    format_target,
};

use self::assembly::SnapshotIdentity;
use self::catalog::CatalogSession;
use self::pool::{ConnectionPool, PoolSettings, checkout_error, open_pool};
use crate::diagnostics::{self, CodeCapture, InspectionCompleted};
use crate::inspectors::{
    DatabaseDescription, DatabaseInspector, InspectionOptions, InspectionProgress, InspectionStage,
    InspectorError, ProgressReporter, ServerInformation,
};
use crate::model::{Definition, Programmability, SchemaSnapshot};

/// Sessions opened for a full inspection, so catalog queries run in parallel.
const INSPECTION_CONNECTIONS: u32 = 4;

/// [`DatabaseInspector`] for Microsoft SQL Server.
pub struct SqlServerInspector {
    settings: SqlServerConnectionSettings,
    config: Config,
}

impl SqlServerInspector {
    /// Validates the settings; no connection is attempted yet.
    pub fn new(settings: SqlServerConnectionSettings) -> Result<Self, InspectorError> {
        let config = settings.to_tiberius_config()?;
        Ok(Self { settings, config })
    }

    /// Server as the user typed it, for messages.
    pub fn target(&self) -> String {
        self.settings.display_target()
    }

    async fn pool(&self, max_connections: u32) -> Result<ConnectionPool, InspectorError> {
        open_pool(PoolSettings {
            config: self.config.clone(),
            connect_timeout: self.settings.connect_timeout(),
            target: self.target(),
            database: self.settings.database.clone(),
            max_connections,
        })
        .await
    }

    async fn checkout<'pool>(
        &self,
        pool: &'pool ConnectionPool,
    ) -> Result<bb8::PooledConnection<'pool, pool::TiberiusConnectionManager>, InspectorError> {
        pool.get()
            .await
            .map_err(|error| checkout_error(error, &self.target(), self.settings.connect_timeout()))
    }

    /// The inspection itself: connect, then read the access facts and the catalog together and
    /// assemble them, logging the counts and the time of each stage (ADR-041).
    /// [`DatabaseInspector::inspect`] races it against the cancellation token.
    async fn read_snapshot(
        &self,
        options: &InspectionOptions,
        progress: &dyn ProgressReporter,
    ) -> Result<SchemaSnapshot, InspectorError> {
        let started = std::time::Instant::now();
        progress.report(InspectionProgress::stage(InspectionStage::Connecting));

        let pool = self.pool(INSPECTION_CONNECTIONS).await?;
        let server = {
            let mut connection = self.checkout(&pool).await?;
            catalog::fetch_server_information(&mut connection).await?
        };
        let connected = started.elapsed();

        let target = self.target();
        let session = CatalogSession {
            pool: &pool,
            target: &target,
            connect_timeout: self.settings.connect_timeout(),
        };
        // Code is an optional capture: its failure must leave a successful table catalog usable.
        let (catalog_result, code, dependencies) = tokio::join!(
            async {
                tokio::try_join!(
                    access::fetch_access_stage(&session, progress),
                    catalog::fetch_catalog(&session, progress),
                )
            },
            programmability::fetch_code_stage(&session, progress, options),
            dependencies::fetch_dependencies(&session, options),
        );
        let (probe, rows) = catalog_result?;
        let reading_code = code.elapsed;
        let read = started.elapsed();

        if options.include_dependencies {
            progress.report(dependencies.row_count().map_or_else(
                || InspectionProgress::stage(InspectionStage::ReadingDependencies),
                |count| InspectionProgress::counted(InspectionStage::ReadingDependencies, count),
            ));
        }

        progress.report(InspectionProgress::stage(InspectionStage::Assembling));
        let mut snapshot = assembly::assemble_snapshot(
            &rows,
            probe,
            options,
            SnapshotIdentity {
                database_name: server.database_name,
                server_version: Some(server.product),
                extracted_at: Utc::now(),
            },
            code,
        );
        snapshot.dependencies = Some(dependencies.assemble(&snapshot, options));
        if let Some(family) = &snapshot.dependencies {
            diagnostics::dependencies_captured(
                CodeCapture::from(&family.capture),
                family.sources.len(),
                family.edges.len(),
            );
        }

        let total = started.elapsed();
        let code = CodeSummary::of(snapshot.programmability.as_ref());
        diagnostics::inspection_completed(&InspectionCompleted {
            tables: snapshot.tables.len(),
            views: snapshot.views.len(),
            foreign_keys: snapshot.foreign_keys.len(),
            foreign_keys_to_invisible_tables: snapshot.foreign_keys_to_invisible_tables.len(),
            access: snapshot.access.as_ref().map(|profile| profile.level),
            code: code.objects,
            code_texts: code.definitions,
            routines: code.routines,
            triggers: code.triggers,
            view_modules: code.view_modules,
            module_texts: code.readable,
            module_texts_not_visible: code.not_visible,
            module_texts_encrypted: code.encrypted,
            reading_code,
            connecting: connected,
            reading: read.saturating_sub(connected),
            assembling: total.saturating_sub(read),
            total,
        });
        progress.report(InspectionProgress::counted(
            InspectionStage::Completed,
            snapshot.tables.len(),
        ));
        Ok(snapshot)
    }
}

/// Aggregate code facts for the privacy-preserving diagnostic event.
struct CodeSummary {
    objects: CodeCapture,
    definitions: CodeCapture,
    routines: usize,
    triggers: usize,
    view_modules: usize,
    readable: usize,
    not_visible: usize,
    encrypted: usize,
}

impl CodeSummary {
    fn of(programmability: Option<&Programmability>) -> Self {
        let mut summary = Self {
            objects: CodeCapture::Unknown,
            definitions: CodeCapture::Unknown,
            routines: 0,
            triggers: 0,
            view_modules: 0,
            readable: 0,
            not_visible: 0,
            encrypted: 0,
        };
        if let Some(code) = programmability {
            summary.objects = CodeCapture::from(&code.capture.objects);
            summary.definitions = CodeCapture::from(&code.capture.definitions);
            summary.routines = code.routines.len();
            summary.triggers = code.triggers.len();
            summary.view_modules = code.views.len();
            for definition in code.module_definitions() {
                match definition {
                    Definition::Readable { .. } => summary.readable += 1,
                    Definition::NotVisible => summary.not_visible += 1,
                    Definition::Encrypted => summary.encrypted += 1,
                    Definition::NotRecorded | Definition::Unknown => {}
                }
            }
        }
        summary
    }
}

#[async_trait]
impl DatabaseInspector for SqlServerInspector {
    async fn test_connection(&self) -> Result<ServerInformation, InspectorError> {
        let pool = self.pool(1).await?;
        let mut connection = self.checkout(&pool).await?;
        catalog::fetch_server_information(&mut connection).await
    }

    async fn list_databases(&self) -> Result<Vec<String>, InspectorError> {
        let pool = self.pool(1).await?;
        let mut connection = self.checkout(&pool).await?;
        catalog::fetch_database_names(&mut connection).await
    }

    async fn describe_database(&self) -> Result<DatabaseDescription, InspectorError> {
        let pool = self.pool(1).await?;
        let mut connection = self.checkout(&pool).await?;
        let probe = access::fetch_access_probe(&mut connection).await?;
        Ok(DatabaseDescription::from_probe(probe))
    }

    /// Every step, opening the pool and the login handshake included, races the token: a
    /// server that accepts the TCP connection and then never answers is abandoned at once.
    /// Dropping the unfinished work closes its sessions.
    async fn inspect(
        &self,
        options: &InspectionOptions,
        progress: &dyn ProgressReporter,
        cancellation: CancellationToken,
    ) -> Result<SchemaSnapshot, InspectorError> {
        tokio::select! {
            biased;
            () = cancellation.cancelled() => Err(InspectorError::Cancelled),
            result = self.read_snapshot(options, progress) => result,
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use std::time::{Duration, Instant};

    use secrecy::SecretString;
    use tokio::net::TcpListener;
    use tokio_util::sync::CancellationToken;

    use super::{
        EncryptionMode, PasswordSource, SqlServerAuthentication, SqlServerConnectionSettings,
        SqlServerInspector,
    };
    use crate::inspectors::{DatabaseInspector, InspectionOptions, InspectorError, SilentProgress};

    /// A server that accepts connections and never says a word, so the login handshake hangs.
    async fn silent_server() -> (u16, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(async move {
            let mut accepted = Vec::new();
            while let Ok((stream, _)) = listener.accept().await {
                accepted.push(stream);
            }
        });
        (port, task)
    }

    /// An inspector for the silent server, patient enough that only cancelling can stop it.
    fn inspector_for(port: u16) -> SqlServerInspector {
        SqlServerInspector::new(SqlServerConnectionSettings {
            host: "127.0.0.1".to_string(),
            instance: None,
            port: Some(port),
            database: Some("Northwind".to_string()),
            authentication: SqlServerAuthentication::SqlLogin {
                username: "reporting".to_string(),
                password: PasswordSource::Provided {
                    value: SecretString::from("not-used".to_string()),
                },
            },
            encryption: EncryptionMode::Mandatory,
            trust_server_certificate: false,
            connect_timeout_seconds: 30,
        })
        .unwrap()
    }

    #[tokio::test]
    async fn cancelling_stops_an_inspection_stuck_in_the_login_handshake() {
        let (port, server) = silent_server().await;
        let inspector = inspector_for(port);
        let cancellation = CancellationToken::new();
        let canceller = cancellation.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            canceller.cancel();
        });

        let started = Instant::now();
        let result = inspector
            .inspect(&InspectionOptions::default(), &SilentProgress, cancellation)
            .await;

        assert_eq!(result.err(), Some(InspectorError::Cancelled));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "took {:?}",
            started.elapsed()
        );
        server.abort();
    }

    #[tokio::test]
    async fn a_token_cancelled_beforehand_returns_at_once() {
        let (port, server) = silent_server().await;
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let started = Instant::now();
        let result = inspector_for(port)
            .inspect(&InspectionOptions::default(), &SilentProgress, cancellation)
            .await;

        assert_eq!(result.err(), Some(InspectorError::Cancelled));
        assert!(started.elapsed() < Duration::from_secs(1));
        server.abort();
    }
}
