//! What a refresh learns about the schema without the schema changing: texts that became
//! readable, keys whose referenced table became visible, facts a 1.0 file could not record, and
//! a different verdict on what the login sees. None of it is a change of the database, yet the
//! project must record it.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::foreign_keys::KeyIdentity;
use super::pairing::{Pairing, pair_by_key};
use crate::model::{Definition, QualifiedName, SchemaSnapshot, SnapshotFact, Table};

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
/// level or coverage, or a profile on one side only, as when a 1.0 file is refreshed.
pub(super) fn access_changed(previous: &SchemaSnapshot, current: &SchemaSnapshot) -> bool {
    let verdict = |snapshot: &SchemaSnapshot| {
        snapshot
            .access
            .as_ref()
            .map(|profile| (profile.level, profile.coverage))
    };
    verdict(previous) != verdict(current)
}
