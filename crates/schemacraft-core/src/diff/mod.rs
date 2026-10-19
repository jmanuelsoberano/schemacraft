//! Comparison of two schema snapshots.
//!
//! Objects are matched by name: schema-qualified for tables and views, qualified by the
//! referencing table for foreign keys, plain for columns, indexes and constraints. A renamed
//! object is therefore reported as a removal plus an addition, which keeps the result
//! deterministic and free of guesses. Column order is not compared: reordering columns changes
//! nothing in a diagram. Every list is sorted by name, so the same two snapshots always produce
//! the same diff.
//!
//! What the fresh extraction could not see is never a change. The comparison runs against the
//! fresh snapshot merged with the facts it could not check
//! ([`SchemaSnapshot::with_unchecked_facts_from`]), the same merge a refresh applies, so the
//! review and the refreshed project agree. Kept facts are listed apart, and so are the facts
//! the saved snapshot could not state and the fresh one reads. A saved snapshot that recorded
//! no access, as in a 1.0 file, could not hold bound defaults, defaults whose text was not
//! visible or keys to invisible tables, so their appearance next to it is no change either.
//!
//! A state recorded on one side only is never a change either: whether an index or a primary key
//! is enabled or filtered, its included columns, and whether a `CHECK` or a foreign key is
//! trusted are compared only when both snapshots recorded them. A capture that records such a
//! family for the first time, next to a project saved before 1.2, says so in `capture_changes`,
//! one counted line for the family. The verdicts the review needs, whether any object changed and
//! whether the project is up to date, are computed here and travel with the diff, so the
//! interface never works them out again.

mod code;
mod entities;
mod foreign_keys;
mod pairing;
mod visibility;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub use code::{
    AvailableCode, CodeChange, CodeCounts, CodeDiff, CodeProperty, CodeReadFailure, CodeReadFamily,
    comparable_text,
};

pub use entities::{
    CheckConstraintChange, ColumnChange, ColumnProperty, IndexChange, PrimaryKeyChange,
    TableChange, ViewChange,
};
pub use foreign_keys::{ForeignKeyChange, ForeignKeyProperty, ForeignKeyToInvisibleTableChange};
use visibility::Baseline;
pub use visibility::{AvailableFact, CaptureChange};

use crate::model::{CarriedFact, SchemaSnapshot};

/// Everything that differs between two snapshots, and what the fresh one could or could not
/// check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct SchemaDiff {
    /// Changes and visibility of procedures, functions, triggers and view code.
    pub code: CodeDiff,
    /// Tables that appeared, disappeared or changed, by name.
    pub tables: Vec<TableChange>,
    /// Views that appeared, disappeared or changed, by name.
    pub views: Vec<ViewChange>,
    /// Foreign keys that appeared, disappeared or changed, by referencing table and name.
    pub foreign_keys: Vec<ForeignKeyChange>,
    /// Foreign keys to tables the login cannot see that appeared, disappeared or changed, by
    /// referencing table and name. A key whose referenced table became visible, or one a saved
    /// snapshot without an access profile could not hold, is listed in `now_available` instead.
    pub foreign_keys_to_invisible_tables: Vec<ForeignKeyToInvisibleTableChange>,
    /// Counts per object kind, for the review dialog header. Foreign key counts include the
    /// keys to invisible tables.
    pub summary: DiffSummary,
    /// Facts kept from the saved snapshot because the fresh extraction could not check them,
    /// with the moment each was last read. They are neither removed nor changed.
    pub not_checked: Vec<CarriedFact>,
    /// Facts the saved snapshot could not state and the fresh extraction reads, such as a text
    /// that became readable or, next to a 1.0 file, a bound default. They are not changes of
    /// the database.
    pub now_available: Vec<AvailableFact>,
    /// Whether the fresh extraction reached another verdict on what its login sees, including
    /// a first verdict for a snapshot that recorded none.
    pub access_changed: bool,
    /// Families of facts the fresh extraction records and the saved snapshot did not, one line
    /// each, such as the state of indexes and constraints next to a project saved before 1.2.
    /// They are not changes of the database.
    pub capture_changes: Vec<CaptureChange>,
    /// Whether any table, view, foreign key or code object appeared, disappeared or changed,
    /// as far as the fresh extraction could check.
    has_object_changes: bool,
    /// Whether the review has nothing to report: no object changed, nothing was kept unchecked,
    /// nothing became readable or was recorded for the first time, and the verdict on access is
    /// the same.
    is_up_to_date: bool,
}

