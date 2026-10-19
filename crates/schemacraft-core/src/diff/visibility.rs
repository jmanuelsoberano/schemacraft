//! What a refresh learns about the schema without the schema changing: texts that became
//! readable, keys whose referenced table became visible, facts a 1.0 file could not record,
//! families of facts recorded for the first time, and a different verdict on what the login
//! sees. None of it is a change of the database, yet the project must record it.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::code::{CodeCounts, readable_texts};
use super::foreign_keys::KeyIdentity;
use super::pairing::{Pairing, pair_by_key};
use crate::model::{
    CaptureState, Completeness, Definition, Index, QualifiedName, SchemaSnapshot, SnapshotFact,
    Table,
};

/// A fact the previous snapshot could not state and the fresh extraction reads.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct AvailableFact {
    /// Table the fact belongs to.
    pub object: QualifiedName,
    /// Which fact became available: a `CHECK` or `DEFAULT` text that is now readable, a
    /// foreign key whose referenced table is now visible, or, when the previous snapshot
    /// recorded no access (a 1.0 file), a readable default or a key to an invisible table that
    /// it could not hold.
    pub fact: SnapshotFact,
}

/// A family of facts the fresh extraction records and the saved snapshot did not, reported as
/// one line instead of as a change of every object that holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum CaptureChange {
    /// Objects were captured for the first time, rather than added to the database.
    ProgrammabilityRecorded {
        /// Objects now recorded, per kind.
        counts: CodeCounts,
    },
    /// The connection options explicitly removed the saved code objects.
    ProgrammabilityNoLongerRecorded {
        /// Objects left out, per kind.
        counts: CodeCounts,
    },
    /// Module texts were read for the first time.
    ModuleDefinitionsRecorded {
        /// Readable texts that will be saved in the project.
        count: usize,
    },
    /// The connection options explicitly removed the saved texts.
    ModuleDefinitionsNoLongerRecorded {
        /// Readable texts left out of the project.
        count: usize,
    },
    /// Whether indexes and primary keys are enabled or filtered, their included columns, and
    /// whether `CHECK` constraints and foreign keys are trusted: a project saved before 1.2 did not
    /// record them, and until it does it reads as 1.1 read it.
    #[serde(rename_all = "camelCase")]
    IndexAndConstraintStateRecorded {
        /// Indexes, primary keys, `CHECK` constraints and foreign keys in both snapshots whose
        /// state the fresh extraction records and the saved snapshot did not.
        count: usize,
    },
}

/// What the previous snapshot could state about defaults and keys to invisible tables, which
/// decides whether their absence there is a fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Baseline {
    /// It recorded what its login could see, so a default or a key it lacks did not exist.
    Recorded,
    /// It recorded no access, as in a file written by SchemaCraft 1.0. Such a file holds no
    /// default bound with `sp_bindefault`, no default whose text the login could not read and
    /// no foreign key to a table the login could not see, so their absence says nothing.
    Unrecorded,
}

impl Baseline {
    /// The baseline `snapshot` offers as the previous side of a comparison.
    pub(super) fn of(snapshot: &SchemaSnapshot) -> Self {
        if snapshot.access.is_some() {
            Self::Recorded
        } else {
            Self::Unrecorded
        }
    }
}

/// The facts of `current` that `previous` could not state, sorted by object and fact. Keys in
/// `keys_with_visible_target` and `keys_unrecorded_before` are among them.
pub(super) fn facts_now_available(
    previous: &SchemaSnapshot,
    current: &SchemaSnapshot,
    keys_with_visible_target: &BTreeSet<KeyIdentity<'_>>,
    keys_unrecorded_before: &BTreeSet<KeyIdentity<'_>>,
) -> Vec<AvailableFact> {
    let baseline = Baseline::of(previous);
    let mut facts: BTreeSet<AvailableFact> =
        pair_by_key(&previous.tables, &current.tables, |table| &table.name)
            .into_iter()
            .filter_map(|pairing| match pairing {
                Pairing::Both { previous, current } => {
                    Some(texts_now_readable(previous, current, baseline))
                }
                Pairing::Added(_) | Pairing::Removed(_) => None,
            })
            .flatten()
            .collect();

    facts.extend(
        keys_with_visible_target
            .iter()
            .chain(keys_unrecorded_before)
            .map(|(table, name)| AvailableFact {
                object: (*table).clone(),
                fact: SnapshotFact::ForeignKey {
                    name: (*name).to_string(),
                },
            }),
    );
    facts.into_iter().collect()
}

