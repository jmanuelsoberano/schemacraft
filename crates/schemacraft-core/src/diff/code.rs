//! Code comparison and its IPC-only review contract.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::ChangeKind;
use crate::model::{
    CaptureState, CarriedCode, CarriedPart, CodeObjectRef, Column, Definition, DmlEvent,
    FiringOrder, ModuleBody, NotReadReason, Programmability, Routine, RoutineKind, SchemaSnapshot,
    SnapshotFact, Trigger, TriggerTiming, ViewModule,
};

/// What differs in the code of two snapshots, and what the fresh one could or could not check.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct CodeDiff {
    /// Optional reads that failed, even when there was no saved code to retain.
    pub read_failures: Vec<CodeReadFailure>,
    /// Code objects that appeared, disappeared or changed: views, then procedures and
    /// functions, then triggers, each by name.
    pub changes: Vec<CodeChange>,
    /// Code kept from the saved snapshot because the fresh extraction could not check it, with
    /// the moment each item was last read. It is neither removed nor changed.
    pub not_checked: Vec<CarriedCode>,
    /// Code the saved snapshot could not state and the fresh extraction reads, such as a
    /// procedure that a stronger login sees or a text that became readable. It is not a change
    /// of the database.
    pub now_available: Vec<AvailableCode>,
}

/// The independently read code family that could not be checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum CodeReadFamily {
    /// View modules, routines, parameters and triggers.
    Objects,
    /// SQL module texts.
    Definitions,
}

/// A failed observation, separate from permission gaps and database changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct CodeReadFailure {
    /// The family that failed.
    pub family: CodeReadFamily,
    /// A failed query or timeout; never an explicit opt-out.
    pub reason: NotReadReason,
}

impl CodeDiff {
    /// Whether no code object appeared, disappeared or changed.
    pub fn is_empty(&self) -> bool {
        self.changes.is_empty()
    }
}

/// A change of a code object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum CodeChange {
    /// An object that only exists in the current snapshot.
    #[serde(rename_all = "camelCase")]
    Added {
        /// The object.
        object: CodeObjectRef,
        /// Procedure or kind of function, for a routine.
        routine_kind: Option<RoutineKind>,
    },
    /// An object that only exists in the previous snapshot.
    #[serde(rename_all = "camelCase")]
    Removed {
        /// The object.
        object: CodeObjectRef,
        /// Procedure or kind of function it was, for a routine.
        routine_kind: Option<RoutineKind>,
    },
    /// An object in both snapshots with differences.
    #[serde(rename_all = "camelCase")]
    Changed {
        /// The object.
        object: CodeObjectRef,
        /// Procedure or kind of function it is now, for a routine.
        routine_kind: Option<RoutineKind>,
        /// What differs, in the order of [`CodeProperty`].
        properties: Vec<CodeProperty>,
    },
}

impl CodeChange {
    /// The object the change refers to.
    pub fn object(&self) -> &CodeObjectRef {
        match self {
            Self::Added { object, .. }
            | Self::Removed { object, .. }
            | Self::Changed { object, .. } => object,
        }
    }

    /// Whether the object appeared, disappeared or changed.
    pub fn kind(&self) -> ChangeKind {
        match self {
            Self::Added { .. } => ChangeKind::Added,
            Self::Removed { .. } => ChangeKind::Removed,
            Self::Changed { .. } => ChangeKind::Changed,
        }
    }
}

/// Part of a code object that can change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub enum CodeProperty {
    /// The text, compared when both are readable, without line-end and edge whitespace.
    Definition,
    /// A readable text became encrypted, or an encrypted one readable.
    Encryption,
    /// The module moved between T-SQL and CLR.
    Implementation,
    /// The parameters of a procedure or function: names, order, types, `OUTPUT` or `READONLY`.
    Parameters,
    /// The type a scalar function returns.
    ReturnType,
    /// The columns of the table a table function returns.
    Columns,
    /// Whether a trigger runs after the statement or instead of it.
    Timing,
    /// The statements that fire a trigger.
    Events,
    /// The order set for a trigger among the others of a statement.
    FiringOrder,
    /// Whether a trigger is enabled.
    Enabled,
    /// Whether a trigger is created `NOT FOR REPLICATION`.
    NotForReplication,
    /// Whether a view is created `WITH CHECK OPTION`.
    CheckOption,
    /// Whether a view has a unique clustered index.
    Indexed,
    /// What a routine is: a procedure or a kind of function.
    Kind,
}

