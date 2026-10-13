use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::ChangeKind;
use super::pairing::{Pairing, pair_by_key};
use crate::model::{CheckConstraint, Column, Index, PrimaryKey, QualifiedName, Table, View};

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
    /// Default expression.
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
    /// A constraint with the same name and a different expression.
    Changed {
        /// The constraint as it was.
        before: CheckConstraint,
        /// The constraint as it is now.
        after: CheckConstraint,
    },
}

pub(super) fn diff_tables(previous: &[Table], current: &[Table]) -> Vec<TableChange> {
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
            Pairing::Both { previous, current } => table_changes(previous, current),
        })
        .collect()
}

fn table_changes(previous: &Table, current: &Table) -> Option<TableChange> {
    let columns = diff_columns(&previous.columns, &current.columns);
    let primary_key = (previous.primary_key != current.primary_key).then(|| PrimaryKeyChange {
        before: previous.primary_key.clone(),
        after: current.primary_key.clone(),
    });
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

pub(super) fn diff_views(previous: &[View], current: &[View]) -> Vec<ViewChange> {
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
                let columns = diff_columns(&previous.columns, &current.columns);
                (!columns.is_empty()).then(|| ViewChange::Changed {
                    name: current.name.clone(),
                    columns,
                })
            }
        })
        .collect()
}

fn diff_columns(previous: &[Column], current: &[Column]) -> Vec<ColumnChange> {
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
                let properties = column_properties_that_differ(previous, current);
                (!properties.is_empty()).then(|| ColumnChange::Changed {
                    before: previous.clone(),
                    after: current.clone(),
                    properties,
                })
            }
        })
        .collect()
}

fn column_properties_that_differ(before: &Column, after: &Column) -> Vec<ColumnProperty> {
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
            before.default_expression != after.default_expression,
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
                (previous != current).then(|| IndexChange::Changed {
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
            Pairing::Both { previous, current } => {
                (previous != current).then(|| CheckConstraintChange::Changed {
                    before: previous.clone(),
                    after: current.clone(),
                })
            }
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
        CheckConstraintChange, ColumnChange, ColumnProperty, IndexChange, TableChange, ViewChange,
        diff_tables, diff_views,
    };
    use crate::model::test_fixtures::sample_snapshot;
    use crate::model::{
        CheckConstraint, Column, Index, IndexKind, PrimaryKey, QualifiedName, SqlDataType, Table,
        TypeLength,
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

        let changes = diff_tables(std::slice::from_ref(&previous), &[current]);

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
            default_expression: Some("('USD')".to_string()),
            is_identity: false,
            is_computed: false,
        });

        let changes = diff_tables(&[previous], &[current]);
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
        });
        current.indexes[0].kind = IndexKind::UniqueIndex;
        current.indexes.push(Index {
            name: "IX_Orders_PlacedAt".to_string(),
            columns: vec!["PlacedAt".to_string()],
            kind: IndexKind::NonUnique,
            is_clustered: false,
        });
        current.check_constraints.push(CheckConstraint {
            name: "CK_Orders_Total".to_string(),
            expression: "([Total]>=(0))".to_string(),
        });

        let changes = diff_tables(&[previous], &[current]);
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
        assert!(columns.is_empty());
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
        assert!(diff_tables(&[orders()], &[orders()]).is_empty());
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

        let changes = diff_views(&previous, &current);
        let [ViewChange::Changed { name, columns }] = changes.as_slice() else {
            panic!("expected one changed view, got {changes:?}");
        };
        assert_eq!(name.to_string(), "sales.RecentOrders");
        assert!(matches!(&columns[0], ColumnChange::Added { column } if column.name == "Total"));

        let removed = diff_views(&previous, &[]);
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
