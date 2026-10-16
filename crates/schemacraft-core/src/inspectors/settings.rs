use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::InspectorError;
use super::sqlserver::SqlServerConnectionSettings;
use crate::credentials::{CredentialKey, CredentialStore};
use crate::model::{AccessProbe, AccessProfile, CaptureScope};

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

impl ConnectionSettings {
    /// Where a remembered password for this connection lives, when it uses a login.
    pub fn credential_key(&self) -> Option<CredentialKey> {
        match self {
            Self::SqlServer(settings) => settings.credential_key(),
        }
    }

    /// Replaces a remembered password with the value kept by `store`, so the settings can connect.
    pub fn resolve_stored_password(
        self,
        store: &dyn CredentialStore,
    ) -> Result<Self, InspectorError> {
        match self {
            Self::SqlServer(settings) => {
                Ok(Self::SqlServer(settings.resolve_stored_password(store)?))
            }
        }
    }
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

impl From<&InspectionOptions> for CaptureScope {
    /// The scope an access profile records for a capture made with these options.
    fn from(options: &InspectionOptions) -> Self {
        Self {
            schemas: options.schemas.clone(),
            include_views: options.include_views,
        }
    }
}

/// What the connection dialog learns about a database once it is selected, before anything is
/// read: the schemas to offer in the filter and what the login is predicted to see.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
pub struct DatabaseDescription {
    /// User schemas holding at least one table or view the login can see, in name order.
    pub schemas: Vec<String>,
    /// Access predicted for a capture of the whole database.
    pub access: AccessProfile,
}

impl DatabaseDescription {
    /// Describes a database from the access facts of the login.
    pub fn from_probe(probe: AccessProbe) -> Self {
        let schemas = probe
            .schemas
            .iter()
            .filter(|schema| schema.has_visible_objects)
            .map(|schema| schema.name.clone())
            .collect();
        Self {
            schemas,
            access: AccessProfile::predicted(probe),
        }
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
    use super::{DatabaseDescription, InspectionOptions};
    use crate::model::{AccessLevel, AccessProbe, SchemaAccess};

    #[test]
    fn a_description_offers_only_schemas_with_visible_objects() {
        let schema = |name: &str, has_visible_objects| SchemaAccess {
            name: name.to_string(),
            can_read_definitions: false,
            can_read_data: true,
            is_denied: false,
            has_visible_objects,
        };
        let probe = AccessProbe {
            can_read_definitions: false,
            can_read_data: true,
            explicit_denials: Some(0),
            sees_objects: true,
            schemas: vec![
                schema("dbo", true),
                schema("sales", true),
                schema("staging", false),
            ],
            database_user: Some("reporting".to_string()),
        };

        let description = DatabaseDescription::from_probe(probe);

        assert_eq!(description.schemas, ["dbo", "sales"]);
        assert_eq!(description.access.level, AccessLevel::Partial);
        assert_eq!(description.access.probe.schemas.len(), 3);
    }

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
