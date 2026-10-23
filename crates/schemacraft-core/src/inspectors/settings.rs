use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::InspectorError;
use super::postgresql::PostgreSqlConnectionSettings;
use super::sqlserver::SqlServerConnectionSettings;
use crate::credentials::{CredentialKey, CredentialStore};
use crate::model::{AccessProbe, AccessProfile, CaptureScope, SchemaAccess};

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
    /// PostgreSQL, using its native authentication and transport policy.
    PostgreSql(PostgreSqlConnectionSettings),
}

impl ConnectionSettings {
    /// Where a remembered password for this connection lives, when it uses a login.
    pub fn credential_key(&self) -> Option<CredentialKey> {
        match self {
            Self::SqlServer(settings) => settings.credential_key(),
            Self::PostgreSql(settings) => Some(settings.credential_key()),
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
            Self::PostgreSql(settings) => {
                Ok(Self::PostgreSql(settings.resolve_stored_password(store)?))
            }
        }
    }
}

/// What an inspection extracts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "inspectors/")]
// Independent catalog or capture flags retain their native meanings.
#[allow(clippy::struct_excessive_bools)]
pub struct InspectionOptions {
    /// Read catalog dependency references independently of storing module definitions.
    #[serde(default = "included_by_default")]
    #[ts(as = "Option<bool>", optional)]
    pub include_dependencies: bool,
    /// Schemas to include; empty means every user schema.
    #[serde(default)]
    pub schemas: Vec<String>,
    /// Whether views are extracted alongside tables.
    #[serde(default = "included_by_default")]
    pub include_views: bool,
    /// Whether procedures, functions and triggers are read. On unless the user turns it off, so
    /// a project saved before 1.2, which has no such option, reads them on its next refresh.
    #[serde(default = "included_by_default")]
    pub include_programmability: bool,
    /// Whether the code of views, procedures, functions and triggers is read and saved in the
    /// project; it only applies while `include_programmability` is on. On unless the user turns
    /// it off, like `include_programmability`.
    #[serde(default = "included_by_default")]
    pub include_module_definitions: bool,
}

fn included_by_default() -> bool {
    true
}

impl Default for InspectionOptions {
    fn default() -> Self {
        Self {
            include_dependencies: true,
            schemas: Vec::new(),
            include_views: included_by_default(),
            include_programmability: included_by_default(),
            include_module_definitions: included_by_default(),
        }
    }
}

impl InspectionOptions {
    /// Whether objects of `schema` belong in the snapshot.
    pub fn includes_schema(&self, schema: &str) -> bool {
        self.schemas.is_empty() || self.schemas.iter().any(|included| included == schema)
    }

    /// Whether the texts of the modules are read: they are asked for, and so are the objects
    /// they belong to.
    pub fn reads_module_definitions(&self) -> bool {
        self.include_programmability && self.include_module_definitions
    }
}

