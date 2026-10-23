//! User-authored maps and explanations, separate from captured database facts.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::CanvasState;
use crate::model::{QualifiedName, SchemaSnapshot, UnknownFields};

/// A named, independent arrangement of the project's single snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub struct SavedPerspective {
    /// Stable opaque identity; the display name may change.
    pub id: String,
    /// User-visible name, never an identity or a translated system value.
    pub name: String,
    /// User-written plain text, never HTML or observed database documentation.
    #[serde(default)]
    pub description: Option<String>,
    /// Positions, visibility and presentation belonging only to this map.
    pub canvas: CanvasState,
    /// Extensions survive a save but never enter exports implicitly.
    #[serde(flatten)]
    #[ts(skip)]
    pub unknown: UnknownFields,
}

/// Logical target of a shared note. Names are structured, not split on punctuation.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub enum NoteTarget {
    /// A base table; a view of the same name is not an interchangeable target.
    Table {
        /// Structured identity of the base table.
        table: QualifiedName,
    },
    /// A named column of a base table.
    Column {
        /// Structured identity of the parent base table.
        table: QualifiedName,
        /// Literal column name, including any punctuation.
        column: String,
    },
}

impl NoteTarget {
    /// Whether this logical target is present in the effective snapshot.
    /// This proves neither physical identity nor continuity between captures.
    pub fn exists_in(&self, snapshot: &SchemaSnapshot) -> bool {
        match self {
            Self::Table { table } => snapshot.table(table).is_some(),
            Self::Column { table, column } => snapshot
                .table(table)
                .is_some_and(|table| table.columns.iter().any(|item| &item.name == column)),
        }
    }
}

/// One explanation shared wherever its target appears, including after unlinking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub struct ProjectNote {
    /// Stable identity, including when the original target disappears.
    pub id: String,
    /// Current target, or the former target when `isLinked` is false.
    pub target: NoteTarget,
    /// Literal user-written text.
    pub text: String,
    /// False after an observed removal; a reused name never relinks this note.
    pub is_linked: bool,
    /// Extensions written by newer readers.
    #[serde(flatten)]
    #[ts(skip)]
    pub unknown: UnknownFields,
}

/// Editable explanations; refresh never replaces this family with database facts.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "project/")]
pub struct ProjectAnnotations {
    /// At most one linked note per target; any number of historical unlinked notes.
    #[serde(default)]
    pub notes: Vec<ProjectNote>,
    /// Extensions written by newer readers.
    #[serde(flatten)]
    #[ts(skip)]
    pub unknown: UnknownFields,
}

impl ProjectAnnotations {
    /// Whether omitting this optional family loses nothing, including future extensions.
    pub fn is_empty(&self) -> bool {
        self.notes.is_empty() && self.unknown.is_empty()
    }

    /// Unlinks only missing effective targets. Retained objects remain valid targets.
    #[must_use]
    pub fn reconciled(mut self, snapshot: &SchemaSnapshot) -> Self {
        for note in &mut self.notes {
            if note.is_linked && !note.target.exists_in(snapshot) {
                note.is_linked = false;
            }
        }
        self
    }

    /// Stable output while retaining user text and all unknown fields verbatim.
    #[must_use]
    pub fn normalized(mut self) -> Self {
        self.notes.sort_by(|left, right| left.id.cmp(&right.id));
        self
    }
}

/// Closed validation messages contain no note content or object names.
pub(super) fn validate(
    perspectives: &[SavedPerspective],
    annotations: &ProjectAnnotations,
    snapshot: &SchemaSnapshot,
) -> Result<(), &'static str> {
    let mut ids = BTreeSet::new();
    for perspective in perspectives {
        if perspective.id.trim().is_empty()
            || perspective.name.trim().is_empty()
            || !ids.insert(&perspective.id)
        {
            return Err("perspective identities and names must be nonempty and identities unique");
        }
    }
    let mut ids = BTreeSet::new();
    let mut targets = BTreeSet::new();
    for note in &annotations.notes {
        if note.id.trim().is_empty() || !ids.insert(&note.id) || note.text.is_empty() {
            return Err("note identities and text must be nonempty and identities unique");
        }
        if note.is_linked && (!note.target.exists_in(snapshot) || !targets.insert(&note.target)) {
            return Err("linked notes must have distinct existing targets");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;
    use crate::model::test_fixtures::sample_snapshot;

    fn note(target: NoteTarget) -> ProjectNote {
        ProjectNote {
            id: "note-1".into(),
            target,
            text: "An explanation <script> remains literal text.".into(),
            is_linked: true,
            unknown: UnknownFields::new(),
        }
    }

    #[test]
    fn removal_preserves_text_and_a_reused_name_does_not_relink_it() {
        let snapshot = sample_snapshot();
        let name = snapshot.tables[0].name.clone();
        let annotations = ProjectAnnotations {
            notes: vec![note(NoteTarget::Table {
                table: name.clone(),
            })],
            ..ProjectAnnotations::default()
        };
        let mut removed = snapshot.clone();
        removed.tables.retain(|table| table.name != name);
        let unlinked = annotations.reconciled(&removed);
        assert!(!unlinked.notes[0].is_linked);
        assert_eq!(
            unlinked.notes[0].text,
            "An explanation <script> remains literal text."
        );
        assert!(!unlinked.reconciled(&snapshot).notes[0].is_linked);
    }

    #[test]
    fn table_notes_never_attach_to_a_homonymous_view() {
        let mut snapshot = sample_snapshot();
        let name = snapshot.views[0].name.clone();
        snapshot.tables.retain(|table| table.name != name);
        assert!(!NoteTarget::Table { table: name }.exists_in(&snapshot));
    }

    #[test]
    fn duplicate_linked_targets_are_rejected_but_archived_notes_are_allowed() {
        let snapshot = sample_snapshot();
        let first = note(NoteTarget::Table {
            table: snapshot.tables[0].name.clone(),
        });
        let mut second = first.clone();
        second.id = "note-2".into();
        let mut annotations = ProjectAnnotations {
            notes: vec![first, second],
            ..Default::default()
        };
        assert!(validate(&[], &annotations, &snapshot).is_err());
        annotations.notes[1].is_linked = false;
        assert!(validate(&[], &annotations, &snapshot).is_ok());
    }

    #[test]
    fn structured_dotted_targets_and_unknown_extensions_round_trip() {
        let mut first = note(NoteTarget::Column {
            table: QualifiedName::new("a.b", "c"),
            column: "d.e".into(),
        });
        first
            .unknown
            .insert("future".into(), serde_json::json!({"keep": true}));
        let other = NoteTarget::Column {
            table: QualifiedName::new("a", "b.c"),
            column: "d.e".into(),
        };
        assert_ne!(first.target, other);
        let bytes = serde_json::to_string(&first).unwrap();
        assert_eq!(serde_json::from_str::<ProjectNote>(&bytes).unwrap(), first);
    }
}
