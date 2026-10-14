use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{CheckConstraint, Column, Index, PrimaryKey, QualifiedName};

/// A base table with its columns and constraints. Foreign keys live on the snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct Table {
    /// Stable identity of the table.
    pub name: QualifiedName,
    /// Columns in ordinal order.
    pub columns: Vec<Column>,
    /// Primary key, when the table has one.
    pub primary_key: Option<PrimaryKey>,
    /// Secondary indexes and unique constraints.
    pub indexes: Vec<Index>,
    /// `CHECK` constraints.
    pub check_constraints: Vec<CheckConstraint>,
}

impl Table {
    /// Looks up a column by name.
    pub fn column(&self, column_name: &str) -> Option<&Column> {
        self.columns
            .iter()
            .find(|column| column.name == column_name)
    }

    /// Whether `column_name` belongs to the primary key.
    pub fn is_primary_key_column(&self, column_name: &str) -> bool {
        self.primary_key
            .as_ref()
            .is_some_and(|key| key.columns.iter().any(|name| name == column_name))
    }
}
