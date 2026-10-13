use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::sqlserver::SqlServerConnectionSettings;

/// Everything needed to reach a database, tagged by engine so the right inspector is chosen.
///
/// Settings deserialise from the frontend but are never serialised back: they may carry a
/// password, which must not leave the Rust side once received.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(tag = "provider", rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
pub enum ConnectionSettings {
    /// Microsoft SQL Server.
    SqlServer(SqlServerConnectionSettings),
}

/// What an inspection extracts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
pub struct InspectionOptions {
    /// Schemas to include; empty means every user schema.
    #[serde(default)]
    pub schemas: Vec<String>,
    /// Whether views are extracted alongside tables.
    #[serde(default = "default_include_views")]
    pub include_views: bool,
}

fn default_include_views() -> bool {
    true
}

impl Default for InspectionOptions {
    fn default() -> Self {
        Self {
            schemas: Vec::new(),
            include_views: default_include_views(),
        }
    }
}

impl InspectionOptions {
    /// Whether objects of `schema` belong in the snapshot.
    pub fn includes_schema(&self, schema: &str) -> bool {
        self.schemas.is_empty() || self.schemas.iter().any(|included| included == schema)
    }
}

/// Identity of the server behind a successful connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
pub struct ServerInformation {
    /// Product line as the server announces it, e.g. `Microsoft SQL Server 2022 (RTM) - 16.0.1000.6`.
    pub product: String,
    /// Numeric product version, e.g. `16.0.1000.6`.
    pub product_version: String,
    /// Edition, e.g. `Developer Edition (64-bit)`.
    pub edition: String,
    /// Name the server knows itself by.
    pub server_name: String,
    /// Database the session landed in.
    pub database_name: String,
}

#[cfg(test)]
mod tests {
    use super::InspectionOptions;

    #[test]
    fn empty_schema_filter_includes_everything() {
        let options = InspectionOptions::default();
        assert!(options.include_views);
        assert!(options.includes_schema("dbo"));
        assert!(options.includes_schema("sales"));
    }

    #[test]
    fn schema_filter_matches_exact_names() {
        let options = InspectionOptions {
            schemas: vec!["sales".to_string()],
            include_views: false,
        };
        assert!(options.includes_schema("sales"));
        assert!(!options.includes_schema("Sales"));
        assert!(!options.includes_schema("dbo"));
    }

    #[test]
    fn missing_fields_take_defaults_when_deserialising() {
        let options: InspectionOptions = serde_json::from_str("{}").unwrap_or_default();
        assert_eq!(options, InspectionOptions::default());
    }
}
