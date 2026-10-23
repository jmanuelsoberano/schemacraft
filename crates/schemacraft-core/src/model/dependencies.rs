//! Captured catalog references, independent of foreign keys and module source text.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{CaptureScope, CaptureState, Completeness, QualifiedName, UnknownFields};

/// Logical identity of an inspected dependency endpoint. Names are never dot-split.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "model/")]
pub enum DependencyObjectRef {
    /// Base table.
    Table {
        /// Qualified table identity.
        name: QualifiedName,
    },
    /// View, including its recorded definition references.
    View {
        /// Qualified view identity.
        name: QualifiedName,
    },
    /// Routine; PostgreSQL overloads include their identity argument types.
    Routine {
        /// Qualified routine name.
        name: QualifiedName,
        /// Input type identities; present, including empty, for PostgreSQL overloads.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        identity_arguments: Option<Vec<QualifiedName>>,
    },
    /// DML trigger, identified by its parent and its own name.
    Trigger {
        /// Qualified owning table or view.
        parent: QualifiedName,
        /// Trigger name within its parent.
        name: String,
    },
}

impl DependencyObjectRef {
    /// Schema owning this object (the parent schema for a trigger).
    pub fn schema(&self) -> &str {
        match self {
            Self::Table { name } | Self::View { name } | Self::Routine { name, .. } => &name.schema,
            Self::Trigger { parent, .. } => &parent.schema,
        }
    }
}

/// Why a catalog reference cannot be navigated as an inspected object.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum DependencyReferenceStatus {
    /// Reference names another server or database; never followed automatically.
    External,
    /// Target was excluded by the selected capture scope or object families.
    OutOfScope,
    /// Catalog visibility does not establish the target's identity.
    NotVisible,
    /// Catalog class is outside the inspected set, such as a type or synonym.
    Unsupported,
    /// The catalog cannot resolve this target.
    Unresolved,
    /// Catalog reports more than one possible interpretation.
    Ambiguous,
    /// Resolution depends on the caller's schema or execution context.
    CallerDependent,
    /// A newer reference classification is not understood.
    #[serde(other)]
    Unknown,
}

/// A navigable endpoint or an explicitly qualified, unresolved catalog reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export, export_to = "model/")]
pub enum DependencyTarget {
    /// An object actually included in this snapshot.
    Object {
        /// Inspected endpoint identity.
        object: DependencyObjectRef,
    },
    /// Identifier metadata only; no target capture or extra connection is implied.
    Reference {
        /// Resolution classification reported by this capture.
        status: DependencyReferenceStatus,
        /// Catalog-provided external server; never connected to automatically or exported.
        server: Option<String>,
        /// Catalog-provided external database; never opened automatically or exported.
        database: Option<String>,
        /// Schema when catalog resolution provides it.
        schema: Option<String>,
        /// Referenced entity name, when known.
        name: Option<String>,
        /// Native class such as TYPE or XML_SCHEMA_COLLECTION.
        object_class: Option<String>,
    },
}

/// Relation reported by the engine's dependency catalog; never a foreign key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum DependencyKind {
    /// A catalog-recorded reference from a definition or expression.
    CatalogReference,
    /// A trigger invokes its separately inspected function (PostgreSQL).
    TriggerFunction,
    /// A newer relation kind is not understood.
    #[serde(other)]
    Unknown,
}

/// One known reference, with its own observation date and retained status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct DependencyEdge {
    /// Object containing the reference.
    pub source: DependencyObjectRef,
    /// Captured or unresolved target.
    pub target: DependencyTarget,
    /// Catalog relation, independent of ERD keys.
    pub kind: DependencyKind,
    /// Schema binding, when the engine reports it.
    pub is_schema_bound: Option<bool>,
    /// Last successful observation of this edge.
    pub read_at: DateTime<Utc>,
    /// True when retained because a subsequent read could not verify it.
    #[serde(default)]
    pub retained: bool,
}

impl DependencyEdge {
    /// Private equality key for a catalog edge whose destination identity is established.
    /// Resolution status and observation dates are not database topology. A missing target's
    /// name alone cannot establish its object kind or PostgreSQL overload. The list comparator
    /// treats such an endpoint as uncertain without hiding other established topology changes.
    pub(crate) fn topology_key(&self) -> Option<String> {
        if self.kind == DependencyKind::Unknown {
            return None;
        }
        match &self.target {
            DependencyTarget::Object { object } => {
                serde_json::to_string(&(object, self.kind, self.is_schema_bound)).ok()
            }
            DependencyTarget::Reference {
                status: DependencyReferenceStatus::External | DependencyReferenceStatus::Unsupported,
                server,
                database,
                schema,
                name: Some(name),
                object_class,
            } => serde_json::to_string(&(
                server,
                database,
                schema,
                name,
                object_class,
                self.kind,
                self.is_schema_bound,
            ))
            .ok(),
            DependencyTarget::Reference { .. } => None,
        }
    }
}

