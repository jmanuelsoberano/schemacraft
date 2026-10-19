//! Refreshing with a login that sees less never turns "not visible" into "removed".
//!
//! A fresh snapshot can miss a table because it was dropped or because the login cannot see
//! it, and can miss a `CHECK` text because it changed or because the login lacks
//! `VIEW DEFINITION`. [`SchemaSnapshot::with_unchecked_facts_from`] keeps every saved fact the
//! fresh capture cannot vouch for and lists it, with the moment it was read, so the diff, the
//! refresh and the UI all tell "not checked" apart from "gone".

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    Definition, ForeignKey, ForeignKeyToInvisibleTable, QualifiedName, SchemaSnapshot, Table,
};

/// A fact of a snapshot that can be kept from an earlier capture.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum SnapshotFact {
    /// The table itself, with everything it holds.
    Table,
    /// The view itself, with its columns.
    View,
    /// The `DEFAULT` text of a column of the table.
    ColumnDefault {
        /// Column name.
        column: String,
    },
    /// The text of a `CHECK` constraint of the table.
    CheckConstraint {
        /// Constraint name.
        name: String,
    },
    /// A foreign key whose referencing side is the table.
    ForeignKey {
        /// Constraint name.
        name: String,
    },
}

/// A fact kept from an earlier capture, and when it was last read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct CarriedFact {
    /// Table or view the fact belongs to.
    pub object: QualifiedName,
    /// Which fact of the object was kept.
    pub fact: SnapshotFact,
    /// Moment of the extraction that last read the fact, in UTC.
    pub read_at: DateTime<Utc>,
}

impl SchemaSnapshot {
    /// Whether the extraction would have listed `name` if it existed, so its absence means it
    /// does not exist. Snapshots without an access profile vouch for everything, as in 1.0.
    pub fn vouches_for_absence_of(&self, name: &QualifiedName) -> bool {
        self.access
            .as_ref()
            .is_none_or(|profile| profile.lists_every_object_in(&name.schema))
    }

    /// Merges this fresh snapshot with the `previous` one it replaces, keeping the facts this
    /// extraction could not check:
    ///
    /// * saved tables and views that are missing, inside the extraction's scope, from a schema
    ///   it cannot vouch for (see [`Self::vouches_for_absence_of`]); objects outside the scope
    ///   were de-selected and are not kept;
    /// * saved `CHECK` and `DEFAULT` texts that are now [`Definition::NotVisible`];
    /// * saved foreign keys of kept tables;
    /// * the referenced side of saved foreign keys whose referenced table is now invisible. The
    ///   entry this extraction listed in [`Self::foreign_keys_to_invisible_tables`] keeps what
    ///   it read (the actions, the enabled flag and the trust) and gets back the referenced
    ///   table and columns of the saved key. When its referencing columns changed, the saved
    ///   pairs no longer apply: the entry stays as read and the saved key is not kept.
    ///
    /// Each kept fact is listed in [`Self::carried_over`] with the moment it was last read: the
    /// `read_at` of `previous` when it was already carried there, or that of its table when the
    /// table was, otherwise the extraction time of `previous`. A fact this extraction did read
    /// is not listed, so a capture that sees everything clears the list. Lists that received
    /// kept items are sorted again.
    #[must_use]
    pub fn with_unchecked_facts_from(mut self, previous: &SchemaSnapshot) -> Self {
        let mut ledger = Ledger::new(previous, std::mem::take(&mut self.carried_over));

        self.keep_hidden_texts(previous, &mut ledger);
        let kept_tables = self.keep_unseen_tables(previous, &mut ledger);
        self.keep_unseen_views(previous, &mut ledger);
        self.keep_foreign_keys(previous, &kept_tables, &mut ledger);

        if ledger.has_new_facts {
            self.sort_lists();
        }
        self.carried_over = ledger.into_facts();
        self.keep_unchecked_code(previous);
        self
    }

