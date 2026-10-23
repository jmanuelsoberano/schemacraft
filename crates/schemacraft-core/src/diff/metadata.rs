//! Refresh review of independently observed dependency and native engine metadata.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::comparison::{
    ComparisonObjectRef, ComparisonProperty, ComparisonResultKind, compare_snapshots,
};
use crate::model::{
    CaptureScope, CaptureState, Completeness, DependencyEdge, DependencyObjectRef,
    DependencySnapshot, DependencySource, NotReadReason, SchemaSnapshot, compare_dependency_edges,
};

/// Catalog-reference differences for one source; raw external destination identifiers stay out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct DependencySourceChange {
    /// Captured owner of the references.
    pub object: DependencyObjectRef,
    /// Observed references newly present compared with a previously complete source list.
    pub added: usize,
    /// Observed references absent from a newly complete source list.
    pub removed: usize,
}

/// One native engine object's property outcomes, separate from common relational properties.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct NativeMetadataChange {
    /// Logical native-property owner.
    pub object: ComparisonObjectRef,
    /// Changed or unchecked native facts, never module source.
    pub properties: Vec<ComparisonProperty>,
}

/// Dependency capture changes are reviewed separately from confirmed database differences.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
#[allow(clippy::struct_excessive_bools)] // Independent review facts may occur together.
pub struct DependencyRefreshDiff {
    /// Only sources observed completely and freshly on both sides contribute changes.
    pub changes: Vec<DependencySourceChange>,
    /// First successful read of this family, not a database addition.
    pub newly_recorded: bool,
    /// Sources now complete whose old evidence was absent, partial or historical.
    pub newly_available_sources: usize,
    /// The user explicitly disabled dependency capture; any removal is from the project.
    pub excluded: bool,
    /// The selected source scope changed; excluded references are not database deletions.
    pub scope_changed: bool,
    /// Capture outcome changed, including an unrecorded old family.
    pub capture_changed: bool,
    /// Current optional-read state, or no recorded family.
    pub capture: Option<CaptureState>,
    /// In-scope historical sources the fresh read could not verify, with original dates.
    pub not_checked: Vec<DependencySource>,
    /// Permission failure, query failure or timeout, independently of other captured families.
    pub read_failure: Option<NotReadReason>,
}

impl DependencyRefreshDiff {
    fn has_review(&self) -> bool {
        !self.changes.is_empty()
            || self.newly_recorded
            || self.newly_available_sources != 0
            || self.excluded
            || self.scope_changed
            || self.capture_changed
            || !self.not_checked.is_empty()
            || self.read_failure.is_some()
    }
}

/// Review of new metadata families; default keeps older previews/IPC callers compatible.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "diff/")]
pub struct RefreshMetadataDiff {
    /// Independent catalog-reference evidence.
    pub dependencies: DependencyRefreshDiff,
    /// Native properties whose observed values differ.
    pub native_changes: Vec<NativeMetadataChange>,
    /// Native properties with unavailable or historical observations.
    pub native_not_checked: Vec<NativeMetadataChange>,
    /// Native engine facts became recorded; not a database change.
    pub native_recorded: bool,
}

impl RefreshMetadataDiff {
    /// Whether an understood, observed database fact differs.
    pub fn has_object_changes(&self) -> bool {
        !self.dependencies.changes.is_empty() || !self.native_changes.is_empty()
    }

    /// Whether the refresh must offer a review even with no confirmed object difference.
    pub fn has_review(&self) -> bool {
        self.dependencies.has_review()
            || !self.native_changes.is_empty()
            || !self.native_not_checked.is_empty()
            || self.native_recorded
    }
}

fn source_in_scope(
    source: &DependencyObjectRef,
    scope: &CaptureScope,
    previous: &SchemaSnapshot,
) -> bool {
    scope.includes_schema(source.schema())
        && match source {
            DependencyObjectRef::Table { .. } => true,
            DependencyObjectRef::View { .. } => scope.include_views,
            DependencyObjectRef::Routine { .. } => scope.include_programmability,
            DependencyObjectRef::Trigger { parent, .. } => {
                scope.include_programmability
                    && (scope.include_views
                        || !previous.views.iter().any(|view| &view.name == parent))
            }
        }
}

