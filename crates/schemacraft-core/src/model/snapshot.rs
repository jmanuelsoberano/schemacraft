use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    AccessProfile, CarriedFact, DatabaseProvider, DependencySnapshot, ForeignKey,
    ForeignKeyToInvisibleTable, PostgresqlMetadata, Programmability, QualifiedName, Table,
    UnknownFields, View,
};

/// Point-in-time picture of a database schema as extracted by an inspector.
///
/// Foreign keys live at the snapshot level rather than inside tables because they are the
/// edges of the diagram graph and are diffed as independent objects.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct SchemaSnapshot {
    /// Database engine; files written before multi-engine support contain SQL Server facts.
    #[serde(default)]
    #[ts(as = "Option<DatabaseProvider>", optional)]
    pub provider: DatabaseProvider,
    /// Native PostgreSQL semantics that must not be approximated as SQL Server metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub postgresql: Option<PostgresqlMetadata>,
    /// Database (catalog) name the snapshot was taken from.
    pub database_name: String,
    /// Server product and version string, when the inspector reports it.
    pub server_version: Option<String>,
    /// Moment the extraction finished, in UTC.
    pub extracted_at: DateTime<Utc>,
    /// What the login that made the extraction could see; `None` when it was not recorded,
    /// as in files written by SchemaCraft 1.0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub access: Option<AccessProfile>,
    /// Base tables.
    pub tables: Vec<Table>,
    /// Views.
    pub views: Vec<View>,
    /// Foreign keys between tables.
    pub foreign_keys: Vec<ForeignKey>,
    /// Foreign keys from a table of the snapshot to a table the login cannot see. They are
    /// kept apart because their referenced side is unknown.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub foreign_keys_to_invisible_tables: Vec<ForeignKeyToInvisibleTable>,
    /// Facts kept from an earlier snapshot because this extraction could not check them, with
    /// the moment each was last read. See [`SchemaSnapshot::with_unchecked_facts_from`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub carried_over: Vec<CarriedFact>,
    /// Procedures, functions, DML triggers and the code of views; `None` when the extraction
    /// did not record them, as in every file written before 1.2, which says nothing about
    /// whether the database has any. Code lives here and never inside a table or view, so an
    /// export, which rebuilds the snapshot from the keys it knows, cannot carry it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub programmability: Option<Programmability>,
    /// Independently observed catalog references; absent in captures made before this family.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub dependencies: Option<DependencySnapshot>,
    /// Keys written by a newer version, kept as they are.
    #[serde(flatten)]
    #[ts(skip)]
    pub unknown: UnknownFields,
}

impl SchemaSnapshot {
    /// Looks up a table by qualified name.
    pub fn table(&self, name: &QualifiedName) -> Option<&Table> {
        self.tables.iter().find(|table| &table.name == name)
    }

    /// Distinct schema names across tables and views, sorted.
    pub fn schema_names(&self) -> BTreeSet<&str> {
        self.tables
            .iter()
            .map(|table| table.name.schema.as_str())
            .chain(self.views.iter().map(|view| view.name.schema.as_str()))
            .collect()
    }