    /// Restores the order inspectors produce: objects by name, keys by referencing table and
    /// then by name.
    fn sort_lists(&mut self) {
        self.tables
            .sort_by(|left, right| left.name.cmp(&right.name));
        self.views.sort_by(|left, right| left.name.cmp(&right.name));
        self.foreign_keys.sort_by(|left, right| {
            (&left.referencing_table, &left.name).cmp(&(&right.referencing_table, &right.name))
        });
        self.foreign_keys_to_invisible_tables
            .sort_by(|left, right| {
                (&left.referencing_table, &left.name).cmp(&(&right.referencing_table, &right.name))
            });
    }

    /// Whether a missing object of `name` may still exist: it was asked for, and this
    /// extraction cannot vouch for its absence.
    fn may_hide(&self, name: &QualifiedName, is_view: bool) -> bool {
        self.access.as_ref().is_some_and(|profile| {
            profile.scope.includes_schema(&name.schema)
                && (profile.scope.include_views || !is_view)
                && !profile.lists_every_object_in(&name.schema)
        })
    }

    fn keep_hidden_texts(&mut self, previous: &SchemaSnapshot, ledger: &mut Ledger<'_>) {
        let saved_tables: BTreeMap<&QualifiedName, &Table> = previous
            .tables
            .iter()
            .map(|table| (&table.name, table))
            .collect();

        for table in &mut self.tables {
            let Some(saved) = saved_tables.get(&table.name) else {
                continue;
            };
            for column in &mut table.columns {
                if column.default_expression != Some(Definition::NotVisible) {
                    continue;
                }
                let Some(text) = saved
                    .column(&column.name)
                    .and_then(|saved_column| saved_column.default_expression.as_ref())
                    .filter(|definition| definition.text().is_some())
                else {
                    continue;
                };
                column.default_expression = Some(text.clone());
                ledger.record(
                    &table.name,
                    SnapshotFact::ColumnDefault {
                        column: column.name.clone(),
                    },
                );
            }
            for constraint in &mut table.check_constraints {
                if constraint.expression != Definition::NotVisible {
                    continue;
                }
                let Some(text) = saved
                    .check_constraints
                    .iter()
                    .find(|saved_constraint| saved_constraint.name == constraint.name)
                    .map(|saved_constraint| &saved_constraint.expression)
                    .filter(|definition| definition.text().is_some())
                else {
                    continue;
                };
                constraint.expression = text.clone();
                ledger.record(
                    &table.name,
                    SnapshotFact::CheckConstraint {
                        name: constraint.name.clone(),
                    },
                );
            }
        }
    }

    /// Keeps the saved tables this extraction may have missed and returns their names.
    fn keep_unseen_tables(
        &mut self,
        previous: &SchemaSnapshot,
        ledger: &mut Ledger<'_>,
    ) -> BTreeSet<QualifiedName> {
        let present: BTreeSet<&QualifiedName> =
            self.tables.iter().map(|table| &table.name).collect();
        let unseen: Vec<&Table> = previous
            .tables
            .iter()
            .filter(|table| !present.contains(&table.name) && self.may_hide(&table.name, false))
            .collect();

        let mut kept = BTreeSet::new();
        for table in unseen {
            ledger.record(&table.name, SnapshotFact::Table);
            // Texts kept inside the table keep the moment they were read.
            for fact in previous.carried_over.iter().filter(|fact| {
                fact.object == table.name
                    && matches!(
                        fact.fact,
                        SnapshotFact::ColumnDefault { .. } | SnapshotFact::CheckConstraint { .. }
                    )
            }) {
                ledger.record(&fact.object, fact.fact.clone());
            }
            kept.insert(table.name.clone());
            self.tables.push(table.clone());
        }
        kept
    }