fn texts_now_readable(previous: &Table, current: &Table, baseline: Baseline) -> Vec<AvailableFact> {
    let available = |fact| AvailableFact {
        object: current.name.clone(),
        fact,
    };
    let defaults = current.columns.iter().filter_map(|column| {
        let before = previous.column(&column.name)?.default_expression.as_ref();
        let after = column.default_expression.as_ref()?;
        let now_readable = match before {
            Some(before) => became_readable(before, after),
            None => baseline == Baseline::Unrecorded && after.text().is_some(),
        };
        now_readable.then(|| {
            available(SnapshotFact::ColumnDefault {
                column: column.name.clone(),
            })
        })
    });
    let checks = current.check_constraints.iter().filter_map(|constraint| {
        let before = previous
            .check_constraints
            .iter()
            .find(|saved| saved.name == constraint.name)?;
        became_readable(&before.expression, &constraint.expression).then(|| {
            available(SnapshotFact::CheckConstraint {
                name: constraint.name.clone(),
            })
        })
    });
    defaults.chain(checks).collect()
}

fn became_readable(before: &Definition, after: &Definition) -> bool {
    before.text().is_none() && after.text().is_some()
}

/// Whether the two extractions reached a different verdict on what their login sees: another
/// level or coverage, or a profile on one side only, as when a 1.0 file is refreshed. A code
/// coverage counts only when both sides judged it, so the first capture that reads code is no
/// change of access.
pub(super) fn access_changed(previous: &SchemaSnapshot, current: &SchemaSnapshot) -> bool {
    match (previous.access.as_ref(), current.access.as_ref()) {
        (None, None) => false,
        (Some(before), Some(after)) => {
            before.level != after.level
                || before.coverage.objects != after.coverage.objects
                || before.coverage.definitions != after.coverage.definitions
                || code_coverage_differs(
                    before.coverage.programmability,
                    after.coverage.programmability,
                )
                || code_coverage_differs(
                    before.coverage.module_definitions,
                    after.coverage.module_definitions,
                )
        }
        (Some(_), None) | (None, Some(_)) => true,
    }
}

/// Whether both captures judged a coverage of code and reached another verdict.
fn code_coverage_differs(before: Option<Completeness>, after: Option<Completeness>) -> bool {
    matches!((before, after), (Some(before), Some(after)) if before != after)
}

/// The families of facts `current` records for objects that `previous` holds without them. An
/// object only one side holds is an addition or a removal, never a newly recorded fact.
pub(super) fn capture_changes(
    previous: &SchemaSnapshot,
    current: &SchemaSnapshot,
) -> Vec<CaptureChange> {
    let count = newly_recorded_states(previous, current);
    let mut changes = Vec::new();
    if count != 0 {
        changes.push(CaptureChange::IndexAndConstraintStateRecorded { count });
    }
    let before = previous.programmability.as_ref();
    let Some(after) = current.programmability.as_ref() else {
        return changes;
    };
    if !before.is_some_and(crate::model::Programmability::records_objects)
        && after.capture.objects == CaptureState::Read
    {
        changes.push(CaptureChange::ProgrammabilityRecorded {
            counts: CodeCounts::of(after),
        });
    } else if let Some(before) = before.filter(|before| before.records_objects())
        && after.capture.objects.is_left_out()
    {
        changes.push(CaptureChange::ProgrammabilityNoLongerRecorded {
            counts: CodeCounts::of(before),
        });
    }
    if !before.is_some_and(crate::model::Programmability::records_texts)
        && after.capture.definitions == CaptureState::Read
    {
        changes.push(CaptureChange::ModuleDefinitionsRecorded {
            count: readable_texts(after),
        });
    } else if let Some(before) = before.filter(|before| before.records_texts())
        && (after.capture.definitions.is_left_out() || after.capture.objects.is_left_out())
    {
        changes.push(CaptureChange::ModuleDefinitionsNoLongerRecorded {
            count: readable_texts(before),
        });
    }
    changes
}

