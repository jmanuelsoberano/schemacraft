use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::ChangeKind;
use super::pairing::{Pairing, pair_by_key};
use super::visibility::Baseline;
use crate::model::{
    CheckConstraint, Column, Definition, Index, PrimaryKey, QualifiedName, Table, View,
};

/// Change of a table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum TableChange {
    /// A table that only exists in the current snapshot.
    #[serde(rename_all = "camelCase")]
    Added {
        /// Table name.
        name: QualifiedName,
        /// Number of columns, for the summary line.
        column_count: usize,
    },
    /// A table that only exists in the previous snapshot.
    #[serde(rename_all = "camelCase")]
    Removed {
        /// Table name.
        name: QualifiedName,
        /// Number of columns it had.
        column_count: usize,
    },
    /// A table that exists in both snapshots with differences.
    #[serde(rename_all = "camelCase")]
    Changed {
        /// Table name.
        name: QualifiedName,
        /// Column changes, by column name.
        columns: Vec<ColumnChange>,
        /// Primary key change, when the key differs.
        primary_key: Option<PrimaryKeyChange>,
        /// Index changes, by index name.
        indexes: Vec<IndexChange>,
        /// Check constraint changes, by constraint name.
        check_constraints: Vec<CheckConstraintChange>,
    },
}

impl TableChange {
    /// Table the change refers to.
    pub fn name(&self) -> &QualifiedName {
        match self {
            Self::Added { name, .. } | Self::Removed { name, .. } | Self::Changed { name, .. } => {
                name
            }
        }
    }

    /// Whether the table appeared, disappeared or changed.
    pub fn kind(&self) -> ChangeKind {
        match self {
            Self::Added { .. } => ChangeKind::Added,
            Self::Removed { .. } => ChangeKind::Removed,
            Self::Changed { .. } => ChangeKind::Changed,
        }
    }
}

/// Change of a view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum ViewChange {
    /// A view that only exists in the current snapshot.
    #[serde(rename_all = "camelCase")]
    Added {
        /// View name.
        name: QualifiedName,
        /// Number of columns.
        column_count: usize,
    },
    /// A view that only exists in the previous snapshot.
    #[serde(rename_all = "camelCase")]
    Removed {
        /// View name.
        name: QualifiedName,
        /// Number of columns it had.
        column_count: usize,
    },
    /// A view whose columns differ.
    Changed {
        /// View name.
        name: QualifiedName,
        /// Column changes, by column name.
        columns: Vec<ColumnChange>,
    },
}

impl ViewChange {
    /// View the change refers to.
    pub fn name(&self) -> &QualifiedName {
        match self {
            Self::Added { name, .. } | Self::Removed { name, .. } | Self::Changed { name, .. } => {
                name
            }
        }
    }

    /// Whether the view appeared, disappeared or changed.
    pub fn kind(&self) -> ChangeKind {
        match self {
            Self::Added { .. } => ChangeKind::Added,
            Self::Removed { .. } => ChangeKind::Removed,
            Self::Changed { .. } => ChangeKind::Changed,
        }
    }
}

/// Change of a column within a table or view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum ColumnChange {
    /// A new column.
    Added {
        /// The column as it is now.
        column: Column,
    },
    /// A dropped column.
    Removed {
        /// The column as it was.
        column: Column,
    },
    /// A column whose definition differs; position changes are not reported.
    Changed {
        /// The column as it was.
        before: Column,
        /// The column as it is now.
        after: Column,
        /// Which parts of the definition differ.
        properties: Vec<ColumnProperty>,
    },
}

/// Part of a column definition that can change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum ColumnProperty {
    /// Data type, length, precision or scale.
    DataType,
    /// Whether `NULL` is accepted.
    Nullability,
    /// Default expression: added, dropped, or a readable text that changed. A text that could
    /// not be read on one side is not a change.
    DefaultExpression,
    /// Identity flag.
    Identity,
    /// Computed flag.
    Computed,
}