    fn keep_unseen_views(&mut self, previous: &SchemaSnapshot, ledger: &mut Ledger<'_>) {
        let present: BTreeSet<&QualifiedName> = self.views.iter().map(|view| &view.name).collect();
        let unseen: Vec<_> = previous
            .views
            .iter()
            .filter(|view| !present.contains(&view.name) && self.may_hide(&view.name, true))
            .cloned()
            .collect();

        for view in unseen {
            ledger.record(&view.name, SnapshotFact::View);
            self.views.push(view);
        }
    }

    /// Keeps the saved foreign keys of kept tables, and the referenced side of the saved keys
    /// whose referenced table became invisible. A key is kept only when its referenced table is
    /// in the merged snapshot: one whose table is gone for good went with it.
    fn keep_foreign_keys(
        &mut self,
        previous: &SchemaSnapshot,
        kept_tables: &BTreeSet<QualifiedName>,
        ledger: &mut Ledger<'_>,
    ) {
        let tables: BTreeSet<QualifiedName> =
            self.tables.iter().map(|table| table.name.clone()).collect();
        let present: BTreeSet<(QualifiedName, String)> = self
            .foreign_keys
            .iter()
            .map(|key| (key.referencing_table.clone(), key.name.clone()))
            .collect();

        for key in &previous.foreign_keys {
            let identity = (key.referencing_table.clone(), key.name.clone());
            if present.contains(&identity) || !tables.contains(&key.referenced_table) {
                continue;
            }
            let hidden_target =
                self.foreign_keys_to_invisible_tables
                    .iter()
                    .position(|invisible| {
                        invisible.referencing_table == key.referencing_table
                            && invisible.name == key.name
                    });
            let kept = match hidden_target {
                // The extraction read the referencing side; only the referenced one is unchecked.
                Some(index) => {
                    let Some(completed) = self
                        .foreign_keys_to_invisible_tables
                        .get(index)
                        .and_then(|invisible| completed_with_referenced_side(invisible, key))
                    else {
                        continue;
                    };
                    self.foreign_keys_to_invisible_tables.remove(index);
                    completed
                }
                None if kept_tables.contains(&key.referencing_table) => key.clone(),
                None => continue,
            };
            ledger.record(
                &key.referencing_table,
                SnapshotFact::ForeignKey {
                    name: key.name.clone(),
                },
            );
            self.foreign_keys.push(kept);
        }

        for key in &previous.foreign_keys_to_invisible_tables {
            let already_listed = self
                .foreign_keys_to_invisible_tables
                .iter()
                .any(|invisible| {
                    invisible.referencing_table == key.referencing_table
                        && invisible.name == key.name
                });
            if !kept_tables.contains(&key.referencing_table) || already_listed {
                continue;
            }
            ledger.record(
                &key.referencing_table,
                SnapshotFact::ForeignKey {
                    name: key.name.clone(),
                },
            );
            self.foreign_keys_to_invisible_tables.push(key.clone());
        }
    }
}

/// The key `invisible` describes, as a fresh extraction read it, completed with the referenced
/// table and columns of `saved`, which that extraction could not see. `None` when the
/// referencing columns differ: the saved pairs would then describe another key.
fn completed_with_referenced_side(
    invisible: &ForeignKeyToInvisibleTable,
    saved: &ForeignKey,
) -> Option<ForeignKey> {
    let same_columns = saved
        .column_pairs
        .iter()
        .map(|pair| &pair.referencing_column)
        .eq(invisible.columns.iter());
    same_columns.then(|| ForeignKey {
        name: invisible.name.clone(),
        referencing_table: invisible.referencing_table.clone(),
        referenced_table: saved.referenced_table.clone(),
        column_pairs: saved.column_pairs.clone(),
        on_delete: invisible.on_delete,
        on_update: invisible.on_update,
        is_enabled: invisible.is_enabled,
        is_trusted: invisible.is_trusted,
    })
}