impl From<&InspectionOptions> for CaptureScope {
    /// The scope these options ask for, without code: whether code was read is known only once
    /// the capture tried, so the inspector sets the code flags itself
    /// ([`CaptureScope::include_programmability`]). A profile records what its capture read.
    fn from(options: &InspectionOptions) -> Self {
        Self {
            schemas: options.schemas.clone(),
            include_views: options.include_views,
            include_programmability: false,
            include_module_definitions: false,
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
    /// User schemas in which the login sees procedures or functions and no table or view, in
    /// name order, or empty when no table or view is visible anywhere. The schema picker offers
    /// them, as holding procedures and functions only, when those objects are to be read: a login
    /// that sees no table or view still sees nothing to read ([`AccessLevel::NothingVisible`]).
    ///
    /// [`AccessLevel::NothingVisible`]: crate::model::AccessLevel::NothingVisible
    pub programmability_only_schemas: Vec<String>,
    /// Access predicted for a capture of the whole database with the default options, code
    /// included.
    pub access: AccessProfile,
}

impl DatabaseDescription {
    /// Describes a database from the access facts of the login.
    pub fn from_probe(probe: AccessProbe) -> Self {
        let names = |keep: fn(&SchemaAccess) -> bool| -> Vec<String> {
            probe
                .schemas
                .iter()
                .filter(|schema| keep(schema))
                .map(|schema| schema.name.clone())
                .collect()
        };
        let schemas = names(|schema| schema.has_visible_objects);
        let programmability_only_schemas = if probe.sees_objects {
            names(|schema| schema.has_visible_programmability && !schema.has_visible_objects)
        } else {
            Vec::new()
        };
        Self {
            schemas,
            programmability_only_schemas,
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
    #![allow(clippy::expect_used)]
    use super::{DatabaseDescription, InspectionOptions};
    use crate::model::{AccessLevel, AccessProbe, CaptureScope, Completeness, SchemaAccess};

    #[test]
    fn a_description_offers_only_schemas_with_visible_objects() {
        let schema = |name: &str, has_visible_objects| SchemaAccess {
            name: name.to_string(),
            can_read_definitions: false,
            can_read_data: true,
            is_denied: false,
            has_visible_objects,
            has_visible_programmability: false,
            is_execute_denied: false,
        };
        let probe = AccessProbe {
            can_read_definitions: false,
            can_read_data: true,
            explicit_denials: Some(0),
            execute_denials: None,
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
        assert_eq!(
            description.programmability_only_schemas,
            Vec::<String>::new()
        );
        assert_eq!(description.access.level, AccessLevel::Partial);
        assert_eq!(
            description
                .access
                .probe
                .as_ref()
                .expect("SQL Server probe")
                .schemas
                .len(),
            3
        );
    }

    #[test]
    fn a_description_lists_apart_the_schemas_that_hold_only_code() {
        let schema = |name: &str, has_visible_objects, has_visible_programmability| SchemaAccess {
            name: name.to_string(),
            can_read_definitions: true,
            can_read_data: true,
            is_denied: false,
            has_visible_objects,
            has_visible_programmability,
            is_execute_denied: false,
        };
        let probe = AccessProbe {
            can_read_definitions: true,
            can_read_data: true,
            explicit_denials: Some(0),
            execute_denials: Some(0),
            sees_objects: true,
            schemas: vec![
                schema("app", true, true),
                schema("code_only", false, true),
                schema("empty", false, false),
            ],
            database_user: Some("dbo".to_string()),
        };

        let description = DatabaseDescription::from_probe(probe);

        assert_eq!(description.schemas, ["app"]);
        assert_eq!(description.programmability_only_schemas, ["code_only"]);
        // The prediction judges code, as a capture with the default options reads it.
        assert_eq!(
            description.access.coverage.programmability,
            Some(Completeness::Complete)
        );
        assert_eq!(
            description.access.coverage.module_definitions,
            Some(Completeness::Complete)
        );
        let json = serde_json::to_value(&description).unwrap_or_default();
        assert_eq!(
            json.get("programmabilityOnlySchemas")
                .and_then(|schemas| schemas.get(0))
                .and_then(serde_json::Value::as_str),
            Some("code_only")
        );
    }

    #[test]
    fn code_only_schemas_are_not_offered_without_a_visible_table_or_view() {
        let description = DatabaseDescription::from_probe(AccessProbe {
            can_read_definitions: false,
            can_read_data: false,
            explicit_denials: Some(0),
            execute_denials: Some(0),
            sees_objects: false,
            schemas: vec![SchemaAccess {
                name: "sales".to_string(),
                can_read_definitions: false,
                can_read_data: false,
                is_denied: false,
                has_visible_objects: false,
                has_visible_programmability: true,
                is_execute_denied: false,
            }],
            database_user: Some("executor".to_string()),
        });

        assert_eq!(description.schemas, Vec::<String>::new());
        assert_eq!(
            description.programmability_only_schemas,
            Vec::<String>::new()
        );
        assert_eq!(description.access.level, AccessLevel::NothingVisible);
        // The picker restriction does not discard the underlying visibility evidence.
        assert!(
            description
                .access
                .probe
                .as_ref()
                .expect("SQL Server probe")
                .schemas
                .iter()
                .any(|schema| schema.has_visible_programmability)
        );
        assert_eq!(
            description.access.coverage.programmability,
            Some(Completeness::Partial)
        );
    }

    #[test]
    fn empty_schema_filter_includes_everything() {
        let options = InspectionOptions::default();
        assert!(options.include_views);
        assert!(options.include_programmability);
        assert!(options.include_module_definitions);
        assert!(options.includes_schema("dbo"));
        assert!(options.includes_schema("sales"));
    }

    #[test]
    fn schema_filter_matches_exact_names() {
        let options = InspectionOptions {
            schemas: vec!["sales".to_string()],
            include_views: false,
            ..InspectionOptions::default()
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

    #[test]
    fn options_saved_before_1_2_read_and_save_code() {
        // The inspection options of a 1.1 project: no code options at all.
        let saved = r#"{ "schemas": ["sales"], "includeViews": false }"#;
        let options: InspectionOptions = serde_json::from_str(saved).unwrap_or_default();
        assert_eq!(options.schemas, ["sales"]);
        assert!(!options.include_views);
        assert!(options.include_programmability);
        assert!(options.include_module_definitions);

        let turned_off =
            r#"{ "includeProgrammability": false, "includeModuleDefinitions": false }"#;
        let options: InspectionOptions = serde_json::from_str(turned_off).unwrap_or_default();
        assert!(!options.include_programmability);
        assert!(!options.include_module_definitions);
        let written = serde_json::to_value(&options).unwrap_or_default();
        let off = Some(&serde_json::Value::Bool(false));
        assert_eq!(written.get("includeProgrammability"), off);
        assert_eq!(written.get("includeModuleDefinitions"), off);
    }

    #[test]
    fn module_texts_are_read_only_with_their_objects() {
        let options = InspectionOptions::default();
        assert!(options.reads_module_definitions());
        let objects_off = InspectionOptions {
            include_programmability: false,
            ..InspectionOptions::default()
        };
        assert!(!objects_off.reads_module_definitions());
        let texts_off = InspectionOptions {
            include_module_definitions: false,
            ..InspectionOptions::default()
        };
        assert!(!texts_off.reads_module_definitions());
    }

    #[test]
    fn a_capture_scope_never_claims_code_it_did_not_read() {
        let scope = CaptureScope::from(&InspectionOptions::default());
        assert_eq!(scope, CaptureScope::everything());
        assert!(!scope.include_programmability);
        assert!(!scope.include_module_definitions);
    }
}