/// Primary key before and after; either side is `None` when the table had no key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct PrimaryKeyChange {
    /// Key in the previous snapshot.
    pub before: Option<PrimaryKey>,
    /// Key in the current snapshot.
    pub after: Option<PrimaryKey>,
}

/// Change of a secondary index or unique constraint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum IndexChange {
    /// A new index.
    Added {
        /// The index as it is now.
        index: Index,
    },
    /// A dropped index.
    Removed {
        /// The index as it was.
        index: Index,
    },
    /// An index with the same name and a different definition.
    Changed {
        /// The index as it was.
        before: Index,
        /// The index as it is now.
        after: Index,
    },
}

/// Change of a `CHECK` constraint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum CheckConstraintChange {
    /// A new constraint.
    Added {
        /// The constraint as it is now.
        constraint: CheckConstraint,
    },
    /// A dropped constraint.
    Removed {
        /// The constraint as it was.
        constraint: CheckConstraint,
    },
    /// A constraint with the same name and a different readable expression, or one that was
    /// enabled or disabled.
    Changed {
        /// The constraint as it was.
        before: CheckConstraint,
        /// The constraint as it is now.
        after: CheckConstraint,
    },
}

pub(super) fn diff_tables(
    previous: &[Table],
    current: &[Table],
    baseline: Baseline,
) -> Vec<TableChange> {
    pair_by_key(previous, current, |table| &table.name)
        .into_iter()
        .filter_map(|pairing| match pairing {
            Pairing::Added(table) => Some(TableChange::Added {
                name: table.name.clone(),
                column_count: table.columns.len(),
            }),
            Pairing::Removed(table) => Some(TableChange::Removed {
                name: table.name.clone(),
                column_count: table.columns.len(),
            }),
            Pairing::Both { previous, current } => table_changes(previous, current, baseline),
        })
        .collect()
}

fn table_changes(previous: &Table, current: &Table, baseline: Baseline) -> Option<TableChange> {
    let columns = diff_columns(&previous.columns, &current.columns, baseline);
    let primary_key =
        primary_key_changed(previous.primary_key.as_ref(), current.primary_key.as_ref()).then(
            || PrimaryKeyChange {
                before: previous.primary_key.clone(),
                after: current.primary_key.clone(),
            },
        );
    let indexes = diff_indexes(&previous.indexes, &current.indexes);
    let check_constraints =
        diff_check_constraints(&previous.check_constraints, &current.check_constraints);

    let unchanged = columns.is_empty()
        && primary_key.is_none()
        && indexes.is_empty()
        && check_constraints.is_empty();
    (!unchanged).then(|| TableChange::Changed {
        name: current.name.clone(),
        columns,
        primary_key,
        indexes,
        check_constraints,
    })
}

pub(super) fn diff_views(
    previous: &[View],
    current: &[View],
    baseline: Baseline,
) -> Vec<ViewChange> {
    pair_by_key(previous, current, |view| &view.name)
        .into_iter()
        .filter_map(|pairing| match pairing {
            Pairing::Added(view) => Some(ViewChange::Added {
                name: view.name.clone(),
                column_count: view.columns.len(),
            }),
            Pairing::Removed(view) => Some(ViewChange::Removed {
                name: view.name.clone(),
                column_count: view.columns.len(),
            }),
            Pairing::Both { previous, current } => {
                let columns = diff_columns(&previous.columns, &current.columns, baseline);
                (!columns.is_empty()).then(|| ViewChange::Changed {
                    name: current.name.clone(),
                    columns,
                })
            }
        })
        .collect()
}

fn diff_columns(previous: &[Column], current: &[Column], baseline: Baseline) -> Vec<ColumnChange> {
    pair_by_key(previous, current, |column| column.name.as_str())
        .into_iter()
        .filter_map(|pairing| match pairing {
            Pairing::Added(column) => Some(ColumnChange::Added {
                column: column.clone(),
            }),
            Pairing::Removed(column) => Some(ColumnChange::Removed {
                column: column.clone(),
            }),
            Pairing::Both { previous, current } => {
                let properties = column_properties_that_differ(previous, current, baseline);
                (!properties.is_empty()).then(|| ColumnChange::Changed {
                    before: previous.clone(),
                    after: current.clone(),
                    properties,
                })
            }
        })
        .collect()
}

