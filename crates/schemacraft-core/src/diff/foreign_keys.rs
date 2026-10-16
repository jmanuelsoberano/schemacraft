use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::ChangeKind;
use super::pairing::{Pairing, pair_by_key};
use super::visibility::Baseline;
use crate::model::{ForeignKey, ForeignKeyToInvisibleTable, QualifiedName, SchemaSnapshot};

/// Identity of a foreign key: its referencing table and its name.
pub(super) type KeyIdentity<'a> = (&'a QualifiedName, &'a str);

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

/// Change of a foreign key to a table the login cannot see. Only the referencing side of such a
/// key is known, so it is compared on that side alone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum ForeignKeyToInvisibleTableChange {
    /// A new key.
    Added {
        /// The key as it is now.
        key: ForeignKeyToInvisibleTable,
    },
    /// A dropped key.
    Removed {
        /// The key as it was.
        key: ForeignKeyToInvisibleTable,
    },
    /// A key whose referencing columns, actions or state differ.
    Changed {
        /// The key as it was.
        before: ForeignKeyToInvisibleTable,
        /// The key as it is now.
        after: ForeignKeyToInvisibleTable,
        /// Which parts of the definition differ; never the referenced table, which is unknown.
        properties: Vec<ForeignKeyProperty>,
    },
}

impl ForeignKeyToInvisibleTableChange {
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

/// Compares the keys between visible tables. A key in `became_visible` was listed before as a
/// key to an invisible table: it is not new, so it is not reported as added.
pub(super) fn diff_foreign_keys(
    previous: &[ForeignKey],
    current: &[ForeignKey],
    became_visible: &BTreeSet<KeyIdentity<'_>>,
) -> Vec<ForeignKeyChange> {
    pair_by_key(previous, current, |key| {
        (&key.referencing_table, key.name.as_str())
    })
    .into_iter()
    .filter_map(|pairing| match pairing {
        Pairing::Added(key) => (!became_visible.contains(&identity_of(key)))
            .then(|| ForeignKeyChange::Added { key: key.clone() }),
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

/// Compares the keys to invisible tables. A key in `became_visible` now has a visible target:
/// it is not gone, so it is not reported as removed. A key in `unrecorded_before` could not be
/// held by the previous snapshot: it is not new, so it is not reported as added.
pub(super) fn diff_foreign_keys_to_invisible_tables(
    previous: &[ForeignKeyToInvisibleTable],
    current: &[ForeignKeyToInvisibleTable],
    became_visible: &BTreeSet<KeyIdentity<'_>>,
    unrecorded_before: &BTreeSet<KeyIdentity<'_>>,
) -> Vec<ForeignKeyToInvisibleTableChange> {
    pair_by_key(previous, current, |key| {
        (&key.referencing_table, key.name.as_str())
    })
    .into_iter()
    .filter_map(|pairing| match pairing {
        Pairing::Added(key) => (!unrecorded_before.contains(&invisible_identity_of(key)))
            .then(|| ForeignKeyToInvisibleTableChange::Added { key: key.clone() }),
        Pairing::Removed(key) => (!became_visible.contains(&invisible_identity_of(key)))
            .then(|| ForeignKeyToInvisibleTableChange::Removed { key: key.clone() }),
        Pairing::Both { previous, current } => {
            let properties = referencing_side_differences(previous, current);
            (!properties.is_empty()).then(|| ForeignKeyToInvisibleTableChange::Changed {
                before: previous.clone(),
                after: current.clone(),
                properties,
            })
        }
    })
    .collect()
}

/// Keys listed in `previous` with an invisible target that `current` lists as ordinary keys
/// with the same referencing side: the login now sees the table they point to. A key whose
/// referencing side changed at the same time is left out, so the change is not hidden.
pub(super) fn keys_whose_target_became_visible<'a>(
    previous: &'a [ForeignKeyToInvisibleTable],
    current: &'a [ForeignKey],
) -> BTreeSet<KeyIdentity<'a>> {
    previous
        .iter()
        .filter(|invisible| {
            current.iter().any(|key| {
                identity_of(key) == invisible_identity_of(invisible)
                    && key
                        .column_pairs
                        .iter()
                        .map(|pair| &pair.referencing_column)
                        .eq(invisible.columns.iter())
                    && key.on_delete == invisible.on_delete
                    && key.on_update == invisible.on_update
                    && key.is_enabled == invisible.is_enabled
            })
        })
        .map(invisible_identity_of)
        .collect()
}

/// Keys of `current` to invisible tables that `previous` could not hold because it recorded no
/// access: SchemaCraft 1.0 dropped every key whose referenced table the login could not see, so
/// their absence from its files says nothing. A key the file does hold, as a key between
/// visible tables, is not among them: what became of it is a fact the file can state.
pub(super) fn keys_unrecorded_before<'a>(
    previous: &'a SchemaSnapshot,
    current: &'a [ForeignKeyToInvisibleTable],
) -> BTreeSet<KeyIdentity<'a>> {
    if Baseline::of(previous) == Baseline::Recorded {
        return BTreeSet::new();
    }
    let saved: BTreeSet<KeyIdentity<'a>> = previous
        .foreign_keys
        .iter()
        .map(identity_of)
        .chain(
            previous
                .foreign_keys_to_invisible_tables
                .iter()
                .map(invisible_identity_of),
        )
        .collect();
    current
        .iter()
        .map(invisible_identity_of)
        .filter(|identity| !saved.contains(identity))
        .collect()
}