impl SchemaDiff {
    /// Compares `previous` (the saved snapshot) with `current` (the fresh one).
    pub fn between(previous: &SchemaSnapshot, current: &SchemaSnapshot) -> Self {
        let merged = current.clone().with_unchecked_facts_from(previous);
        let baseline = Baseline::of(previous);
        let keys_with_visible_target = foreign_keys::keys_whose_target_became_visible(
            &previous.foreign_keys_to_invisible_tables,
            &merged.foreign_keys,
        );
        let keys_unrecorded_before = foreign_keys::keys_unrecorded_before(
            previous,
            &merged.foreign_keys_to_invisible_tables,
        );

        let tables = entities::diff_tables(&previous.tables, &merged.tables, baseline);
        let views = entities::diff_views(&previous.views, &merged.views, baseline);
        let foreign_keys = foreign_keys::diff_foreign_keys(
            &previous.foreign_keys,
            &merged.foreign_keys,
            &keys_with_visible_target,
        );
        let foreign_keys_to_invisible_tables = foreign_keys::diff_foreign_keys_to_invisible_tables(
            &previous.foreign_keys_to_invisible_tables,
            &merged.foreign_keys_to_invisible_tables,
            &keys_with_visible_target,
            &keys_unrecorded_before,
        );
        let summary = DiffSummary {
            code: ChangeCounts::default(),
            tables: ChangeCounts::of(tables.iter().map(TableChange::kind)),
            views: ChangeCounts::of(views.iter().map(ViewChange::kind)),
            foreign_keys: ChangeCounts::of(
                foreign_keys.iter().map(ForeignKeyChange::kind).chain(
                    foreign_keys_to_invisible_tables
                        .iter()
                        .map(ForeignKeyToInvisibleTableChange::kind),
                ),
            ),
        };
        let now_available = visibility::facts_now_available(
            previous,
            &merged,
            &keys_with_visible_target,
            &keys_unrecorded_before,
        );
        let access_changed = visibility::access_changed(previous, &merged);
        let capture_changes = visibility::capture_changes(previous, &merged);

        let code = code::diff_code(previous, &merged);
        let mut summary = summary;
        summary.code = ChangeCounts::of(code.changes.iter().map(CodeChange::kind));
        let mut diff = Self {
            code,
            tables,
            views,
            foreign_keys,
            foreign_keys_to_invisible_tables,
            summary,
            not_checked: merged.carried_over,
            now_available,
            access_changed,
            capture_changes,
            has_object_changes: false,
            is_up_to_date: false,
        };
        diff.has_object_changes = !diff.is_empty();
        diff.is_up_to_date = !diff.has_object_changes
            && diff.not_checked.is_empty()
            && diff.now_available.is_empty()
            && diff.code.not_checked.is_empty()
            && diff.code.now_available.is_empty()
            && diff.code.read_failures.is_empty()
            && !diff.access_changed
            && diff.capture_changes.is_empty();
        diff
    }

    /// Whether the snapshots describe the same schema, as far as the fresh one could check.
    pub fn is_empty(&self) -> bool {
        self.tables.is_empty()
            && self.views.is_empty()
            && self.foreign_keys.is_empty()
            && self.foreign_keys_to_invisible_tables.is_empty()
            && self.code.is_empty()
    }

    /// Whether any object appeared, disappeared or changed: the opposite of [`Self::is_empty`],
    /// as it travels to the review.
    pub fn has_object_changes(&self) -> bool {
        self.has_object_changes
    }