fn column_properties_that_differ(
    before: &Column,
    after: &Column,
    baseline: Baseline,
) -> Vec<ColumnProperty> {
    let candidates = [
        (
            ColumnProperty::DataType,
            before.data_type != after.data_type,
        ),
        (
            ColumnProperty::Nullability,
            before.is_nullable != after.is_nullable,
        ),
        (
            ColumnProperty::DefaultExpression,
            default_changed(
                before.default_expression.as_ref(),
                after.default_expression.as_ref(),
                baseline,
            ),
        ),
        (
            ColumnProperty::Identity,
            before.is_identity != after.is_identity,
        ),
        (
            ColumnProperty::Computed,
            before.is_computed != after.is_computed,
        ),
    ];
    candidates
        .into_iter()
        .filter_map(|(property, differs)| differs.then_some(property))
        .collect()
}

/// Whether a column default changed. Two texts differ only when both are readable, and a
/// default that appeared or went away counts only when the side that has it knew its state: a
/// 1.0 file that did not record it says nothing about whether there was one. Nor does a 1.0
/// file that has no default at all, since it recorded neither bound defaults nor defaults whose
/// text the login could not read, so a default that appears next to it is no change.
fn default_changed(
    before: Option<&Definition>,
    after: Option<&Definition>,
    baseline: Baseline,
) -> bool {
    match (before, after) {
        (None, None) => false,
        (Some(before), Some(after)) => before.differs_from(after),
        (None, Some(_)) if baseline == Baseline::Unrecorded => false,
        (None, Some(known)) | (Some(known), None) => known.is_known(),
    }
}

/// Whether a `CHECK` constraint changed: its readable text, or its state when both sides
/// recorded it.
fn check_constraint_changed(before: &CheckConstraint, after: &CheckConstraint) -> bool {
    let state_changed = matches!(
        (before.is_enabled, after.is_enabled),
        (Some(was_enabled), Some(is_enabled)) if was_enabled != is_enabled
    );
    before.expression.differs_from(&after.expression) || state_changed
}

/// Whether a state both sides recorded differs. A state recorded on one side only, as when a
/// project saved before 1.2 is refreshed, is never a change.
fn recorded_state_differs<T: PartialEq>(before: Option<&T>, after: Option<&T>) -> bool {
    matches!((before, after), (Some(before), Some(after)) if before != after)
}

/// Whether the primary key appeared, disappeared or changed: its name, columns or clustering, or
/// its enabled state when both sides recorded it.
fn primary_key_changed(before: Option<&PrimaryKey>, after: Option<&PrimaryKey>) -> bool {
    match (before, after) {
        (None, None) => false,
        (Some(before), Some(after)) => {
            before.name != after.name
                || before.columns != after.columns
                || before.is_clustered != after.is_clustered
                || recorded_state_differs(before.is_enabled.as_ref(), after.is_enabled.as_ref())
        }
        (Some(_), None) | (None, Some(_)) => true,
    }
}

/// Whether an index changed: its key columns, kind or clustering, or its included columns,
/// filter flag or enabled state when both sides recorded them.
fn index_changed(before: &Index, after: &Index) -> bool {
    before.columns != after.columns
        || before.kind != after.kind
        || before.is_clustered != after.is_clustered
        || recorded_state_differs(
            before.included_columns.as_ref(),
            after.included_columns.as_ref(),
        )
        || recorded_state_differs(before.is_filtered.as_ref(), after.is_filtered.as_ref())
        || recorded_state_differs(before.is_enabled.as_ref(), after.is_enabled.as_ref())
}