/// Code the previous snapshot could not state and the fresh extraction reads.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct AvailableCode {
    /// The object.
    pub object: CodeObjectRef,
    /// The whole object, or only its text.
    pub part: CarriedPart,
}

/// How many objects of each kind a snapshot records the code of, for a capture line.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct CodeCounts {
    /// Stored procedures.
    pub procedures: usize,
    /// Functions of every kind.
    pub functions: usize,
    /// DML triggers.
    pub triggers: usize,
    /// Views whose code is recorded.
    pub views: usize,
}

impl CodeCounts {
    /// The counts of `code`.
    pub fn of(code: &Programmability) -> Self {
        let procedures = code
            .routines
            .iter()
            .filter(|routine| routine.kind == RoutineKind::Procedure)
            .count();
        Self {
            procedures,
            functions: code.routines.len() - procedures,
            triggers: code.triggers.len(),
            views: code.views.len(),
        }
    }
}

/// Readable module texts of `code`.
pub(super) fn readable_texts(code: &Programmability) -> usize {
    code.module_definitions()
        .filter(|definition| definition.text().is_some())
        .count()
}

/// Compares facts only after carry-over has resolved what the fresh read could not check.
pub(super) fn diff_code(previous: &SchemaSnapshot, merged: &SchemaSnapshot) -> CodeDiff {
    let mut result = CodeDiff {
        not_checked: merged
            .programmability
            .as_ref()
            .map(|code| code.carried_over.clone())
            .unwrap_or_default(),
        ..CodeDiff::default()
    };
    if let Some(code) = &merged.programmability {
        for (family, state) in [
            (CodeReadFamily::Objects, &code.capture.objects),
            (CodeReadFamily::Definitions, &code.capture.definitions),
        ] {
            if let CaptureState::NotRead {
                reason: reason @ (NotReadReason::QueryFailed | NotReadReason::TimedOut),
            } = state
            {
                result.read_failures.push(CodeReadFailure {
                    family,
                    reason: *reason,
                });
                // A metadata failure prevents the dependent text read too: report its cause once.
                if family == CodeReadFamily::Objects {
                    break;
                }
            }
        }
    }
    let (Some(before), Some(after)) = (&previous.programmability, &merged.programmability) else {
        return result;
    };
    if !before.records_objects() || !after.records_objects() {
        return result;
    }
    let before_items = items(before);
    let after_items = items(after);
    let keys: BTreeSet<_> = before_items.keys().chain(after_items.keys()).collect();
    let compare_texts = before.records_texts() && after.records_texts();
    for key in keys {
        match (before_items.get(key), after_items.get(key)) {
            (Some(left), Some(right)) => {
                let mut properties = left.properties(right);
                if !compare_texts {
                    properties.retain(|property| {
                        !matches!(
                            property,
                            CodeProperty::Definition | CodeProperty::Encryption
                        )
                    });
                }
                if !properties.is_empty() {
                    result.changes.push(CodeChange::Changed {
                        object: key.clone(),
                        routine_kind: right.routine_kind(),
                        properties,
                    });
                }
                if compare_texts
                    && matches!((left.definition(), right.definition()),
                    (Some(left), Some(right)) if became_readable(left, right))
                {
                    result.now_available.push(AvailableCode {
                        object: key.clone(),
                        part: CarriedPart::Definition,
                    });
                }
            }
            (None, Some(right)) if !matches!(key, CodeObjectRef::View { .. }) => {
                if vouched_for(previous, before, key) {
                    result.changes.push(CodeChange::Added {
                        object: key.clone(),
                        routine_kind: right.routine_kind(),
                    });
                } else {
                    result.now_available.push(AvailableCode {
                        object: key.clone(),
                        part: CarriedPart::Whole,
                    });
                }
            }
            (Some(left), None) if !matches!(key, CodeObjectRef::View { .. }) => {
                result.changes.push(CodeChange::Removed {
                    object: key.clone(),
                    routine_kind: left.routine_kind(),
                });
            }
            _ => {}
        }
    }
    result
}