fn edges_of<'a>(
    snapshot: &'a DependencySnapshot,
    source: &DependencyObjectRef,
) -> Vec<&'a DependencyEdge> {
    snapshot
        .edges
        .iter()
        .filter(|edge| &edge.source == source)
        .collect()
}

fn fresh_complete(source: &DependencySource) -> bool {
    source.coverage == Completeness::Complete && !source.retained
}

fn source_absent(snapshot: &SchemaSnapshot, source: &DependencyObjectRef) -> bool {
    let Some(access) = &snapshot.access else {
        return false;
    };
    match source {
        DependencyObjectRef::Table { name } => {
            snapshot.table(name).is_none() && access.lists_every_object_in(&name.schema)
        }
        DependencyObjectRef::View { name } => {
            access.scope.include_views
                && !snapshot.views.iter().any(|view| &view.name == name)
                && access.lists_every_object_in(&name.schema)
        }
        DependencyObjectRef::Routine {
            name,
            identity_arguments,
        } => {
            access.scope.include_programmability
                && access.lists_every_programmable_object_in(&name.schema)
                && snapshot.programmability.as_ref().is_some_and(|code| {
                    code.capture.objects == CaptureState::Read
                        && !code.routines.iter().any(|routine| {
                            &routine.name == name
                                && &routine.identity_arguments == identity_arguments
                        })
                })
        }
        DependencyObjectRef::Trigger { parent, name } => {
            // The caller excludes view-owned sources through source_in_scope. A table's
            // trigger list remains verifiable even when capturing views is disabled.
            let parent_retained = snapshot.carried_over.iter().any(|item| {
                &item.object == parent
                    && matches!(
                        item.fact,
                        crate::model::SnapshotFact::Table | crate::model::SnapshotFact::View
                    )
            });
            access.scope.include_programmability
                && !parent_retained
                && snapshot.programmability.as_ref().is_some_and(|code| {
                    code.capture.objects == CaptureState::Read
                        && !code
                            .triggers
                            .iter()
                            .any(|trigger| &trigger.parent == parent && &trigger.name == name)
                })
                && (snapshot.table(parent).is_some()
                    || snapshot.views.iter().any(|view| &view.name == parent)
                    || access.lists_every_object_in(&parent.schema))
        }
    }
}

fn dependencies(previous: &SchemaSnapshot, current: &SchemaSnapshot) -> DependencyRefreshDiff {
    let before = previous.dependencies.as_ref();
    let after = current.dependencies.as_ref();
    let mut result = DependencyRefreshDiff {
        capture: after.map(|family| family.capture.clone()),
        capture_changed: before.map(|family| (&family.capture, &family.limitations))
            != after.map(|family| (&family.capture, &family.limitations)),
        ..DependencyRefreshDiff::default()
    };
    let Some(after) = after else {
        if let Some(before) = before {
            result.not_checked.clone_from(&before.sources);
        }
        return result;
    };
    result.excluded =
        after.capture.is_left_out() && before.is_none_or(|family| !family.capture.is_left_out());
    if result.excluded {
        return result;
    }
    result.read_failure = match &after.capture {
        CaptureState::NotRead {
            reason:
                reason @ (NotReadReason::PermissionDenied
                | NotReadReason::QueryFailed
                | NotReadReason::TimedOut),
        } => Some(*reason),
        CaptureState::Read | CaptureState::Unknown | CaptureState::NotRead { .. } => None,
    };
    let before_read = before.is_some_and(|family| family.capture == CaptureState::Read);
    result.newly_recorded = !before_read
        && after.capture == CaptureState::Read
        && before.is_none_or(|family| family.sources.is_empty());
    result.scope_changed = before.is_some_and(|family| family.scope != after.scope);
    if let Some(before) = before {
        review_existing_dependency_sources(previous, current, before, after, &mut result);
    }
    review_new_dependency_sources(before, after, &mut result);
    result
        .not_checked
        .sort_by(|left, right| left.object.cmp(&right.object));
    result
        .changes
        .sort_by(|left, right| left.object.cmp(&right.object));
    result
}