fn diff_indexes(previous: &[Index], current: &[Index]) -> Vec<IndexChange> {
    pair_by_key(previous, current, |index| index.name.as_str())
        .into_iter()
        .filter_map(|pairing| match pairing {
            Pairing::Added(index) => Some(IndexChange::Added {
                index: index.clone(),
            }),
            Pairing::Removed(index) => Some(IndexChange::Removed {
                index: index.clone(),
            }),
            Pairing::Both { previous, current } => {
                index_changed(previous, current).then(|| IndexChange::Changed {
                    before: previous.clone(),
                    after: current.clone(),
                })
            }
        })
        .collect()
}

fn diff_check_constraints(
    previous: &[CheckConstraint],
    current: &[CheckConstraint],
) -> Vec<CheckConstraintChange> {
    pair_by_key(previous, current, |constraint| constraint.name.as_str())
        .into_iter()
        .filter_map(|pairing| match pairing {
            Pairing::Added(constraint) => Some(CheckConstraintChange::Added {
                constraint: constraint.clone(),
            }),
            Pairing::Removed(constraint) => Some(CheckConstraintChange::Removed {
                constraint: constraint.clone(),
            }),
            Pairing::Both { previous, current } => check_constraint_changed(previous, current)
                .then(|| CheckConstraintChange::Changed {
                    before: previous.clone(),
                    after: current.clone(),
                }),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::indexing_slicing,
        clippy::panic
    )]

    use super::{
        Baseline, CheckConstraintChange, ColumnChange, ColumnProperty, IndexChange, TableChange,
        ViewChange, diff_tables, diff_views,
    };
    use crate::model::test_fixtures::sample_snapshot;
    use crate::model::{
        CheckConstraint, Column, Definition, Index, IndexKind, PrimaryKey, QualifiedName,
        SqlDataType, Table, TypeLength,
    };

    fn orders() -> Table {
        sample_snapshot()
            .table(&QualifiedName::new("sales", "Orders"))
            .cloned()
            .expect("orders exists")
    }

    fn column_named<'a>(table: &'a Table, name: &str) -> &'a Column {
        table.column(name).expect("column exists")
    }

    #[test]
    fn reports_column_definition_changes_but_not_reordering() {
        let previous = orders();
        let mut current = orders();
        current.columns.reverse();
        for (position, column) in current.columns.iter_mut().enumerate() {
            column.ordinal_position = u32::try_from(position).unwrap_or(u32::MAX) + 1;
        }
        let total = current
            .columns
            .iter_mut()
            .find(|column| column.name == "Total")
            .expect("total column");
        total.data_type = SqlDataType::with_precision_and_scale("decimal", 19, 4);
        total.is_nullable = true;
        let placed_at = current
            .columns
            .iter_mut()
            .find(|column| column.name == "PlacedAt")
            .expect("placed at column");
        placed_at.default_expression = None;

        let changes = diff_tables(
            std::slice::from_ref(&previous),
            &[current],
            Baseline::Recorded,
        );

        let [TableChange::Changed { columns, .. }] = changes.as_slice() else {
            panic!("expected exactly one changed table, got {changes:?}");
        };
        assert_eq!(columns.len(), 2);
        let ColumnChange::Changed {
            before,
            after,
            properties,
        } = &columns[0]
        else {
            panic!("expected a changed column, got {:?}", columns[0]);
        };
        assert_eq!(before.name, "PlacedAt");
        assert_eq!(before, column_named(&previous, "PlacedAt"));
        assert!(after.default_expression.is_none());
        assert_eq!(properties, &[ColumnProperty::DefaultExpression]);
        let ColumnChange::Changed { properties, .. } = &columns[1] else {
            panic!("expected a changed column, got {:?}", columns[1]);
        };
        assert_eq!(
            properties,
            &[ColumnProperty::DataType, ColumnProperty::Nullability]
        );
    }

    #[test]
    fn reports_added_and_removed_columns() {
        let previous = orders();
        let mut current = orders();
        current.columns.retain(|column| column.name != "Total");
        current.columns.push(Column {
            name: "Currency".to_string(),
            ordinal_position: 5,
            data_type: SqlDataType::with_length("char", TypeLength::Fixed { value: 3 }),
            is_nullable: false,
            default_expression: Some(Definition::readable("('USD')")),
            is_identity: false,
            is_computed: false,
        });

        let changes = diff_tables(&[previous], &[current], Baseline::Recorded);
        let [TableChange::Changed { columns, .. }] = changes.as_slice() else {
            panic!("expected one changed table, got {changes:?}");
        };
        assert!(matches!(&columns[0], ColumnChange::Added { column } if column.name == "Currency"));
        assert!(matches!(&columns[1], ColumnChange::Removed { column } if column.name == "Total"));
    }

    #[test]
    fn reports_primary_key_index_and_constraint_changes() {
        let previous = orders();
        let mut current = orders();
        current.primary_key = Some(PrimaryKey {
            name: "PK_Orders".to_string(),
            columns: vec!["OrderId".to_string(), "CustomerId".to_string()],
            is_clustered: true,
            is_enabled: None,
        });
        current.indexes[0].kind = IndexKind::UniqueIndex;
        current.indexes.push(Index {
            name: "IX_Orders_PlacedAt".to_string(),
            columns: vec!["PlacedAt".to_string()],
            kind: IndexKind::NonUnique,
            is_clustered: false,
            included_columns: None,
            is_filtered: None,
            is_enabled: None,
        });
        current.check_constraints.push(CheckConstraint {
            name: "CK_Orders_Total".to_string(),
            expression: Definition::readable("([Total]>=(0))"),
            is_enabled: Some(true),
            is_trusted: None,
        });

        let changes = diff_tables(&[previous], &[current], Baseline::Recorded);
        let [
            TableChange::Changed {
                columns,
                primary_key,
                indexes,
                check_constraints,
                ..
            },
        ] = changes.as_slice()
        else {
            panic!("expected one changed table, got {changes:?}");
        };
        assert_eq!(columns.as_slice(), []);
        let key_change = primary_key.as_ref().expect("primary key changed");
        assert_eq!(key_change.before.as_ref().unwrap().columns.len(), 1);
        assert_eq!(key_change.after.as_ref().unwrap().columns.len(), 2);
        assert!(
            matches!(&indexes[0], IndexChange::Changed { after, .. } if after.kind == IndexKind::UniqueIndex)
        );
        assert!(
            matches!(&indexes[1], IndexChange::Added { index } if index.name == "IX_Orders_PlacedAt")
        );
        assert!(matches!(
            &check_constraints[0],
            CheckConstraintChange::Added { constraint } if constraint.name == "CK_Orders_Total"
        ));
    }

    #[test]
    fn unchanged_tables_produce_nothing() {
        assert_eq!(
            diff_tables(&[orders()], &[orders()], Baseline::Recorded),
            []
        );
    }

    /// Changed properties of `PlacedAt` when its default goes from `before` to `after`, next
    /// to a saved snapshot that recorded its access.
    fn default_change(
        before: Option<Definition>,
        after: Option<Definition>,
    ) -> Vec<ColumnProperty> {
        default_change_from(Baseline::Recorded, before, after)
    }

    /// Changed properties of `PlacedAt` when its default goes from `before`, in a saved snapshot
    /// with `baseline`, to `after`.
    fn default_change_from(
        baseline: Baseline,
        before: Option<Definition>,
        after: Option<Definition>,
    ) -> Vec<ColumnProperty> {
        let with_default = |default_expression: Option<Definition>| {
            let mut table = orders();
            table
                .columns
                .iter_mut()
                .find(|column| column.name == "PlacedAt")
                .expect("placed at column")
                .default_expression = default_expression;
            table
        };
        match diff_tables(&[with_default(before)], &[with_default(after)], baseline).as_slice() {
            [] => vec![],
            [TableChange::Changed { columns, .. }] => match columns.as_slice() {
                [ColumnChange::Changed { properties, .. }] => properties.clone(),
                other => panic!("expected one changed column, got {other:?}"),
            },
            other => panic!("expected at most one changed table, got {other:?}"),
        }
    }

    #[test]
    fn a_default_text_that_could_not_be_read_is_not_a_change() {
        let readable = || Some(Definition::readable("(sysutcdatetime())"));
        let changed = vec![ColumnProperty::DefaultExpression];

        assert_eq!(default_change(Some(Definition::NotVisible), readable()), []);
        assert_eq!(default_change(readable(), Some(Definition::NotVisible)), []);
        assert_eq!(
            default_change(Some(Definition::NotRecorded), readable()),
            []
        );
        assert_eq!(default_change(Some(Definition::NotRecorded), None), []);
        assert_eq!(default_change(None, Some(Definition::Unknown)), []);
        assert_eq!(
            default_change(readable(), Some(Definition::readable("(getdate())"))),
            changed
        );
        // A default that appeared or went away is a change even when its text is hidden.
        assert_eq!(default_change(None, Some(Definition::NotVisible)), changed);
        assert_eq!(default_change(Some(Definition::NotVisible), None), changed);
        assert_eq!(default_change(readable(), None), changed);
    }

    #[test]
    fn a_default_missing_from_a_1_0_file_is_not_a_change_when_it_appears() {
        let readable = || Some(Definition::readable("(sysutcdatetime())"));
        let unrecorded = |before, after| default_change_from(Baseline::Unrecorded, before, after);

        // 1.0 recorded no bound default and no default whose text it could not read.
        assert_eq!(unrecorded(None, readable()), []);
        assert_eq!(unrecorded(None, Some(Definition::NotVisible)), []);
        // What it did record still changes as usual.
        assert_eq!(
            unrecorded(readable(), None),
            [ColumnProperty::DefaultExpression]
        );
        assert_eq!(
            unrecorded(readable(), Some(Definition::readable("(getdate())"))),
            [ColumnProperty::DefaultExpression]
        );
    }

    #[test]
    fn a_check_changes_with_its_readable_text_or_its_recorded_state() {
        let customers = || {
            sample_snapshot()
                .table(&QualifiedName::new("dbo", "Customers"))
                .cloned()
                .expect("customers exists")
        };
        let with_check = |expression: Definition, is_enabled: Option<bool>| {
            let mut table = customers();
            table.check_constraints[0].expression = expression;
            table.check_constraints[0].is_enabled = is_enabled;
            table
        };
        let readable = || Definition::readable("(len([Name])>(0))");
        let changes = |before: Table, after: Table| {
            diff_tables(&[before], &[after], Baseline::Recorded).len()
        };

        assert_eq!(
            changes(
                with_check(Definition::NotRecorded, None),
                with_check(readable(), Some(true))
            ),
            0
        );
        assert_eq!(
            changes(
                with_check(readable(), Some(true)),
                with_check(Definition::NotVisible, Some(true))
            ),
            0
        );
        assert_eq!(
            changes(
                with_check(readable(), Some(true)),
                with_check(readable(), Some(false))
            ),
            1
        );
        assert_eq!(
            changes(
                with_check(readable(), Some(true)),
                with_check(Definition::readable("(len([Name])>(1))"), Some(true))
            ),
            1
        );
    }

    #[test]
    fn views_are_compared_by_columns() {
        let previous = sample_snapshot().views;
        let mut current = sample_snapshot().views;
        current[0].columns.push(Column {
            name: "Total".to_string(),
            ordinal_position: 3,
            data_type: SqlDataType::with_precision_and_scale("decimal", 18, 2),
            is_nullable: true,
            default_expression: None,
            is_identity: false,
            is_computed: false,
        });

        let changes = diff_views(&previous, &current, Baseline::Recorded);
        let [ViewChange::Changed { name, columns }] = changes.as_slice() else {
            panic!("expected one changed view, got {changes:?}");
        };
        assert_eq!(name.to_string(), "sales.RecentOrders");
        assert!(matches!(&columns[0], ColumnChange::Added { column } if column.name == "Total"));

        let removed = diff_views(&previous, &[], Baseline::Recorded);
        assert!(matches!(
            &removed[0],
            ViewChange::Removed {
                column_count: 2,
                ..
            }
        ));
        assert_eq!(removed[0].name().to_string(), "sales.RecentOrders");
    }
}
