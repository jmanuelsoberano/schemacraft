use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Definition;

/// Primary key constraint of a table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct PrimaryKey {
    /// Constraint name, e.g. `PK_Orders`.
    pub name: String,
    /// Key columns in key order.
    pub columns: Vec<String>,
    /// Whether the key is backed by the clustered index.
    pub is_clustered: bool,
    /// `false` when the index behind the key is disabled, so the key enforces nothing; `None`
    /// when the capture did not record the state, as before 1.2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_enabled: Option<bool>,
}

/// Classification of a secondary index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum IndexKind {
    /// Index created by a `UNIQUE` constraint.
    UniqueConstraint,
    /// Unique index created directly, without a constraint.
    UniqueIndex,
    /// Regular, non-unique index.
    NonUnique,
}

/// A secondary index or unique constraint. The primary key is modelled separately.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct Index {
    /// Index or constraint name.
    pub name: String,
    /// Key columns in key order.
    pub columns: Vec<String>,
    /// Whether the index enforces uniqueness and how it was created.
    pub kind: IndexKind,
    /// Whether this is the clustered index of the table.
    pub is_clustered: bool,
    /// Columns stored with the index without being part of its key (`INCLUDE`), in index order;
    /// `None` when the capture did not record them, as before 1.2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub included_columns: Option<Vec<String>>,
    /// Whether the index covers only the rows of a filter (`WHERE`), so a unique one enforces
    /// uniqueness among those rows only; `None` when the capture did not record it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_filtered: Option<bool>,
    /// `false` when the index is disabled, so it enforces nothing; `None` when the capture did
    /// not record the state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_enabled: Option<bool>,
}

impl Index {
    /// Whether the index enforces uniqueness, regardless of how it was created.
    pub fn is_unique(&self) -> bool {
        !matches!(self.kind, IndexKind::NonUnique)
    }
}

/// A `CHECK` constraint with its expression as stored by the database.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct CheckConstraint {
    /// Constraint name, e.g. `CK_Orders_Quantity`.
    pub name: String,
    /// Boolean expression, e.g. `([Quantity]>(0))`, or why its text is missing.
    pub expression: Definition,
    /// `false` when the constraint exists but is disabled (`NOCHECK`) in the database; `None`
    /// when the file that holds it did not record the state.
    #[serde(default)]
    pub is_enabled: Option<bool>,
    /// `false` when SQL Server has not verified that the rows already in the table follow the
    /// rule (`is_not_trusted`, after `WITH NOCHECK` or a re-enable without `WITH CHECK`); `None`
    /// when the capture did not record it, as before 1.2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_trusted: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::{Index, IndexKind};

    fn index_of_kind(kind: IndexKind) -> Index {
        Index {
            name: "IX_Test".to_string(),
            columns: vec!["Id".to_string()],
            kind,
            is_clustered: false,
            included_columns: None,
            is_filtered: None,
            is_enabled: None,
        }
    }

    #[test]
    fn unique_constraints_and_unique_indexes_are_unique() {
        assert!(index_of_kind(IndexKind::UniqueConstraint).is_unique());
        assert!(index_of_kind(IndexKind::UniqueIndex).is_unique());
        assert!(!index_of_kind(IndexKind::NonUnique).is_unique());
    }
}
