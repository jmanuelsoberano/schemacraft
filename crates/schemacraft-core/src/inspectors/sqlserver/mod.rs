//! Microsoft SQL Server inspector built on `tiberius`.
//!
//! The inspector owns nothing between calls: each operation opens a short-lived pool, runs its
//! catalog queries and drops the pool, so the application never keeps idle sessions on a
//! production server.

mod assembly;
mod catalog;
mod data_types;
mod errors;
mod pool;
mod settings;

use async_trait::async_trait;
use chrono::Utc;
use tiberius::Config;
use tokio_util::sync::CancellationToken;

pub use settings::{EncryptionMode, SqlServerAuthentication, SqlServerConnectionSettings};

use self::assembly::SnapshotIdentity;
use self::catalog::CatalogSession;
use self::pool::{ConnectionPool, PoolSettings, checkout_error, open_pool};
use crate::inspectors::{
    DatabaseInspector, InspectionOptions, InspectionProgress, InspectionStage, InspectorError,
    ProgressReporter, ServerInformation,
};
use crate::model::SchemaSnapshot;

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

    async fn list_schemas(&self) -> Result<Vec<String>, InspectorError> {
        let pool = self.pool(1).await?;
        let mut connection = self.checkout(&pool).await?;
        catalog::fetch_schema_names(&mut connection).await
    }

    async fn inspect(
        &self,
        options: &InspectionOptions,
        progress: &dyn ProgressReporter,
        cancellation: CancellationToken,
    ) -> Result<SchemaSnapshot, InspectorError> {
        let started = std::time::Instant::now();
        progress.report(InspectionProgress::stage(InspectionStage::Connecting));

        let pool = self.pool(INSPECTION_CONNECTIONS).await?;
        let server = {
            let mut connection = self.checkout(&pool).await?;
            catalog::fetch_server_information(&mut connection).await?
        };
        if cancellation.is_cancelled() {
            return Err(InspectorError::Cancelled);
        }

        let target = self.target();
        let session = CatalogSession {
            pool: &pool,
            target: &target,
            connect_timeout: self.settings.connect_timeout(),
        };
        let rows = tokio::select! {
            () = cancellation.cancelled() => return Err(InspectorError::Cancelled),
            result = catalog::fetch_catalog(&session, progress) => result?,
        };

        progress.report(InspectionProgress::stage(InspectionStage::Assembling));
        let snapshot = assembly::assemble_snapshot(
            &rows,
            options,
            SnapshotIdentity {
                database_name: server.database_name,
                server_version: Some(server.product),
                extracted_at: Utc::now(),
            },
        );

        tracing::info!(
            database = %snapshot.database_name,
            tables = snapshot.tables.len(),
            views = snapshot.views.len(),
            foreign_keys = snapshot.foreign_keys.len(),
            elapsed_ms = started.elapsed().as_millis(),
            "inspection completed"
        );
        progress.report(InspectionProgress::counted(
            InspectionStage::Completed,
            snapshot.tables.len(),
        ));
        Ok(snapshot)
    }
}