fn identity_of(key: &ForeignKey) -> KeyIdentity<'_> {
    (&key.referencing_table, key.name.as_str())
}

fn invisible_identity_of(key: &ForeignKeyToInvisibleTable) -> KeyIdentity<'_> {
    (&key.referencing_table, key.name.as_str())
}

fn referencing_side_differences(
    before: &ForeignKeyToInvisibleTable,
    after: &ForeignKeyToInvisibleTable,
) -> Vec<ForeignKeyProperty> {
    let candidates = [
        (ForeignKeyProperty::Columns, before.columns != after.columns),
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

    use std::collections::BTreeSet;

    use super::{
        ForeignKeyChange, ForeignKeyProperty, ForeignKeyToInvisibleTableChange, KeyIdentity,
        diff_foreign_keys, diff_foreign_keys_to_invisible_tables, keys_unrecorded_before,
        keys_whose_target_became_visible,
    };
    use crate::diff::ChangeKind;
    use crate::model::test_fixtures::{reader_snapshot, sample_snapshot};
    use crate::model::{ForeignKey, ForeignKeyToInvisibleTable, QualifiedName, ReferentialAction};

    fn orders_to_customers() -> ForeignKey {
        sample_snapshot().foreign_keys.remove(0)
    }

    /// The same key as seen by a login that cannot see `dbo.Customers`.
    fn orders_to_invisible_customers() -> ForeignKeyToInvisibleTable {
        reader_snapshot().foreign_keys_to_invisible_tables.remove(0)
    }

    fn none<'a>() -> BTreeSet<KeyIdentity<'a>> {
        BTreeSet::new()
    }

    #[test]
    fn a_key_whose_target_became_visible_is_neither_added_nor_removed() {
        let previous = [orders_to_invisible_customers()];
        let current = [orders_to_customers()];

        let became_visible = keys_whose_target_became_visible(&previous, &current);

        assert_eq!(became_visible.len(), 1);
        assert_eq!(diff_foreign_keys(&[], &current, &became_visible), []);
        assert_eq!(
            diff_foreign_keys_to_invisible_tables(&previous, &[], &became_visible, &none()),
            []
        );
    }

    #[test]
    fn a_key_that_also_changed_while_its_target_became_visible_is_reported() {
        let previous = [ForeignKeyToInvisibleTable {
            on_delete: ReferentialAction::Cascade,
            ..orders_to_invisible_customers()
        }];
        let current = [orders_to_customers()];

        let became_visible = keys_whose_target_became_visible(&previous, &current);

        assert!(became_visible.is_empty());
        assert!(matches!(
            diff_foreign_keys(&[], &current, &became_visible).as_slice(),
            [ForeignKeyChange::Added { .. }]
        ));
        assert!(matches!(
            diff_foreign_keys_to_invisible_tables(&previous, &[], &became_visible, &none())
                .as_slice(),
            [ForeignKeyToInvisibleTableChange::Removed { .. }]
        ));
    }

    #[test]
    fn only_a_snapshot_without_access_could_not_hold_a_key_to_an_invisible_table() {
        let current = [orders_to_invisible_customers()];
        assert!(keys_unrecorded_before(&sample_snapshot(), &current).is_empty());

        let mut format_1 = sample_snapshot();
        format_1.access = None;
        // It holds the key between visible tables: what became of it is a fact it can state.
        assert!(keys_unrecorded_before(&format_1, &current).is_empty());

        format_1.foreign_keys.clear();
        let unrecorded = keys_unrecorded_before(&format_1, &current);
        assert_eq!(unrecorded.len(), 1);
        assert_eq!(
            diff_foreign_keys_to_invisible_tables(&[], &current, &none(), &unrecorded),
            []
        );
        assert!(matches!(
            diff_foreign_keys_to_invisible_tables(&[], &current, &none(), &none()).as_slice(),
            [ForeignKeyToInvisibleTableChange::Added { .. }]
        ));
    }

    #[test]
    fn keys_to_invisible_tables_are_compared_on_their_referencing_side() {
        let previous = orders_to_invisible_customers();
        let mut current = orders_to_invisible_customers();
        current.is_enabled = false;
        current.columns.push("RegionId".to_string());
        let added = ForeignKeyToInvisibleTable {
            name: "FK_Orders_Regions".to_string(),
            ..orders_to_invisible_customers()
        };

        let changes = diff_foreign_keys_to_invisible_tables(
            std::slice::from_ref(&previous),
            &[current, added],
            &none(),
            &none(),
        );

        let [
            ForeignKeyToInvisibleTableChange::Changed { properties, .. },
            ForeignKeyToInvisibleTableChange::Added { key },
        ] = changes.as_slice()
        else {
            panic!("expected a changed and an added key, got {changes:?}");
        };
        assert_eq!(
            properties,
            &[ForeignKeyProperty::Columns, ForeignKeyProperty::Enabled]
        );
        assert_eq!(key.name, "FK_Orders_Regions");
        assert_eq!(changes[0].kind(), ChangeKind::Changed);
        assert_eq!(changes[0].name(), "FK_Orders_Customers");
        assert_eq!(changes[1].referencing_table().to_string(), "sales.Orders");

        let removed = diff_foreign_keys_to_invisible_tables(&[previous], &[], &none(), &none());
        assert_eq!(removed[0].kind(), ChangeKind::Removed);
    }

    #[test]
    fn reports_definition_changes_of_a_key_with_the_same_identity() {
        let previous = orders_to_customers();
        let mut current = orders_to_customers();
        current.on_delete = ReferentialAction::Cascade;
        current.is_enabled = false;

        let changes = diff_foreign_keys(&[previous], &[current], &none());
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

        let changes = diff_foreign_keys(&[previous], &[current], &none());
        let kinds: Vec<ChangeKind> = changes.iter().map(ForeignKeyChange::kind).collect();
        assert_eq!(kinds, [ChangeKind::Added, ChangeKind::Removed]);
        assert_eq!(changes[0].referencing_table().to_string(), "sales.Invoices");
        assert_eq!(changes[1].referencing_table().to_string(), "sales.Orders");
    }

    #[test]
    fn identical_keys_produce_nothing() {
        assert_eq!(
            diff_foreign_keys(&[orders_to_customers()], &[orders_to_customers()], &none()),
            []
        );
    }
}