    /// Foreign keys whose referencing (child) side is `table`.
    pub fn foreign_keys_from<'a>(
        &'a self,
        table: &'a QualifiedName,
    ) -> impl Iterator<Item = &'a ForeignKey> + 'a {
        self.foreign_keys
            .iter()
            .filter(move |key| &key.referencing_table == table)
    }

    /// Foreign keys whose referenced (parent) side is `table`.
    pub fn foreign_keys_to<'a>(
        &'a self,
        table: &'a QualifiedName,
    ) -> impl Iterator<Item = &'a ForeignKey> + 'a {
        self.foreign_keys
            .iter()
            .filter(move |key| &key.referenced_table == table)
    }

    /// Whether `column_name` of `table` takes part in any outgoing foreign key, including one
    /// to a table the login cannot see.
    pub fn is_foreign_key_column(&self, table: &QualifiedName, column_name: &str) -> bool {
        self.foreign_keys_from(table)
            .any(|key| key.references_from_column(column_name))
            || self
                .foreign_keys_to_invisible_tables
                .iter()
                .filter(|key| &key.referencing_table == table)
                .any(|key| key.columns.iter().any(|column| column == column_name))
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )]

    use super::SchemaSnapshot;
    use crate::model::test_fixtures::{reader_snapshot, sample_snapshot};
    use crate::model::{CarriedFact, QualifiedName, SnapshotFact};

    #[test]
    fn survives_a_json_round_trip() {
        let snapshot = sample_snapshot();
        let json = serde_json::to_string_pretty(&snapshot).expect("snapshot serialises");
        let restored: SchemaSnapshot = serde_json::from_str(&json).expect("snapshot deserialises");
        assert_eq!(restored, snapshot);
    }

    #[test]
    fn keeps_access_facts_and_unknown_keys_through_a_round_trip() {
        let mut snapshot = reader_snapshot();
        snapshot.carried_over.push(CarriedFact {
            object: QualifiedName::new("dbo", "Customers"),
            fact: SnapshotFact::Table,
            read_at: sample_snapshot().extracted_at,
        });
        snapshot.unknown.insert(
            "lineage".to_string(),
            serde_json::json!({ "capturedBy": "a newer version", "steps": [1, 2.5, null] }),
        );

        let json = serde_json::to_value(&snapshot).expect("snapshot serialises");
        assert_eq!(json["access"]["level"], "partial");
        assert_eq!(
            json["foreignKeysToInvisibleTables"][0]["name"],
            "FK_Orders_Customers"
        );
        assert_eq!(json["carriedOver"][0]["fact"]["kind"], "table");
        assert_eq!(json["lineage"]["steps"][1], 2.5);
        assert!(json.get("unknown").is_none());

        let restored: SchemaSnapshot = serde_json::from_value(json).expect("snapshot deserialises");
        assert_eq!(restored, snapshot);
    }

    #[test]
    fn serializes_with_camel_case_keys() {
        let json = serde_json::to_value(sample_snapshot()).expect("snapshot serialises");
        assert!(json.get("extractedAt").is_some());
        assert!(json.get("foreignKeys").is_some());
        let first_column = &json["tables"][0]["columns"][0];
        assert!(first_column.get("ordinalPosition").is_some());
        assert!(first_column.get("isNullable").is_some());
        // Empty lists of the access facts are left out, so 1.0 readers see a familiar shape.
        assert!(json.get("foreignKeysToInvisibleTables").is_none());
        assert!(json.get("carriedOver").is_none());
    }

    #[test]
    fn older_snapshots_have_no_access_profile() {
        let mut json = serde_json::to_value(sample_snapshot()).expect("snapshot serialises");
        let object = json.as_object_mut().expect("an object");
        object.remove("access");

        let restored: SchemaSnapshot = serde_json::from_value(json).expect("snapshot deserialises");
        assert_eq!(restored.access, None);
        assert_eq!(restored.foreign_keys_to_invisible_tables, []);
        assert_eq!(restored.carried_over, []);
        assert!(restored.unknown.is_empty());
    }

    #[test]
    fn lists_distinct_schema_names_sorted() {
        let snapshot = sample_snapshot();
        let schema_names: Vec<&str> = snapshot.schema_names().into_iter().collect();
        assert_eq!(schema_names, ["dbo", "sales"]);
    }

    #[test]
    fn navigates_foreign_keys_in_both_directions() {
        let snapshot = sample_snapshot();
        let orders = QualifiedName::new("sales", "Orders");
        let customers = QualifiedName::new("dbo", "Customers");

        let outgoing: Vec<&str> = snapshot
            .foreign_keys_from(&orders)
            .map(|key| key.name.as_str())
            .collect();
        let incoming: Vec<&str> = snapshot
            .foreign_keys_to(&customers)
            .map(|key| key.name.as_str())
            .collect();

        assert_eq!(outgoing, ["FK_Orders_Customers"]);
        assert_eq!(incoming, ["FK_Orders_Customers"]);
        assert!(snapshot.is_foreign_key_column(&orders, "CustomerId"));
        assert!(!snapshot.is_foreign_key_column(&orders, "OrderId"));

        let reader = reader_snapshot();
        assert_eq!(reader.foreign_keys_from(&orders).count(), 0);
        assert!(reader.is_foreign_key_column(&orders, "CustomerId"));
        assert!(!reader.is_foreign_key_column(&orders, "OrderId"));
    }

    #[test]
    fn identifies_primary_key_columns() {
        let snapshot = sample_snapshot();
        let orders = snapshot
            .table(&QualifiedName::new("sales", "Orders"))
            .expect("table exists");
        assert!(orders.is_primary_key_column("OrderId"));
        assert!(!orders.is_primary_key_column("CustomerId"));

        let total_type = orders
            .column("Total")
            .map(|column| column.data_type.declaration());
        assert_eq!(total_type.as_deref(), Some("DECIMAL(18,2)"));
    }
}
