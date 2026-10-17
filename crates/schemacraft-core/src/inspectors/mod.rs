//! Database inspectors: the strategy that turns a live database into a [`SchemaSnapshot`].
//!
//! [`DatabaseInspector`] is the only abstraction the rest of the application depends on. Each
//! supported engine implements it once and [`create_inspector`] picks the implementation from
//! the connection settings. Adding PostgreSQL or MySQL means a module here and a variant of
//! [`ConnectionSettings`], plus the parts that still speak SQL Server: the saved connection in
//! `project`, the credential key in `credentials`, and the connection form and its conversions
//! in the frontend. The architecture page keeps the full recipe.

mod error;
mod progress;
mod settings;
pub mod sqlserver;

use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

pub use error::{InspectorError, InspectorErrorKind};
pub use progress::{InspectionProgress, InspectionStage, ProgressReporter, SilentProgress};
pub use settings::{ConnectionSettings, DatabaseDescription, InspectionOptions, ServerInformation};

use crate::model::SchemaSnapshot;

/// Read-only access to the structure of a database.
///
/// Implementations own their connections and must be safe to share between tasks. Every method
/// maps engine failures to [`InspectorError`], which carries enough structure for the UI to
/// suggest a remedy.
///
/// A login may see only part of a database. Implementations never guess: they read what the
/// login is allowed to see with one access probe, which [`describe_database`] reports before
/// anything is read and [`inspect`] records in the snapshot it returns.
///
/// [`describe_database`]: DatabaseInspector::describe_database
/// [`inspect`]: DatabaseInspector::inspect
#[async_trait]
pub trait DatabaseInspector: Send + Sync {
    /// Verifies that the server accepts the connection and returns its identity.
    async fn test_connection(&self) -> Result<ServerInformation, InspectorError>;

    /// Online databases the login can access, excluding system databases.
    async fn list_databases(&self) -> Result<Vec<String>, InspectorError>;

    /// User schemas of the configured database and what the login is predicted to see there.
    async fn describe_database(&self) -> Result<DatabaseDescription, InspectorError>;

    /// Extracts a snapshot of what the login can see, with its access profile, reporting
    /// progress. Cancelling the token stops the work at any point, connecting included.
    async fn inspect(
        &self,
        options: &InspectionOptions,
        progress: &dyn ProgressReporter,
        cancellation: CancellationToken,
    ) -> Result<SchemaSnapshot, InspectorError>;
}

/// Chooses the inspector implementation that matches the connection settings.
pub fn create_inspector(
    settings: ConnectionSettings,
) -> Result<Box<dyn DatabaseInspector>, InspectorError> {
    match settings {
        ConnectionSettings::SqlServer(sql_server_settings) => Ok(Box::new(
            sqlserver::SqlServerInspector::new(sql_server_settings)?,
        )),
    }
}