enum CodeItem<'a> {
    View(&'a ViewModule),
    Routine(&'a Routine),
    Trigger(&'a Trigger),
}

fn items(code: &Programmability) -> BTreeMap<CodeObjectRef, CodeItem<'_>> {
    code.views
        .iter()
        .map(|item| (item.object_ref(), CodeItem::View(item)))
        .chain(
            code.routines
                .iter()
                .map(|item| (item.object_ref(), CodeItem::Routine(item))),
        )
        .chain(
            code.triggers
                .iter()
                .map(|item| (item.object_ref(), CodeItem::Trigger(item))),
        )
        .collect()
}

impl CodeItem<'_> {
    fn properties(&self, other: &Self) -> Vec<CodeProperty> {
        match (self, other) {
            (Self::View(left), Self::View(right)) => view_properties(left, right),
            (Self::Routine(left), Self::Routine(right)) => routine_properties(left, right),
            (Self::Trigger(left), Self::Trigger(right)) => trigger_properties(left, right),
            _ => Vec::new(),
        }
    }

    fn routine_kind(&self) -> Option<RoutineKind> {
        match self {
            Self::Routine(item) => Some(item.kind),
            _ => None,
        }
    }

    fn definition(&self) -> Option<&Definition> {
        match self {
            Self::View(item) => Some(&item.definition),
            Self::Routine(item) => item.body.definition(),
            Self::Trigger(item) => item.body.definition(),
        }
    }
}

fn vouched_for(snapshot: &SchemaSnapshot, code: &Programmability, object: &CodeObjectRef) -> bool {
    if code.capture.objects != CaptureState::Read {
        return false;
    }
    match object {
        CodeObjectRef::Routine { name } => snapshot.access.as_ref().is_none_or(|access| {
            access.scope.include_programmability
                && access.scope.includes_schema(&name.schema)
                && access.lists_every_programmable_object_in(&name.schema)
        }),
        CodeObjectRef::Trigger { parent, .. } => {
            let in_scope = snapshot.access.as_ref().is_none_or(|access| {
                access.scope.include_programmability
                    && access.scope.includes_schema(&parent.schema)
                    && (access.scope.include_views
                        || !snapshot.views.iter().any(|view| &view.name == parent))
            });
            let held = snapshot.table(parent).is_some()
                || snapshot.views.iter().any(|view| &view.name == parent);
            in_scope
                && if held {
                    !snapshot.carried_over.iter().any(|item| {
                        &item.object == parent
                            && matches!(item.fact, SnapshotFact::Table | SnapshotFact::View)
                    })
                } else {
                    snapshot.vouches_for_absence_of(parent)
                }
        }
        CodeObjectRef::View { .. } | CodeObjectRef::Unknown => false,
    }
}

/// The text of `text` as the comparison sees it: line ends made LF, spaces and tabs at the end of
/// each line trimmed, and blank lines before and after the code dropped. Scripts that re-create a
/// module with other line ends or trailing blanks change nothing.
pub fn comparable_text(text: &str) -> Cow<'_, str> {
    let needs_work = text.contains('\r')
        || text.starts_with('\n')
        || text.ends_with(['\n', ' ', '\t'])
        || text.contains(" \n")
        || text.contains("\t\n");
    if !needs_work {
        return Cow::Borrowed(text);
    }
    let unified = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = unified
        .split('\n')
        .map(|line| line.trim_end_matches([' ', '\t']))
        .collect();
    let first = lines.iter().position(|line| !line.is_empty());
    let last = lines.iter().rposition(|line| !line.is_empty());
    match (first, last) {
        (Some(first), Some(last)) => {
            Cow::Owned(lines.get(first..=last).unwrap_or_default().join("\n"))
        }
        _ => Cow::Owned(String::new()),
    }
}

/// Whether two texts are both readable and differ beyond line ends and edge whitespace.
fn texts_differ(before: &Definition, after: &Definition) -> bool {
    match (before, after) {
        (Definition::Readable { text: left }, Definition::Readable { text: right }) => {
            left != right && comparable_text(left) != comparable_text(right)
        }
        _ => false,
    }
}

/// Whether a readable text became encrypted, or an encrypted one readable.
fn encryption_changed(before: &Definition, after: &Definition) -> bool {
    matches!(
        (before, after),
        (Definition::Readable { .. }, Definition::Encrypted)
            | (Definition::Encrypted, Definition::Readable { .. })
    )
}

/// Whether a text that could not be read is readable now. An encrypted one that became readable
/// is an encryption change instead.
fn became_readable(before: &Definition, after: &Definition) -> bool {
    before.text().is_none() && *before != Definition::Encrypted && after.text().is_some()
}