/// Whether the state of `index` was recorded: a capture records the three fields together.
fn index_state_recorded(index: &Index) -> bool {
    index.is_enabled.is_some() || index.is_filtered.is_some() || index.included_columns.is_some()
}

/// 1 when a state `before` did not record is recorded `after`, 0 otherwise.
fn newly(before: bool, after: bool) -> usize {
    usize::from(!before && after)
}

/// How many indexes, primary keys, `CHECK` constraints and foreign keys of both snapshots have a
/// state `current` recorded and `previous` did not.
fn newly_recorded_states(previous: &SchemaSnapshot, current: &SchemaSnapshot) -> usize {
    let in_tables: usize = pair_by_key(&previous.tables, &current.tables, |table| &table.name)
        .into_iter()
        .map(|pairing| match pairing {
            Pairing::Both { previous, current } => newly_recorded_in_table(previous, current),
            Pairing::Added(_) | Pairing::Removed(_) => 0,
        })
        .sum();

    // A key is the same key whether its referenced table is visible or not.
    let trust_before: BTreeMap<KeyIdentity<'_>, bool> = key_trust(previous).collect();
    let in_keys: usize = key_trust(current)
        .map(|(identity, after)| {
            trust_before
                .get(&identity)
                .map_or(0, |before| newly(*before, after))
        })
        .sum();

    in_tables + in_keys
}

fn newly_recorded_in_table(previous: &Table, current: &Table) -> usize {
    let primary_key = match (&previous.primary_key, &current.primary_key) {
        (Some(before), Some(after)) => {
            newly(before.is_enabled.is_some(), after.is_enabled.is_some())
        }
        _ => 0,
    };
    let indexes: usize = pair_by_key(&previous.indexes, &current.indexes, |index| {
        index.name.as_str()
    })
    .into_iter()
    .map(|pairing| match pairing {
        Pairing::Both { previous, current } => newly(
            index_state_recorded(previous),
            index_state_recorded(current),
        ),
        Pairing::Added(_) | Pairing::Removed(_) => 0,
    })
    .sum();
    let checks: usize = pair_by_key(
        &previous.check_constraints,
        &current.check_constraints,
        |constraint| constraint.name.as_str(),
    )
    .into_iter()
    .map(|pairing| match pairing {
        Pairing::Both { previous, current } => {
            newly(previous.is_trusted.is_some(), current.is_trusted.is_some())
        }
        Pairing::Added(_) | Pairing::Removed(_) => 0,
    })
    .sum();
    primary_key + indexes + checks
}

/// Every foreign key of `snapshot`, to a visible table or not, with whether its trust was recorded.
fn key_trust(snapshot: &SchemaSnapshot) -> impl Iterator<Item = (KeyIdentity<'_>, bool)> {
    let visible = snapshot.foreign_keys.iter().map(|key| {
        (
            (&key.referencing_table, key.name.as_str()),
            key.is_trusted.is_some(),
        )
    });
    let invisible = snapshot.foreign_keys_to_invisible_tables.iter().map(|key| {
        (
            (&key.referencing_table, key.name.as_str()),
            key.is_trusted.is_some(),
        )
    });
    visible.chain(invisible)
}