/// What the catalog can track inside a PostgreSQL routine, independently of saved source text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum RoutineDependencyTracking {
    /// SQL-standard body was parsed when defined; its known references supplement the signature.
    /// This still does not discover every runtime or dynamic reference.
    ParsedSqlBody,
    /// The signature is tracked, but the text/PL/native implementation body is not analyzed.
    SignatureOnly,
    /// A newer tracking classification this reader does not understand.
    #[serde(other)]
    Unknown,
}

/// Coverage of the catalog rows for a captured source, not all runtime references.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct DependencySource {
    /// Source whose catalog reference list was inspected.
    pub object: DependencyObjectRef,
    /// Whether that catalog list was observed completely.
    pub coverage: Completeness,
    /// PostgreSQL routine-body tracking evidence; absent means not recorded for a routine,
    /// and does not apply to other source kinds or engines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub routine_body_tracking: Option<RoutineDependencyTracking>,
    /// Last successful inspection of the source's reference list.
    pub read_at: DateTime<Utc>,
    /// Historical evidence retained after an unsuccessful observation.
    #[serde(default)]
    pub retained: bool,
}

/// Inherent or observed limitation of dependency discovery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub enum DependencyLimitation {
    /// Catalogs do not discover dynamic SQL or application code references.
    RuntimeReferencesNotTracked,
    /// Catalog access permissions were insufficient.
    PermissionLimited,
    /// One or more targets are outside the inspected class set.
    UnsupportedTargets,
    /// One or more target identities are unresolved or external.
    UnresolvedTargets,
    /// PostgreSQL does not track every reference in a routine's string body.
    RoutineBodiesNotFullyTracked,
    /// Newer limitation code not understood by this reader.
    #[serde(other)]
    Unknown,
}

/// Independently captured dependency family. Missing family means unrecorded, never empty.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "model/")]
pub struct DependencySnapshot {
    /// Whether the optional catalog read succeeded or was deliberately disabled.
    pub capture: CaptureState,
    /// Selected source schemas and object families.
    pub scope: CaptureScope,
    /// Attempt completion time; retained rows keep their own earlier read dates.
    pub observed_at: DateTime<Utc>,
    /// Sources observed, including sources with zero catalog rows.
    pub sources: Vec<DependencySource>,
    /// Known references only, not an exhaustive runtime impact graph.
    pub edges: Vec<DependencyEdge>,
    /// Explicit limitations shown alongside graph and export.
    pub limitations: Vec<DependencyLimitation>,
    /// Unrecognized extension keys round-trip without entering reports.
    #[serde(flatten)]
    #[ts(skip)]
    pub unknown: UnknownFields,
}

impl super::SchemaSnapshot {
    /// Keeps historical reference lists only when this capture could not verify them.
    /// Explicitly disabled capture and excluded source families deliberately remove them.
    pub(super) fn keep_unchecked_dependencies(&mut self, previous: &Self) {
        if self.provider != previous.provider {
            return;
        }
        let Some(saved) = &previous.dependencies else {
            return;
        };
        let existing: std::collections::BTreeSet<_> = saved
            .sources
            .iter()
            .filter(|source| dependency_object_exists(self, &source.object))
            .map(|source| source.object.clone())
            .collect();
        let Some(current) = &mut self.dependencies else {
            return;
        };
        if matches!(
            current.capture,
            CaptureState::NotRead {
                reason: super::NotReadReason::OptionOff
            }
        ) {
            return;
        }
        for source in &saved.sources {
            if !source_in_scope(&source.object, &current.scope) {
                continue;
            }
            let observed = current
                .sources
                .iter()
                .find(|row| row.object == source.object);
            if observed.is_some_and(|row| row.coverage == Completeness::Complete && !row.retained) {
                continue;
            }
            // A successfully enumerated source that no longer exists has no references to retain.
            if !existing.contains(&source.object) {
                continue;
            }
            let mut kept = source.clone();
            kept.retained = true;
            if observed.is_none() {
                current.sources.push(kept);
            }
            for edge in saved
                .edges
                .iter()
                .filter(|edge| edge.source == source.object)
            {
                let already_present = current.edges.iter().any(|row| {
                    row.source == edge.source && row.target == edge.target && row.kind == edge.kind
                });
                if !already_present {
                    let mut kept = edge.clone();
                    kept.retained = true;
                    current.edges.push(kept);
                }
            }
        }
        current
            .sources
            .sort_by(|left, right| left.object.cmp(&right.object));
        current
            .edges
            .sort_by_cached_key(|edge| serde_json::to_string(edge).unwrap_or_default());
    }
}