/// The facts kept so far, keyed so that each is listed once and in a stable order.
struct Ledger<'a> {
    /// When the previous snapshot read each fact it had itself kept.
    earlier_reads: BTreeMap<(&'a QualifiedName, &'a SnapshotFact), DateTime<Utc>>,
    /// When the previous snapshot read everything else.
    previous_extraction: DateTime<Utc>,
    facts: BTreeMap<(QualifiedName, SnapshotFact), DateTime<Utc>>,
    has_new_facts: bool,
}

impl<'a> Ledger<'a> {
    /// Starts from the facts the fresh snapshot already carries, so merging twice with the
    /// same previous snapshot gives the same result.
    fn new(previous: &'a SchemaSnapshot, already_carried: Vec<CarriedFact>) -> Self {
        let earlier_reads = previous
            .carried_over
            .iter()
            .map(|carried| ((&carried.object, &carried.fact), carried.read_at))
            .collect();
        let facts = already_carried
            .into_iter()
            .map(|carried| ((carried.object, carried.fact), carried.read_at))
            .collect();
        Self {
            earlier_reads,
            previous_extraction: previous.extracted_at,
            facts,
            has_new_facts: false,
        }
    }

    /// Records that `fact` of `object` comes from the previous snapshot, with the moment that
    /// snapshot last read it. A fact inside a table the previous snapshot had itself kept whole
    /// was last read with that table.
    fn record(&mut self, object: &QualifiedName, fact: SnapshotFact) {
        let read_at = self
            .earlier_reads
            .get(&(object, &fact))
            .or_else(|| match fact {
                SnapshotFact::Table | SnapshotFact::View => None,
                SnapshotFact::ColumnDefault { .. }
                | SnapshotFact::CheckConstraint { .. }
                | SnapshotFact::ForeignKey { .. } => {
                    self.earlier_reads.get(&(object, &SnapshotFact::Table))
                }
            })
            .copied()
            .unwrap_or(self.previous_extraction);
        self.facts.entry((object.clone(), fact)).or_insert(read_at);
        self.has_new_facts = true;
    }

