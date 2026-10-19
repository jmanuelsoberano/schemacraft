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
    /// `false` when SQL Server has not verified that the rows already in the referencing table
    /// follow the key (`is_not_trusted`, after `WITH NOCHECK` or a re-enable without
    /// `WITH CHECK`); `None` when the capture did not record it, as before 1.2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_trusted: Option<bool>,
}

/// Foreign key from a visible table to a table the login cannot see.
///
/// The server hides the name and the columns of the referenced table, so the key cannot be an
/// edge of the diagram. What it does reveal is kept, because a key that silently vanished would
/// say the relationship does not exist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct ForeignKeyToInvisibleTable {
    /// Constraint name, e.g. `FK_Orders_Regions`.
    pub name: String,
    /// Table that holds the foreign key columns.
    pub referencing_table: QualifiedName,
    /// Referencing columns in key order.
    pub columns: Vec<String>,
    /// Action on delete of the referenced row.
    pub on_delete: ReferentialAction,
    /// Action on update of the referenced key.
    pub on_update: ReferentialAction,
    /// `false` when the constraint exists but is disabled (`NOCHECK`) in the database.
    pub is_enabled: bool,
    /// `false` when SQL Server has not verified that the rows already in the referencing table
    /// follow the key (`is_not_trusted`, after `WITH NOCHECK` or a re-enable without
    /// `WITH CHECK`); `None` when the capture did not record it, as before 1.2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_trusted: Option<bool>,
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
