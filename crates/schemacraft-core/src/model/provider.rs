use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Engine that gives native types, rules and definitions their meaning.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum DatabaseProvider {
    /// Every capture made before the multi-engine format used SQL Server.
    #[default]
    SqlServer,
    /// PostgreSQL, with its own catalog semantics and routine identity.
    PostgreSql,
}