/// The language of a body, when this version knows it.
fn language(body: &ModuleBody) -> Option<&'static str> {
    match body {
        ModuleBody::Sql { .. } => Some("sql"),
        ModuleBody::Clr => Some("clr"),
        ModuleBody::Unknown => None,
    }
}

/// The text properties of two bodies: their text, their encryption and their language.
fn body_properties(before: &ModuleBody, after: &ModuleBody) -> [(CodeProperty, bool); 3] {
    let (text, encryption) = match (before.definition(), after.definition()) {
        (Some(before), Some(after)) => (
            texts_differ(before, after),
            encryption_changed(before, after),
        ),
        _ => (false, false),
    };
    let implementation = matches!(
        (language(before), language(after)),
        (Some(left), Some(right)) if left != right
    );
    [
        (CodeProperty::Definition, text),
        (CodeProperty::Encryption, encryption),
        (CodeProperty::Implementation, implementation),
    ]
}

fn chosen(candidates: impl IntoIterator<Item = (CodeProperty, bool)>) -> Vec<CodeProperty> {
    candidates
        .into_iter()
        .filter_map(|(property, differs)| differs.then_some(property))
        .collect()
}

fn view_properties(before: &ViewModule, after: &ViewModule) -> Vec<CodeProperty> {
    chosen([
        (
            CodeProperty::Definition,
            texts_differ(&before.definition, &after.definition),
        ),
        (
            CodeProperty::Encryption,
            encryption_changed(&before.definition, &after.definition),
        ),
        (
            CodeProperty::CheckOption,
            before.has_check_option != after.has_check_option,
        ),
        (CodeProperty::Indexed, before.is_indexed != after.is_indexed),
    ])
}

fn routine_properties(before: &Routine, after: &Routine) -> Vec<CodeProperty> {
    let known_kinds_differ = before.kind != after.kind
        && before.kind != RoutineKind::Unknown
        && after.kind != RoutineKind::Unknown;
    let mut candidates = body_properties(&before.body, &after.body).to_vec();
    candidates.extend([
        (
            CodeProperty::Parameters,
            before.parameters != after.parameters,
        ),
        (CodeProperty::ReturnType, before.returns != after.returns),
        (
            CodeProperty::Columns,
            columns_differ(&before.columns, &after.columns),
        ),
        (CodeProperty::Kind, known_kinds_differ),
    ]);
    chosen(candidates)
}

fn trigger_properties(before: &Trigger, after: &Trigger) -> Vec<CodeProperty> {
    let timings_differ = before.timing != after.timing
        && before.timing != TriggerTiming::Unknown
        && after.timing != TriggerTiming::Unknown;
    let events_before: BTreeSet<DmlEvent> = before.events.iter().map(|event| event.event).collect();
    let events_after: BTreeSet<DmlEvent> = after.events.iter().map(|event| event.event).collect();
    let events_differ = !events_before.contains(&DmlEvent::Unknown)
        && !events_after.contains(&DmlEvent::Unknown)
        && events_before != events_after;
    // The order is per statement: compared for the statements both fire, where both know it.
    let orders_differ = before.events.iter().any(|earlier| {
        after.events.iter().any(|later| {
            earlier.event != DmlEvent::Unknown
                && later.event == earlier.event
                && earlier.order != later.order
                && earlier.order != FiringOrder::Unknown
                && later.order != FiringOrder::Unknown
        })
    });
    let mut candidates = body_properties(&before.body, &after.body).to_vec();
    candidates.extend([
        (CodeProperty::Timing, timings_differ),
        (CodeProperty::Events, events_differ),
        (CodeProperty::FiringOrder, orders_differ),
        (CodeProperty::Enabled, before.is_enabled != after.is_enabled),
        (
            CodeProperty::NotForReplication,
            before.is_not_for_replication != after.is_not_for_replication,
        ),
    ]);
    chosen(candidates)
}

/// Whether the columns of two table functions differ: their names, order, types, nullability,
/// identity and computed flags. Internal defaults belong to the module body.
fn columns_differ(before: &[Column], after: &[Column]) -> bool {
    before.len() != after.len()
        || before.iter().zip(after).any(|(left, right)| {
            left.name != right.name
                || left.ordinal_position != right.ordinal_position
                || left.data_type != right.data_type
                || left.is_nullable != right.is_nullable
                || left.is_identity != right.is_identity
                || left.is_computed != right.is_computed
        })
}

#[cfg(test)]
#[path = "code_tests.rs"]
mod tests;