fn review_existing_dependency_sources(
    previous: &SchemaSnapshot,
    current: &SchemaSnapshot,
    before: &DependencySnapshot,
    after: &DependencySnapshot,
    result: &mut DependencyRefreshDiff,
) {
    let after_sources: BTreeMap<_, _> = after
        .sources
        .iter()
        .map(|source| (&source.object, source))
        .collect();
    for old_source in &before.sources {
        let object = &old_source.object;
        if !source_in_scope(object, &after.scope, previous) {
            continue;
        }
        let Some(new_source) = after_sources.get(object).copied() else {
            if after.capture == CaptureState::Read
                && fresh_complete(old_source)
                && source_absent(current, object)
            {
                // Confirmed source removal also removes all of its known catalog rows,
                // independently of whether their destinations were navigable.
                let removed = before
                    .edges
                    .iter()
                    .filter(|edge| &edge.source == object)
                    .count();
                if removed != 0 {
                    result.changes.push(DependencySourceChange {
                        object: object.clone(),
                        added: 0,
                        removed,
                    });
                }
            } else {
                let mut retained = old_source.clone();
                retained.retained = true;
                result.not_checked.push(retained);
            }
            continue;
        };
        if after.capture != CaptureState::Read || !fresh_complete(new_source) {
            let mut retained = old_source.clone();
            retained.retained = true;
            result.not_checked.push(retained);
            continue;
        }
        if !fresh_complete(old_source) || before.capture != CaptureState::Read {
            result.newly_available_sources += 1;
            continue;
        }
        let topology =
            compare_dependency_edges(&edges_of(before, object), &edges_of(after, object));
        if topology.unidentified_targets_changed {
            let mut retained = old_source.clone();
            retained.retained = true;
            result.not_checked.push(retained);
        }
        if topology.added != 0 || topology.removed != 0 {
            result.changes.push(DependencySourceChange {
                object: object.clone(),
                added: topology.added,
                removed: topology.removed,
            });
        }
    }
}

fn review_new_dependency_sources(
    before: Option<&DependencySnapshot>,
    after: &DependencySnapshot,
    result: &mut DependencyRefreshDiff,
) {
    if !result.newly_recorded {
        result.newly_available_sources += after
            .sources
            .iter()
            .filter(|source| {
                fresh_complete(source)
                    && before.is_none_or(|family| {
                        !family.sources.iter().any(|old| old.object == source.object)
                    })
            })
            .count();
    }
    for source in after
        .sources
        .iter()
        .filter(|source| !fresh_complete(source))
    {
        if !result
            .not_checked
            .iter()
            .any(|item| item.object == source.object)
        {
            result.not_checked.push(source.clone());
        }
    }
}

pub(super) fn between(
    previous: &SchemaSnapshot,
    current: &SchemaSnapshot,
    merged: &SchemaSnapshot,
) -> RefreshMetadataDiff {
    let mut result = RefreshMetadataDiff {
        dependencies: dependencies(previous, current),
        native_recorded: previous.postgresql.is_none() && current.postgresql.is_some(),
        ..RefreshMetadataDiff::default()
    };
    if previous.postgresql.is_none() || current.postgresql.is_none() {
        return result;
    }
    if let Ok(comparison) = compare_snapshots(previous, merged) {
        for item in comparison.items {
            let (changes, unchecked): (Vec<_>, Vec<_>) = item
                .properties
                .into_iter()
                .filter(|property| {
                    property
                        .path
                        .first()
                        .is_some_and(|part| part == "postgresql")
                })
                .partition(|property| property.result == ComparisonResultKind::Different);
            if !changes.is_empty() {
                result.native_changes.push(NativeMetadataChange {
                    object: item.object.clone(),
                    properties: changes,
                });
            }
            if !unchecked.is_empty() {
                result.native_not_checked.push(NativeMetadataChange {
                    object: item.object,
                    properties: unchecked,
                });
            }
        }
    }
    result
}