    fn into_facts(self) -> Vec<CarriedFact> {
        self.facts
            .into_iter()
            .map(|((object, fact), read_at)| CarriedFact {
                object,
                fact,
                read_at,
            })
            .collect()
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

    use chrono::{Duration, TimeZone, Utc};

    use super::{CarriedFact, SnapshotFact};
    use crate::model::test_fixtures::{
        reader_snapshot, sample_snapshot, schema_reader_profile, with_access,
    };
    use crate::model::{
        AccessCounts, CaptureScope, Definition, ForeignKey, QualifiedName, ReferentialAction,
        SchemaSnapshot,
    };

    fn customers() -> QualifiedName {
        QualifiedName::new("dbo", "Customers")
    }

    fn orders() -> QualifiedName {
        QualifiedName::new("sales", "Orders")
    }

    fn facts(snapshot: &SchemaSnapshot) -> Vec<(String, SnapshotFact)> {
        snapshot
            .carried_over
            .iter()
            .map(|carried| (carried.object.to_string(), carried.fact.clone()))
            .collect()
    }

    fn table_names(snapshot: &SchemaSnapshot) -> Vec<String> {
        snapshot
            .tables
            .iter()
            .map(|table| table.name.to_string())
            .collect()
    }

    #[test]
    fn a_weaker_capture_keeps_every_fact_it_could_not_check() {
        let previous = sample_snapshot();
        let merged = reader_snapshot().with_unchecked_facts_from(&previous);

        assert_eq!(table_names(&merged), ["dbo.Customers", "sales.Orders"]);
        assert_eq!(merged.tables, previous.tables);
        assert_eq!(merged.views, previous.views);
        assert_eq!(merged.foreign_keys, previous.foreign_keys);
        assert_eq!(merged.foreign_keys_to_invisible_tables, []);
        assert_eq!(
            facts(&merged),
            [
                ("dbo.Customers".to_string(), SnapshotFact::Table),
                (
                    "sales.Orders".to_string(),
                    SnapshotFact::ColumnDefault {
                        column: "PlacedAt".to_string()
                    }
                ),
                (
                    "sales.Orders".to_string(),
                    SnapshotFact::ForeignKey {
                        name: "FK_Orders_Customers".to_string()
                    }
                ),
            ]
        );
        assert!(
            merged
                .carried_over
                .iter()
                .all(|carried| carried.read_at == previous.extracted_at)
        );
        // The profile still describes the extraction itself.
        assert_eq!(merged.access, reader_snapshot().access);
        assert_eq!(merged.extracted_at, reader_snapshot().extracted_at);
    }

    #[test]
    fn a_hidden_check_text_is_kept_from_the_saved_snapshot() {
        let previous = sample_snapshot();
        let mut current = sample_snapshot();
        current.extracted_at = previous.extracted_at + Duration::days(1);
        current.tables[0].check_constraints[0].expression = Definition::NotVisible;
        let current = with_access(
            current,
            schema_reader_profile(&["dbo", "sales"], AccessCounts::default()),
        );

        let merged = current.with_unchecked_facts_from(&previous);

        assert_eq!(
            merged.tables[0].check_constraints[0].expression,
            previous.tables[0].check_constraints[0].expression
        );
        assert_eq!(
            merged.carried_over,
            [CarriedFact {
                object: customers(),
                fact: SnapshotFact::CheckConstraint {
                    name: "CK_Customers_Name".to_string()
                },
                read_at: previous.extracted_at,
            }]
        );
    }

    #[test]
    fn texts_that_were_never_readable_are_not_kept() {
        let mut previous = sample_snapshot();
        previous.tables[1].columns[2].default_expression = Some(Definition::NotRecorded);
        let merged = reader_snapshot().with_unchecked_facts_from(&previous);

        let orders = merged.table(&orders()).unwrap();
        assert_eq!(
            orders.column("PlacedAt").unwrap().default_expression,
            Some(Definition::NotVisible)
        );
        assert!(
            !facts(&merged)
                .iter()
                .any(|(_, fact)| matches!(fact, SnapshotFact::ColumnDefault { .. }))
        );
    }

    #[test]
    fn the_first_read_survives_two_weak_refreshes_and_clears_once_read_again() {
        let first = sample_snapshot();
        let weak = reader_snapshot();
        let once = weak.clone().with_unchecked_facts_from(&first);

        let mut later = weak;
        later.extracted_at = once.extracted_at + Duration::days(7);
        let twice = later.with_unchecked_facts_from(&once);

        assert_eq!(twice.carried_over.len(), 3);
        assert!(
            twice
                .carried_over
                .iter()
                .all(|carried| carried.read_at == first.extracted_at)
        );
        assert_eq!(twice.tables, first.tables);

        let mut full = sample_snapshot();
        full.extracted_at = twice.extracted_at + Duration::days(1);
        let cleared = full.clone().with_unchecked_facts_from(&twice);
        assert_eq!(cleared.carried_over, []);
        assert_eq!(cleared, full);
    }

    #[test]
    fn merging_twice_with_the_same_snapshot_changes_nothing() {
        let previous = sample_snapshot();
        let once = reader_snapshot().with_unchecked_facts_from(&previous);
        let twice = once.clone().with_unchecked_facts_from(&previous);
        assert_eq!(twice, once);
    }

    #[test]
    fn a_capture_that_vouches_for_the_schema_lets_a_missing_table_go() {
        let previous = sample_snapshot();
        let mut current = sample_snapshot();
        current.tables.retain(|table| table.name != customers());
        current.foreign_keys.clear();

        let merged = current.clone().with_unchecked_facts_from(&previous);

        assert_eq!(table_names(&merged), ["sales.Orders"]);
        assert_eq!(merged.foreign_keys, []);
        assert_eq!(merged.carried_over, []);
        assert_eq!(merged, current);
    }

    #[test]
    fn snapshots_without_a_profile_vouch_for_everything() {
        let previous = sample_snapshot();
        let mut current = reader_snapshot();
        current.access = None;

        let merged = current.with_unchecked_facts_from(&previous);

        assert_eq!(table_names(&merged), ["sales.Orders"]);
        // Texts are still kept: a hidden text is never a removed one.
        assert_eq!(facts(&merged).len(), 1);
        assert!(merged.vouches_for_absence_of(&customers()));
    }

    #[test]
    fn objects_outside_the_new_scope_are_not_kept() {
        let previous = sample_snapshot();
        let mut current = reader_snapshot();
        let profile = current.access.as_mut().unwrap();
        profile.scope = CaptureScope {
            schemas: vec!["sales".to_string()],
            include_views: false,
            ..CaptureScope::everything()
        };
        current.views.clear();

        let merged = current.with_unchecked_facts_from(&previous);

        assert_eq!(table_names(&merged), ["sales.Orders"]);
        assert_eq!(merged.views, []);
        assert!(
            !facts(&merged)
                .iter()
                .any(|(_, fact)| matches!(fact, SnapshotFact::Table | SnapshotFact::View))
        );
    }

    #[test]
    fn a_kept_table_brings_its_own_foreign_keys_and_texts() {
        let mut previous = sample_snapshot();
        let first_read = previous.extracted_at - Duration::days(30);
        previous.carried_over = vec![CarriedFact {
            object: orders(),
            fact: SnapshotFact::ColumnDefault {
                column: "PlacedAt".to_string(),
            },
            read_at: first_read,
        }];

        // A login that sees dbo but nothing of sales.
        let mut current = sample_snapshot();
        current.extracted_at = previous.extracted_at + Duration::days(1);
        current.tables.retain(|table| table.name == customers());
        current.views.clear();
        current.foreign_keys.clear();
        let current = with_access(
            current,
            schema_reader_profile(&["dbo"], AccessCounts::default()),
        );

        let merged = current.with_unchecked_facts_from(&previous);

        assert_eq!(table_names(&merged), ["dbo.Customers", "sales.Orders"]);
        assert_eq!(merged.views, previous.views);
        assert_eq!(merged.foreign_keys, previous.foreign_keys);
        assert_eq!(
            merged.carried_over,
            [
                CarriedFact {
                    object: orders(),
                    fact: SnapshotFact::Table,
                    read_at: previous.extracted_at,
                },
                CarriedFact {
                    object: orders(),
                    fact: SnapshotFact::ColumnDefault {
                        column: "PlacedAt".to_string()
                    },
                    read_at: first_read,
                },
                CarriedFact {
                    object: orders(),
                    fact: SnapshotFact::ForeignKey {
                        name: "FK_Orders_Customers".to_string()
                    },
                    read_at: previous.extracted_at,
                },
                CarriedFact {
                    object: QualifiedName::new("sales", "RecentOrders"),
                    fact: SnapshotFact::View,
                    read_at: previous.extracted_at,
                },
            ]
        );
    }

    #[test]
    fn a_text_inside_a_table_kept_whole_keeps_the_moment_the_table_was_read() {
        let first = sample_snapshot();
        // A login that sees dbo and nothing of sales keeps sales.Orders whole.
        let mut without_sales = sample_snapshot();
        without_sales.extracted_at = first.extracted_at + Duration::days(1);
        without_sales
            .tables
            .retain(|table| table.name == customers());
        without_sales.views.clear();
        without_sales.foreign_keys.clear();
        let without_sales = with_access(
            without_sales,
            schema_reader_profile(&["dbo"], AccessCounts::default()),
        )
        .with_unchecked_facts_from(&first);

        // A reader of sales sees the table again, but not the text of its default.
        let mut reader = reader_snapshot();
        reader.extracted_at = without_sales.extracted_at + Duration::days(1);
        let merged = reader.with_unchecked_facts_from(&without_sales);

        let read_at = |fact: SnapshotFact| {
            merged
                .carried_over
                .iter()
                .find(|carried| carried.object == orders() && carried.fact == fact)
                .map(|carried| carried.read_at)
        };
        assert_eq!(
            read_at(SnapshotFact::ColumnDefault {
                column: "PlacedAt".to_string()
            }),
            Some(first.extracted_at)
        );
        assert_eq!(
            read_at(SnapshotFact::ForeignKey {
                name: "FK_Orders_Customers".to_string()
            }),
            Some(first.extracted_at)
        );
    }

    #[test]
    fn a_key_whose_target_became_invisible_keeps_what_the_capture_read_of_it() {
        let previous = sample_snapshot();
        let mut current = reader_snapshot();
        current.foreign_keys_to_invisible_tables[0].on_delete = ReferentialAction::Cascade;
        current.foreign_keys_to_invisible_tables[0].is_enabled = false;
        current.foreign_keys_to_invisible_tables[0].is_trusted = Some(false);

        let merged = current.with_unchecked_facts_from(&previous);

        // The referencing side comes from the fresh capture, the referenced one from the saved key.
        assert_eq!(
            merged.foreign_keys,
            [ForeignKey {
                on_delete: ReferentialAction::Cascade,
                is_enabled: false,
                is_trusted: Some(false),
                ..previous.foreign_keys[0].clone()
            }]
        );
        assert_eq!(merged.foreign_keys_to_invisible_tables, []);
        assert!(facts(&merged).contains(&(
            "sales.Orders".to_string(),
            SnapshotFact::ForeignKey {
                name: "FK_Orders_Customers".to_string()
            }
        )));
    }

    #[test]
    fn a_key_whose_columns_changed_while_its_target_became_invisible_is_not_kept() {
        let previous = sample_snapshot();
        let mut current = reader_snapshot();
        current.foreign_keys_to_invisible_tables[0].columns = vec!["OrderId".to_string()];

        let merged = current.clone().with_unchecked_facts_from(&previous);

        assert_eq!(merged.foreign_keys, []);
        assert_eq!(
            merged.foreign_keys_to_invisible_tables,
            current.foreign_keys_to_invisible_tables
        );
        assert!(
            !facts(&merged)
                .iter()
                .any(|(_, fact)| matches!(fact, SnapshotFact::ForeignKey { .. }))
        );
    }

    #[test]
    fn a_foreign_key_to_a_table_gone_for_good_is_not_kept() {
        let previous = sample_snapshot();
        // dbo is fully visible and Customers is gone; sales is hidden, so Orders is kept, but
        // its key to Customers cannot outlive the table it referenced.
        let mut current = sample_snapshot();
        current.tables.clear();
        current.views.clear();
        current.foreign_keys.clear();
        let current = with_access(
            current,
            schema_reader_profile(&["dbo"], AccessCounts::default()),
        );

        let merged = current.with_unchecked_facts_from(&previous);

        assert_eq!(table_names(&merged), ["sales.Orders"]);
        assert_eq!(merged.foreign_keys, []);
    }

    #[test]
    fn vouching_follows_the_profile_of_the_capture() {
        let reader = reader_snapshot();
        assert!(!reader.vouches_for_absence_of(&customers()));
        assert!(sample_snapshot().vouches_for_absence_of(&customers()));

        let read_at = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let fact = CarriedFact {
            object: orders(),
            fact: SnapshotFact::ColumnDefault {
                column: "PlacedAt".to_string(),
            },
            read_at,
        };
        let json = serde_json::to_value(&fact).unwrap();
        assert_eq!(json["fact"]["kind"], "columnDefault");
        assert_eq!(json["fact"]["column"], "PlacedAt");
        assert_eq!(json["readAt"], "2026-01-01T00:00:00Z");
        assert_eq!(serde_json::from_value::<CarriedFact>(json).unwrap(), fact);
    }
}
