use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::ChangeKind;
use super::pairing::{Pairing, pair_by_key};
use crate::model::{ForeignKey, QualifiedName};

/// Change of a foreign key. Keys are matched by referencing table and constraint name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum ForeignKeyChange {
    /// A new foreign key.
    Added {
        /// The key as it is now.
        key: ForeignKey,
    },
    /// A dropped foreign key.
    Removed {
        /// The key as it was.
        key: ForeignKey,
    },
    /// A foreign key whose definition differs.
    Changed {
        /// The key as it was.
        before: ForeignKey,
        /// The key as it is now.
        after: ForeignKey,
        /// Which parts of the definition differ.
        properties: Vec<ForeignKeyProperty>,
    },
}

impl ForeignKeyChange {
    /// Constraint name.
    pub fn name(&self) -> &str {
        match self {
            Self::Added { key } | Self::Removed { key } => &key.name,
            Self::Changed { after, .. } => &after.name,
        }
    }

    /// Table that holds the key.
    pub fn referencing_table(&self) -> &QualifiedName {
        match self {
            Self::Added { key } | Self::Removed { key } => &key.referencing_table,
            Self::Changed { after, .. } => &after.referencing_table,
        }
    }

    /// Whether the key appeared, disappeared or changed.
    pub fn kind(&self) -> ChangeKind {
        match self {
            Self::Added { .. } => ChangeKind::Added,
            Self::Removed { .. } => ChangeKind::Removed,
            Self::Changed { .. } => ChangeKind::Changed,
        }
    }
}

/// Part of a foreign key definition that can change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum ForeignKeyProperty {
    /// The table the key points to.
    ReferencedTable,
    /// The column pairings.
    Columns,
    /// The `ON DELETE` action.
    OnDelete,
    /// The `ON UPDATE` action.
    OnUpdate,
    /// Whether the constraint is enabled.
    Enabled,
}

pub(super) fn diff_foreign_keys(
    previous: &[ForeignKey],
    current: &[ForeignKey],
) -> Vec<ForeignKeyChange> {
    pair_by_key(previous, current, |key| {
        (&key.referencing_table, key.name.as_str())
    })
    .into_iter()
    .filter_map(|pairing| match pairing {
        Pairing::Added(key) => Some(ForeignKeyChange::Added { key: key.clone() }),
        Pairing::Removed(key) => Some(ForeignKeyChange::Removed { key: key.clone() }),
        Pairing::Both { previous, current } => {
            let properties = properties_that_differ(previous, current);
            (!properties.is_empty()).then(|| ForeignKeyChange::Changed {
                before: previous.clone(),
                after: current.clone(),
                properties,
            })
        }
    })
    .collect()
}

fn properties_that_differ(before: &ForeignKey, after: &ForeignKey) -> Vec<ForeignKeyProperty> {
    let candidates = [
        (
            ForeignKeyProperty::ReferencedTable,
            before.referenced_table != after.referenced_table,
        ),
        (
            ForeignKeyProperty::Columns,
            before.column_pairs != after.column_pairs,
        ),
        (
            ForeignKeyProperty::OnDelete,
            before.on_delete != after.on_delete,
        ),
        (
            ForeignKeyProperty::OnUpdate,
            before.on_update != after.on_update,
        ),
        (
            ForeignKeyProperty::Enabled,
            before.is_enabled != after.is_enabled,
        ),
    ];
    candidates
        .into_iter()
        .filter_map(|(property, differs)| differs.then_some(property))
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

    use super::{ForeignKeyChange, ForeignKeyProperty, diff_foreign_keys};
    use crate::diff::ChangeKind;
    use crate::model::test_fixtures::sample_snapshot;
    use crate::model::{ForeignKey, QualifiedName, ReferentialAction};

    fn orders_to_customers() -> ForeignKey {
        sample_snapshot().foreign_keys.remove(0)
    }

    #[test]
    fn reports_definition_changes_of_a_key_with_the_same_identity() {
        let previous = orders_to_customers();
        let mut current = orders_to_customers();
        current.on_delete = ReferentialAction::Cascade;
        current.is_enabled = false;

        let changes = diff_foreign_keys(&[previous], &[current]);
        let [
            ForeignKeyChange::Changed {
                before,
                after,
                properties,
            },
        ] = changes.as_slice()
        else {
            panic!("expected one changed key, got {changes:?}");
        };
        assert_eq!(before.on_delete, ReferentialAction::NoAction);
        assert_eq!(after.on_delete, ReferentialAction::Cascade);
        assert_eq!(
            properties,
            &[ForeignKeyProperty::OnDelete, ForeignKeyProperty::Enabled]
        );
        assert_eq!(changes[0].kind(), ChangeKind::Changed);
        assert_eq!(changes[0].name(), "FK_Orders_Customers");
        assert_eq!(changes[0].referencing_table().to_string(), "sales.Orders");
    }

    #[test]
    fn a_key_moved_to_another_table_is_a_removal_plus_an_addition() {
        let previous = orders_to_customers();
        let mut current = orders_to_customers();
        current.referencing_table = QualifiedName::new("sales", "Invoices");

        let changes = diff_foreign_keys(&[previous], &[current]);
        let kinds: Vec<ChangeKind> = changes.iter().map(ForeignKeyChange::kind).collect();
        assert_eq!(kinds, [ChangeKind::Added, ChangeKind::Removed]);
        assert_eq!(changes[0].referencing_table().to_string(), "sales.Invoices");
        assert_eq!(changes[1].referencing_table().to_string(), "sales.Orders");
    }

    #[test]
    fn identical_keys_produce_nothing() {
        assert!(diff_foreign_keys(&[orders_to_customers()], &[orders_to_customers()]).is_empty());
    }
}
