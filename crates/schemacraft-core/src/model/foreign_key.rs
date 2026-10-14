use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::QualifiedName;

/// Action applied to referencing rows when the referenced key is deleted or updated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum ReferentialAction {
    /// Reject the change while referencing rows exist.
    NoAction,
    /// Propagate the delete or update to referencing rows.
    Cascade,
    /// Set the referencing columns to `NULL`.
    SetNull,
    /// Set the referencing columns to their default values.
    SetDefault,
}

/// One column pairing of a foreign key; composite keys have several.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct ForeignKeyColumnPair {
    /// Column in the referencing (child) table.
    pub referencing_column: String,
    /// Column in the referenced (parent) table.
    pub referenced_column: String,
}

/// Foreign key constraint linking a referencing (child) table to a referenced (parent) table.
///
/// Foreign keys are the edges of the diagram graph, which is why they carry both endpoints
/// instead of living inside a table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct ForeignKey {
    /// Constraint name, e.g. `FK_Orders_Customers`.
    pub name: String,
    /// Table that holds the foreign key columns.
    pub referencing_table: QualifiedName,
    /// Table whose key is referenced.
    pub referenced_table: QualifiedName,
    /// Column pairings in key order.
    pub column_pairs: Vec<ForeignKeyColumnPair>,
    /// Action on delete of the referenced row.
    pub on_delete: ReferentialAction,
    /// Action on update of the referenced key.
    pub on_update: ReferentialAction,
    /// `false` when the constraint exists but is disabled (`NOCHECK`) in the database.
    pub is_enabled: bool,
}

impl ForeignKey {
    /// Whether the key points back to its own table, e.g. `Employees.ManagerId`.
    pub fn is_self_referencing(&self) -> bool {
        self.referencing_table == self.referenced_table
    }

    /// Whether `column_name` of the referencing table takes part in this key.
    pub fn references_from_column(&self, column_name: &str) -> bool {
        self.column_pairs
            .iter()
            .any(|pair| pair.referencing_column == column_name)
    }
}