    /// Whether a review has nothing to report: the same schema, nothing the fresh extraction
    /// could not check, nothing newly readable or newly recorded and the same verdict on access.
    /// A refresh that is not up to date has something to show even when [`Self::is_empty`]
    /// holds.
    pub fn is_up_to_date(&self) -> bool {
        self.is_up_to_date
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
    /// Code object changes, including the code of views.
    pub code: ChangeCounts,
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
        self.tables.total() + self.views.total() + self.foreign_keys.total() + self.code.total()
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::indexing_slicing,
        clippy::panic
    )]

    use chrono::Duration;

    use super::{
        AvailableFact, CaptureChange, ChangeKind, ForeignKeyChange, ForeignKeyProperty,
        ForeignKeyToInvisibleTableChange, IndexChange, SchemaDiff, TableChange,
    };
    use crate::model::test_fixtures::{
        reader_snapshot, sample_snapshot, schema_reader_profile, with_access,
    };
    use crate::model::{
        AccessCounts, Column, Completeness, Definition, ForeignKeyToInvisibleTable, QualifiedName,
        ReferentialAction, SchemaSnapshot, SnapshotFact, SqlDataType, Table,
    };

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

    /// The sample read a day later by `db_datareader`: every table, no text.
    fn datareader_snapshot() -> SchemaSnapshot {
        let mut snapshot = sample_snapshot();
        snapshot.extracted_at += Duration::days(1);
        for table in &mut snapshot.tables {
            for column in &mut table.columns {
                if column.default_expression.is_some() {
                    column.default_expression = Some(Definition::NotVisible);
                }
            }
            for constraint in &mut table.check_constraints {
                constraint.expression = Definition::NotVisible;
            }
        }
        let counts = AccessCounts::of(&snapshot);
        with_access(snapshot, schema_reader_profile(&["dbo", "sales"], counts))
    }

    fn hidden_texts() -> Vec<(QualifiedName, SnapshotFact)> {
        vec![
            (
                QualifiedName::new("dbo", "Customers"),
                SnapshotFact::CheckConstraint {
                    name: "CK_Customers_Name".to_string(),
                },
            ),
            (
                QualifiedName::new("sales", "Orders"),
                SnapshotFact::ColumnDefault {
                    column: "PlacedAt".to_string(),
                },
            ),
        ]
    }

    fn not_checked(diff: &SchemaDiff) -> Vec<(QualifiedName, SnapshotFact)> {
        diff.not_checked
            .iter()
            .map(|carried| (carried.object.clone(), carried.fact.clone()))
            .collect()
    }

    fn now_available(diff: &SchemaDiff) -> Vec<(QualifiedName, SnapshotFact)> {
        diff.now_available
            .iter()
            .map(|AvailableFact { object, fact }| (object.clone(), fact.clone()))
            .collect()
    }

    /// A change made to the referencing side of a key the capture read as a key to an invisible
    /// table, and the property the diff is expected to report for it.
    type ReferencingSideChange = (fn(&mut ForeignKeyToInvisibleTable), ForeignKeyProperty);

    #[test]
    fn identical_snapshots_produce_an_empty_diff() {
        let diff = SchemaDiff::between(&sample_snapshot(), &sample_snapshot());
        assert!(diff.is_empty());
        assert!(diff.is_up_to_date());
        assert_eq!(diff.summary.total(), 0);
    }

    #[test]
    fn a_login_that_cannot_read_texts_changes_nothing_and_lists_them_as_not_checked() {
        let previous = sample_snapshot();
        let diff = SchemaDiff::between(&previous, &datareader_snapshot());

        assert!(diff.is_empty());
        assert_eq!(diff.summary.total(), 0);
        assert_eq!(not_checked(&diff), hidden_texts());
        assert!(
            diff.not_checked
                .iter()
                .all(|carried| carried.read_at == previous.extracted_at)
        );
        assert_eq!(diff.now_available, []);
        assert!(diff.access_changed);
        assert!(!diff.is_up_to_date());
    }

    #[test]
    fn a_login_that_reads_texts_again_changes_nothing_and_lists_them_as_available() {
        let diff = SchemaDiff::between(&datareader_snapshot(), &sample_snapshot());

        assert!(diff.is_empty());
        assert_eq!(now_available(&diff), hidden_texts());
        assert_eq!(diff.not_checked, []);
        assert!(diff.access_changed);
    }

    #[test]
    fn a_coverage_of_code_counts_only_when_both_captures_judged_it() {
        let previous = sample_snapshot();
        let with_code = |programmability, module_definitions| {
            let mut snapshot = sample_snapshot();
            let profile = snapshot.access.as_mut().unwrap();
            profile.coverage.programmability = programmability;
            profile.coverage.module_definitions = module_definitions;
            snapshot
        };

        // The first capture that judges code is no change of access.
        let first = with_code(
            Some(Completeness::Partial),
            Some(Completeness::NotAvailable),
        );
        assert!(!SchemaDiff::between(&previous, &first).access_changed);
        assert!(SchemaDiff::between(&previous, &first).is_up_to_date());
        // Two captures that judged it and disagree are.
        let later = with_code(
            Some(Completeness::Complete),
            Some(Completeness::NotAvailable),
        );
        assert!(SchemaDiff::between(&first, &later).access_changed);
        let texts = with_code(Some(Completeness::Partial), Some(Completeness::Complete));
        assert!(SchemaDiff::between(&first, &texts).access_changed);
        assert!(!SchemaDiff::between(&first, &first.clone()).access_changed);
    }

    /// The sample as a 1.2 capture reads it: the state of every index, key and constraint.
    fn with_state_recorded(mut snapshot: SchemaSnapshot) -> SchemaSnapshot {
        for table in &mut snapshot.tables {
            if let Some(key) = table.primary_key.as_mut() {
                key.is_enabled = Some(true);
            }
            for index in &mut table.indexes {
                index.included_columns = Some(vec!["Notes".to_string()]);
                index.is_filtered = Some(false);
                index.is_enabled = Some(true);
            }
            for constraint in &mut table.check_constraints {
                constraint.is_trusted = Some(true);
            }
        }
        for key in &mut snapshot.foreign_keys {
            key.is_trusted = Some(false);
        }
        for key in &mut snapshot.foreign_keys_to_invisible_tables {
            key.is_trusted = Some(true);
        }
        snapshot
    }

    #[test]
    fn index_and_key_state_recorded_on_one_side_only_is_no_change() {
        let previous = sample_snapshot();
        let recorded = with_state_recorded(sample_snapshot());

        let first = SchemaDiff::between(&previous, &recorded);
        assert!(first.is_empty(), "{first:?}");
        assert!(!first.has_object_changes());
        // The sample holds two primary keys, two indexes, one CHECK and one foreign key.
        assert_eq!(
            first.capture_changes,
            [CaptureChange::IndexAndConstraintStateRecorded { count: 6 }]
        );
        assert!(!first.is_up_to_date());
        assert!(SchemaDiff::between(&recorded, &previous).is_empty());
        assert_eq!(
            SchemaDiff::between(&recorded, &previous).capture_changes,
            []
        );
        let again = SchemaDiff::between(&recorded, &recorded.clone());
        assert_eq!(again.capture_changes, []);
        assert!(again.is_up_to_date());

        // Recorded on both sides, a different state is a change.
        let mut disabled = recorded.clone();
        disabled.tables[0].indexes[0].is_enabled = Some(false);
        disabled.tables[1].primary_key.as_mut().unwrap().is_enabled = Some(false);
        let diff = SchemaDiff::between(&recorded, &disabled);
        let [
            TableChange::Changed {
                primary_key: None,
                indexes,
                ..
            },
            TableChange::Changed {
                primary_key: Some(_),
                ..
            },
        ] = diff.tables.as_slice()
        else {
            panic!("expected an index and a key change: {:?}", diff.tables);
        };
        assert_eq!(indexes.len(), 1);
        assert!(diff.has_object_changes());
        assert_eq!(diff.capture_changes, []);
    }

    #[test]
    fn the_first_refresh_reports_once_an_index_whose_partitioning_column_1_1_read_as_a_key() {
        // 1.1 read the partitioning column SQL Server adds to an index aligned with a partitioned
        // table as its first key column, and recorded no state.
        let mut previous = sample_snapshot();
        previous.tables[0].indexes[0]
            .columns
            .insert(0, "PartitionYear".to_string());
        let recorded = with_state_recorded(sample_snapshot());

        let diff = SchemaDiff::between(&previous, &recorded);
        let [TableChange::Changed { indexes, .. }] = diff.tables.as_slice() else {
            panic!("expected one table change: {:?}", diff.tables);
        };
        let [IndexChange::Changed { before, after }] = indexes.as_slice() else {
            panic!("expected one index change: {indexes:?}");
        };
        assert_eq!(before.columns[0], "PartitionYear");
        assert_eq!(after.columns, recorded.tables[0].indexes[0].columns);
        assert!(diff.has_object_changes());
        // The state of every object is still recorded in the one counted line.
        assert_eq!(
            diff.capture_changes,
            [CaptureChange::IndexAndConstraintStateRecorded { count: 6 }]
        );
    }

    #[test]
    fn a_key_kept_over_a_weaker_refresh_takes_the_trust_the_capture_read() {
        let previous = with_state_recorded(sample_snapshot());
        let mut current = with_state_recorded(reader_snapshot());
        current.foreign_keys_to_invisible_tables[0].is_trusted = Some(true);

        let diff = SchemaDiff::between(&previous, &current);

        let [
            ForeignKeyChange::Changed {
                before,
                after,
                properties,
            },
        ] = diff.foreign_keys.as_slice()
        else {
            panic!("expected one changed key, got {diff:?}");
        };
        assert_eq!(properties, &[ForeignKeyProperty::Trust]);
        assert_eq!(
            (before.is_trusted, after.is_trusted),
            (Some(false), Some(true))
        );
        // Recorded on both sides, so nothing is newly recorded.
        assert_eq!(diff.capture_changes, []);
    }

    #[test]
    fn a_table_the_login_cannot_vouch_for_is_not_checked_rather_than_removed() {
        let diff = SchemaDiff::between(&sample_snapshot(), &reader_snapshot());

        assert!(diff.is_empty(), "{diff:?}");
        let facts = not_checked(&diff);
        let customers = QualifiedName::new("dbo", "Customers");
        let orders = QualifiedName::new("sales", "Orders");
        assert!(facts.contains(&(customers, SnapshotFact::Table)));
        // The key now points to a table the login cannot see; it is kept, not removed.
        assert!(facts.contains(&(
            orders,
            SnapshotFact::ForeignKey {
                name: "FK_Orders_Customers".to_string()
            }
        )));
    }

    #[test]
    fn objects_left_out_of_the_new_selection_are_removed_even_when_unseen() {
        let mut current = reader_snapshot();
        current.views.clear();
        let profile = current.access.as_mut().unwrap();
        profile.scope.schemas = vec!["sales".to_string()];
        profile.scope.include_views = false;

        let diff = SchemaDiff::between(&sample_snapshot(), &current);

        let removed: Vec<String> = diff
            .tables
            .iter()
            .filter(|change| change.kind() == ChangeKind::Removed)
            .map(|change| change.name().to_string())
            .collect();
        assert_eq!(removed, ["dbo.Customers"]);
        assert_eq!(diff.summary.views.removed, 1);
        assert!(
            !not_checked(&diff)
                .iter()
                .any(|(_, fact)| matches!(fact, SnapshotFact::Table | SnapshotFact::View))
        );
    }

    #[test]
    fn a_key_whose_table_became_visible_is_available_rather_than_added() {
        let diff = SchemaDiff::between(&reader_snapshot(), &sample_snapshot());

        assert_eq!(diff.summary.tables.added, 1);
        assert_eq!(diff.summary.foreign_keys.total(), 0);
        assert_eq!(diff.foreign_keys, []);
        assert_eq!(diff.foreign_keys_to_invisible_tables, []);
        assert_eq!(
            now_available(&diff),
            [
                (
                    QualifiedName::new("sales", "Orders"),
                    SnapshotFact::ColumnDefault {
                        column: "PlacedAt".to_string()
                    }
                ),
                (
                    QualifiedName::new("sales", "Orders"),
                    SnapshotFact::ForeignKey {
                        name: "FK_Orders_Customers".to_string()
                    }
                ),
            ]
        );
    }

    #[test]
    fn keys_to_invisible_tables_that_appear_or_go_are_changes() {
        let with_key = reader_snapshot();
        let mut without_key = reader_snapshot();
        without_key.foreign_keys_to_invisible_tables.clear();

        let added = SchemaDiff::between(&without_key, &with_key);
        assert!(matches!(
            added.foreign_keys_to_invisible_tables.as_slice(),
            [ForeignKeyToInvisibleTableChange::Added { key }] if key.name == "FK_Orders_Customers"
        ));
        assert_eq!(added.summary.foreign_keys.added, 1);
        assert!(!added.is_empty());

        let removed = SchemaDiff::between(&with_key, &without_key);
        assert!(matches!(
            removed.foreign_keys_to_invisible_tables.as_slice(),
            [ForeignKeyToInvisibleTableChange::Removed { .. }]
        ));
        assert_eq!(removed.summary.foreign_keys.removed, 1);
    }

    #[test]
    fn a_format_1_project_refreshed_with_the_same_schema_changes_nothing() {
        // What the upgrade of a 1.0 file makes of the sample: no access profile, the CHECK text
        // and its state not recorded, and the missing defaults of its schema unknown.
        let mut upgraded = sample_snapshot();
        upgraded.access = None;
        let customers = &mut upgraded.tables[0];
        customers.check_constraints[0].expression = Definition::NotRecorded;
        customers.check_constraints[0].is_enabled = None;
        for column in &mut customers.columns {
            column.default_expression = Some(Definition::NotRecorded);
        }

        let diff = SchemaDiff::between(&upgraded, &sample_snapshot());

        assert!(diff.is_empty(), "{diff:?}");
        assert!(diff.access_changed);
        assert_eq!(
            now_available(&diff),
            [(
                QualifiedName::new("dbo", "Customers"),
                SnapshotFact::CheckConstraint {
                    name: "CK_Customers_Name".to_string()
                }
            )]
        );
        assert!(!diff.is_up_to_date());
    }

    #[test]
    fn a_format_1_project_refreshed_by_the_same_reader_changes_nothing() {
        // A reader of sales, with a default bound by sp_bindefault that it can read.
        let mut current = reader_snapshot();
        let orders = QualifiedName::new("sales", "Orders");
        current.tables[0]
            .columns
            .iter_mut()
            .find(|column| column.name == "Total")
            .unwrap()
            .default_expression = Some(Definition::readable("0"));
        // What 1.0 saved for the same login: no default whose text it could not read, no bound
        // default, no key to the table it could not see, and no access profile.
        let mut upgraded = current.clone();
        upgraded.access = None;
        upgraded.foreign_keys_to_invisible_tables.clear();
        for column in &mut upgraded.tables[0].columns {
            column.default_expression = None;
        }

        let diff = SchemaDiff::between(&upgraded, &current);

        assert!(diff.is_empty(), "{diff:?}");
        assert_eq!(diff.summary.total(), 0);
        assert_eq!(diff.not_checked, []);
        assert_eq!(
            now_available(&diff),
            [
                (
                    orders.clone(),
                    SnapshotFact::ColumnDefault {
                        column: "Total".to_string()
                    }
                ),
                (
                    orders,
                    SnapshotFact::ForeignKey {
                        name: "FK_Orders_Customers".to_string()
                    }
                ),
            ]
        );
        assert!(diff.access_changed);
    }

    #[test]
    fn defaults_and_keys_that_appear_next_to_a_recorded_capture_are_changes() {
        let mut current = reader_snapshot();
        current.tables[0]
            .columns
            .iter_mut()
            .find(|column| column.name == "Total")
            .unwrap()
            .default_expression = Some(Definition::readable("0"));
        let mut previous = current.clone();
        previous.foreign_keys_to_invisible_tables.clear();
        for column in &mut previous.tables[0].columns {
            column.default_expression = None;
        }

        let diff = SchemaDiff::between(&previous, &current);

        assert_eq!(diff.summary.tables.changed, 1);
        assert_eq!(diff.summary.foreign_keys.added, 1);
        assert_eq!(diff.now_available, []);
    }

    #[test]
    fn a_key_that_changed_while_its_target_became_invisible_is_reported() {
        let previous = sample_snapshot();
        let saved = previous.foreign_keys[0].clone();
        let changes: [ReferencingSideChange; 2] = [
            (
                |key| key.on_delete = ReferentialAction::Cascade,
                ForeignKeyProperty::OnDelete,
            ),
            (|key| key.is_enabled = false, ForeignKeyProperty::Enabled),
        ];

        for (change, property) in changes {
            let mut current = reader_snapshot();
            change(&mut current.foreign_keys_to_invisible_tables[0]);

            let diff = SchemaDiff::between(&previous, &current);

            let [
                ForeignKeyChange::Changed {
                    before,
                    after,
                    properties,
                },
            ] = diff.foreign_keys.as_slice()
            else {
                panic!("expected one changed key, got {diff:?}");
            };
            assert_eq!(properties, &[property]);
            assert_eq!(before, &saved);
            assert_eq!(after.referenced_table, saved.referenced_table);
            assert_eq!(after.column_pairs, saved.column_pairs);
            assert_eq!(diff.foreign_keys_to_invisible_tables, []);
            assert_eq!(diff.summary.foreign_keys.changed, 1);
            // The referenced side still could not be checked.
            assert!(not_checked(&diff).contains(&(
                QualifiedName::new("sales", "Orders"),
                SnapshotFact::ForeignKey {
                    name: "FK_Orders_Customers".to_string()
                }
            )));
        }
    }

    #[test]
    fn a_key_whose_columns_changed_while_its_target_became_invisible_is_replaced() {
        let mut current = reader_snapshot();
        current.foreign_keys_to_invisible_tables[0].columns = vec!["OrderId".to_string()];

        let diff = SchemaDiff::between(&sample_snapshot(), &current);

        assert!(matches!(
            diff.foreign_keys.as_slice(),
            [ForeignKeyChange::Removed { key }] if key.name == "FK_Orders_Customers"
        ));
        assert!(matches!(
            diff.foreign_keys_to_invisible_tables.as_slice(),
            [ForeignKeyToInvisibleTableChange::Added { key }] if key.columns == ["OrderId"]
        ));
        assert_eq!(diff.summary.foreign_keys.total(), 2);
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
        assert_eq!(json["foreignKeysToInvisibleTables"], serde_json::json!([]));
        assert_eq!(json["notChecked"], serde_json::json!([]));
        assert_eq!(json["nowAvailable"], serde_json::json!([]));
        assert_eq!(json["accessChanged"], false);
        assert_eq!(json["captureChanges"], serde_json::json!([]));
        assert_eq!(json["hasObjectChanges"], true);
        assert_eq!(json["isUpToDate"], false);

        let first = serde_json::to_value(SchemaDiff::between(
            &previous,
            &with_state_recorded(sample_snapshot()),
        ))
        .unwrap();
        assert_eq!(
            first["captureChanges"],
            serde_json::json!([{ "kind": "indexAndConstraintStateRecorded", "count": 6 }])
        );
        assert_eq!(first["hasObjectChanges"], false);
        assert_eq!(first["isUpToDate"], false);

        let weaker =
            serde_json::to_value(SchemaDiff::between(&previous, &reader_snapshot())).unwrap();
        assert_eq!(weaker["notChecked"][0]["fact"]["kind"], "table");
        assert_eq!(weaker["notChecked"][0]["readAt"], "2026-10-13T15:30:00Z");
        assert_eq!(weaker["accessChanged"], true);
    }
}
