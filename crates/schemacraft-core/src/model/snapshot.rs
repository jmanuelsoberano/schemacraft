use std::collections::BTreeSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{ForeignKey, QualifiedName, Table, View};

/// Point-in-time picture of a database schema as extracted by an inspector.
///
/// Foreign keys live at the snapshot level rather than inside tables because they are the
/// edges of the diagram graph and are diffed as independent objects.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct SchemaSnapshot {
    /// Database (catalog) name the snapshot was taken from.
    pub database_name: String,
    /// Server product and version string, when the inspector reports it.
    pub server_version: Option<String>,
    /// Moment the extraction finished, in UTC.
    pub extracted_at: DateTime<Utc>,
    /// Base tables.
    pub tables: Vec<Table>,
    /// Views.
    pub views: Vec<View>,
    /// Foreign keys between tables.
    pub foreign_keys: Vec<ForeignKey>,
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

    /// Whether `column_name` of `table` takes part in any outgoing foreign key.
    pub fn is_foreign_key_column(&self, table: &QualifiedName, column_name: &str) -> bool {
        self.foreign_keys_from(table)
            .any(|key| key.references_from_column(column_name))
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
    use crate::model::QualifiedName;
    use crate::model::test_fixtures::sample_snapshot;

    #[test]
    fn survives_a_json_round_trip() {
        let snapshot = sample_snapshot();
        let json = serde_json::to_string_pretty(&snapshot).expect("snapshot serialises");
        let restored: SchemaSnapshot = serde_json::from_str(&json).expect("snapshot deserialises");
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
