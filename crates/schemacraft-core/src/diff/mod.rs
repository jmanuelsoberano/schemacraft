//! Comparison of two schema snapshots.
//!
//! Objects are matched by name: schema-qualified for tables and views, qualified by the
//! referencing table for foreign keys, plain for columns, indexes and constraints. A renamed
//! object is therefore reported as a removal plus an addition, which keeps the result
//! deterministic and free of guesses. Column order is not compared: reordering columns changes
//! nothing in a diagram. Every list is sorted by name, so the same two snapshots always produce
//! the same diff.

mod entities;
mod foreign_keys;
mod pairing;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use entities::{
    CheckConstraintChange, ColumnChange, ColumnProperty, IndexChange, PrimaryKeyChange,
    TableChange, ViewChange,
};
pub use foreign_keys::{ForeignKeyChange, ForeignKeyProperty};

use crate::model::SchemaSnapshot;

/// Everything that differs between two snapshots.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct SchemaDiff {
    /// Tables that appeared, disappeared or changed, by name.
    pub tables: Vec<TableChange>,
    /// Views that appeared, disappeared or changed, by name.
    pub views: Vec<ViewChange>,
    /// Foreign keys that appeared, disappeared or changed, by referencing table and name.
    pub foreign_keys: Vec<ForeignKeyChange>,
    /// Counts per object kind, for the review dialog header.
    pub summary: DiffSummary,
}

impl SchemaDiff {
    /// Compares `previous` (the saved snapshot) with `current` (the fresh one).
    pub fn between(previous: &SchemaSnapshot, current: &SchemaSnapshot) -> Self {
        let tables = entities::diff_tables(&previous.tables, &current.tables);
        let views = entities::diff_views(&previous.views, &current.views);
        let foreign_keys =
            foreign_keys::diff_foreign_keys(&previous.foreign_keys, &current.foreign_keys);
        let summary = DiffSummary {
            tables: ChangeCounts::of(tables.iter().map(TableChange::kind)),
            views: ChangeCounts::of(views.iter().map(ViewChange::kind)),
            foreign_keys: ChangeCounts::of(foreign_keys.iter().map(ForeignKeyChange::kind)),
        };
        Self {
            tables,
            views,
            foreign_keys,
            summary,
        }
    }

    /// Whether the snapshots describe the same schema.
    pub fn is_empty(&self) -> bool {
        self.tables.is_empty() && self.views.is_empty() && self.foreign_keys.is_empty()
    }
}

/// Whether an object appeared, disappeared or changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum ChangeKind {
    /// Present only in the current snapshot.
    Added,
    /// Present only in the previous snapshot.
    Removed,
    /// Present in both with differences.
    Changed,
}

/// Number of changes of each kind for one object type.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct ChangeCounts {
    /// Objects that appeared.
    pub added: usize,
    /// Objects that disappeared.
    pub removed: usize,
    /// Objects that changed.
    pub changed: usize,
}

impl ChangeCounts {
    fn of(kinds: impl Iterator<Item = ChangeKind>) -> Self {
        kinds.fold(Self::default(), |mut counts, kind| {
            match kind {
                ChangeKind::Added => counts.added += 1,
                ChangeKind::Removed => counts.removed += 1,
                ChangeKind::Changed => counts.changed += 1,
            }
            counts
        })
    }

    /// Changes of any kind.
    pub fn total(&self) -> usize {
        self.added + self.removed + self.changed
    }
}

/// Counts per object type.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct DiffSummary {
    /// Table changes.
    pub tables: ChangeCounts,
    /// View changes.
    pub views: ChangeCounts,
    /// Foreign key changes.
    pub foreign_keys: ChangeCounts,
}

impl DiffSummary {
    /// Changes of any kind across all object types.
    pub fn total(&self) -> usize {
        self.tables.total() + self.views.total() + self.foreign_keys.total()
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

    use super::{ChangeKind, SchemaDiff, TableChange};
    use crate::model::test_fixtures::sample_snapshot;
    use crate::model::{Column, QualifiedName, SqlDataType, Table};

    fn table(schema: &str, name: &str, columns: Vec<Column>) -> Table {
        Table {
            name: QualifiedName::new(schema, name),
            columns,
            primary_key: None,
            indexes: vec![],
            check_constraints: vec![],
        }
    }

    fn column(name: &str, ordinal_position: u32) -> Column {
        Column {
            name: name.to_string(),
            ordinal_position,
            data_type: SqlDataType::plain("int"),
            is_nullable: false,
            default_expression: None,
            is_identity: false,
            is_computed: false,
        }
    }

    #[test]
    fn identical_snapshots_produce_an_empty_diff() {
        let diff = SchemaDiff::between(&sample_snapshot(), &sample_snapshot());
        assert!(diff.is_empty());
        assert_eq!(diff.summary.total(), 0);
    }

    #[test]
    fn counts_every_kind_of_change_and_sorts_by_name() {
        let previous = sample_snapshot();
        let mut current = sample_snapshot();
        current
            .tables
            .push(table("dbo", "Audit", vec![column("Id", 1)]));
        current.tables.push(table("archive", "Old", vec![]));
        current
            .tables
            .retain(|table| table.name != QualifiedName::new("dbo", "Customers"));
        current.tables[0].columns.push(column("Extra", 99));
        current.foreign_keys.clear();
        current.views.clear();

        let diff = SchemaDiff::between(&previous, &current);

        let table_names: Vec<String> = diff
            .tables
            .iter()
            .map(|change| change.name().to_string())
            .collect();
        assert_eq!(
            table_names,
            ["archive.Old", "dbo.Audit", "dbo.Customers", "sales.Orders"]
        );
        let kinds: Vec<ChangeKind> = diff.tables.iter().map(TableChange::kind).collect();
        assert_eq!(
            kinds,
            [
                ChangeKind::Added,
                ChangeKind::Added,
                ChangeKind::Removed,
                ChangeKind::Changed
            ]
        );
        assert_eq!(diff.summary.tables.added, 2);
        assert_eq!(diff.summary.tables.removed, 1);
        assert_eq!(diff.summary.tables.changed, 1);
        assert_eq!(diff.summary.views.removed, 1);
        assert_eq!(diff.summary.foreign_keys.removed, 1);
        assert_eq!(diff.summary.total(), 6);
        assert!(!diff.is_empty());
    }

    #[test]
    fn serialises_with_tagged_changes() {
        let previous = sample_snapshot();
        let mut current = sample_snapshot();
        current
            .tables
            .push(table("dbo", "Audit", vec![column("Id", 1)]));

        let json = serde_json::to_value(SchemaDiff::between(&previous, &current)).unwrap();
        assert_eq!(json["tables"][0]["kind"], "added");
        assert_eq!(json["tables"][0]["name"]["name"], "Audit");
        assert_eq!(json["tables"][0]["columnCount"], 1);
        assert_eq!(json["summary"]["tables"]["added"], 1);
        assert_eq!(json["summary"]["foreignKeys"]["changed"], 0);
    }
}