fn source_in_scope(object: &DependencyObjectRef, scope: &CaptureScope) -> bool {
    scope.includes_schema(object.schema())
        && match object {
            DependencyObjectRef::Table { .. } => true,
            DependencyObjectRef::View { .. } => scope.include_views,
            DependencyObjectRef::Routine { .. } | DependencyObjectRef::Trigger { .. } => {
                scope.include_programmability
            }
        }
}

fn dependency_object_exists(
    snapshot: &super::SchemaSnapshot,
    object: &DependencyObjectRef,
) -> bool {
    match object {
        DependencyObjectRef::Table { name } => {
            snapshot.tables.iter().any(|table| &table.name == name)
        }
        DependencyObjectRef::View { name } => snapshot.views.iter().any(|view| &view.name == name),
        DependencyObjectRef::Routine {
            name,
            identity_arguments,
        } => snapshot
            .programmability
            .iter()
            .flat_map(|code| &code.routines)
            .any(|routine| {
                &routine.name == name && &routine.identity_arguments == identity_arguments
            }),
        DependencyObjectRef::Trigger { parent, name } => snapshot
            .programmability
            .iter()
            .flat_map(|code| &code.triggers)
            .any(|trigger| &trigger.parent == parent && &trigger.name == name),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;

    #[test]
    fn routine_tracking_absence_and_future_values_stay_explicit() {
        let source = DependencySource {
            object: DependencyObjectRef::Routine {
                name: QualifiedName::new("sales", "total"),
                identity_arguments: Some(Vec::new()),
            },
            coverage: Completeness::Complete,
            routine_body_tracking: None,
            read_at: Utc::now(),
            retained: false,
        };
        let mut json = serde_json::to_value(&source).unwrap();
        assert!(json.get("routineBodyTracking").is_none());
        assert_eq!(
            serde_json::from_value::<DependencySource>(json.clone()).unwrap(),
            source
        );
        json["routineBodyTracking"] = serde_json::json!("futureTrackingMode");
        assert_eq!(
            serde_json::from_value::<DependencySource>(json)
                .unwrap()
                .routine_body_tracking,
            Some(RoutineDependencyTracking::Unknown),
        );
    }

    #[test]
    fn optional_failure_preserves_routine_tracking_and_its_original_date() {
        let mut previous = super::super::test_fixtures::code_snapshot();
        previous.provider = super::super::DatabaseProvider::PostgreSql;
        let routine = &previous.programmability.as_ref().unwrap().routines[0];
        let source = DependencySource {
            object: DependencyObjectRef::Routine {
                name: routine.name.clone(),
                identity_arguments: routine.identity_arguments.clone(),
            },
            coverage: Completeness::Complete,
            routine_body_tracking: Some(RoutineDependencyTracking::ParsedSqlBody),
            read_at: previous.extracted_at,
            retained: false,
        };
        previous.dependencies = Some(DependencySnapshot {
            capture: CaptureState::Read,
            scope: CaptureScope::everything_with_code(),
            observed_at: previous.extracted_at,
            sources: vec![source.clone()],
            edges: Vec::new(),
            limitations: Vec::new(),
            unknown: UnknownFields::new(),
        });
        let mut current = previous.clone();
        current.extracted_at += chrono::Duration::days(1);
        let family = current.dependencies.as_mut().unwrap();
        family.capture = CaptureState::NotRead {
            reason: super::super::NotReadReason::PermissionDenied,
        };
        family.sources.clear();
        let merged = current.with_unchecked_facts_from(&previous);
        let retained = &merged.dependencies.as_ref().unwrap().sources[0];
        assert_eq!(retained.routine_body_tracking, source.routine_body_tracking);
        assert_eq!(retained.read_at, source.read_at);
        assert!(retained.retained);
    }
}
