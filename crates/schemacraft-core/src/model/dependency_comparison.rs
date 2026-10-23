//! Evidence-aware comparison of catalog topology, separate from target navigability.

use std::collections::{BTreeMap, BTreeSet};

use super::{DependencyEdge, DependencyObjectRef, DependencyReferenceStatus, DependencyTarget};

/// Only positively established edge changes; incomplete endpoints remain a separate fact.
pub(crate) struct DependencyTopologyComparison {
    pub added: usize,
    pub removed: usize,
    pub unidentified_targets_changed: bool,
}

/// Counts endpoints whose full logical identity this capture did not establish.
pub(crate) fn unidentified_dependency_targets(edges: &[&DependencyEdge]) -> usize {
    edges
        .iter()
        .filter(|edge| edge.topology_key().is_none())
        .count()
}

/// An uncertain endpoint can defer a known edge only when it could identify that endpoint.
/// In particular, an anonymous unsupported catalog class cannot stand for a table or routine.
/// Matching possibilities never establishes equality or chooses a PostgreSQL overload.
pub(crate) fn compare_dependency_edges(
    before: &[&DependencyEdge],
    after: &[&DependencyEdge],
) -> DependencyTopologyComparison {
    let old = identified(before);
    let new = identified(after);
    let uncertain_before: Vec<_> = before
        .iter()
        .filter(|edge| edge.topology_key().is_none())
        .collect();
    let uncertain_after: Vec<_> = after
        .iter()
        .filter(|edge| edge.topology_key().is_none())
        .collect();
    let removed = old
        .iter()
        .filter(|(key, edge)| {
            !new.contains_key(*key)
                && !uncertain_after
                    .iter()
                    .any(|uncertain| possible_counterpart(edge, uncertain))
        })
        .count();
    let added = new
        .iter()
        .filter(|(key, edge)| {
            !old.contains_key(*key)
                && !uncertain_before
                    .iter()
                    .any(|uncertain| possible_counterpart(edge, uncertain))
        })
        .count();
    DependencyTopologyComparison {
        added,
        removed,
        unidentified_targets_changed: unidentified_keys(before) != unidentified_keys(after),
    }
}

fn unidentified_keys(edges: &[&DependencyEdge]) -> BTreeSet<String> {
    edges
        .iter()
        .filter(|edge| edge.topology_key().is_none())
        .filter_map(|edge| {
            // This signature compares only the recorded uncertainty, not a guessed destination.
            // A persistent limitation with a newer read date does not require another refresh review.
            serde_json::to_string(&(&edge.target, edge.kind, edge.is_schema_bound)).ok()
        })
        .collect()
}

fn identified<'a>(edges: &[&'a DependencyEdge]) -> BTreeMap<String, &'a DependencyEdge> {
    edges
        .iter()
        .filter_map(|edge| edge.topology_key().map(|key| (key, *edge)))
        .collect()
}

fn possible_counterpart(known: &DependencyEdge, uncertain: &DependencyEdge) -> bool {
    if known.kind != uncertain.kind && uncertain.kind != super::DependencyKind::Unknown {
        return false;
    }
    if known.is_schema_bound.is_some()
        && uncertain.is_schema_bound.is_some()
        && known.is_schema_bound != uncertain.is_schema_bound
    {
        return false;
    }
    let DependencyTarget::Reference {
        status,
        object_class,
        ..
    } = &uncertain.target
    else {
        // A future relation kind on a positively identified object is not understood yet.
        return known.target == uncertain.target;
    };
    if let DependencyTarget::Object { object } = &known.target {
        if matches!(
            status,
            DependencyReferenceStatus::Unsupported | DependencyReferenceStatus::External
        ) || !compatible_object_class(object, object_class.as_deref())
        {
            return false;
        }
    } else if let DependencyTarget::Reference {
        object_class: known_class,
        ..
    } = &known.target
        && object_class.is_some()
        && known_class.is_some()
        && object_class != known_class
    {
        return false;
    }
    let known_location = location(&known.target);
    let uncertain_location = location(&uncertain.target);
    // Catalog classifications other than a future unknown value distinguish local references
    // from external server/database identifiers; an omitted external qualifier is not guessed.
    if *status != DependencyReferenceStatus::Unknown
        && ((uncertain_location.0.is_none() && known_location.0.is_some())
            || (uncertain_location.1.is_none() && known_location.1.is_some()))
    {
        return false;
    }
    [
        (known_location.0, uncertain_location.0),
        (known_location.1, uncertain_location.1),
        (known_location.2, uncertain_location.2),
        (known_location.3, uncertain_location.3),
    ]
    .iter()
    .all(|(known, uncertain)| uncertain.is_none() || known == uncertain)
}

fn compatible_object_class(object: &DependencyObjectRef, class: Option<&str>) -> bool {
    match class {
        Some("relation:r" | "relation:p") => matches!(object, DependencyObjectRef::Table { .. }),
        Some("relation:v" | "relation:m") => matches!(object, DependencyObjectRef::View { .. }),
        Some("routine:f" | "routine:p") => matches!(object, DependencyObjectRef::Routine { .. }),
        Some(value) if value.starts_with("relation:") || value.starts_with("routine:") => false,
        _ => true,
    }
}

fn location(target: &DependencyTarget) -> (Option<&str>, Option<&str>, Option<&str>, Option<&str>) {
    match target {
        DependencyTarget::Object { object } => match object {
            DependencyObjectRef::Table { name }
            | DependencyObjectRef::View { name }
            | DependencyObjectRef::Routine { name, .. } => {
                (None, None, Some(&name.schema), Some(&name.name))
            }
            DependencyObjectRef::Trigger { parent, name } => {
                (None, None, Some(&parent.schema), Some(name))
            }
        },
        DependencyTarget::Reference {
            server,
            database,
            schema,
            name,
            ..
        } => (
            server.as_deref(),
            database.as_deref(),
            schema.as_deref(),
            name.as_deref(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DependencyKind, QualifiedName};

    fn edge(target: DependencyTarget) -> DependencyEdge {
        DependencyEdge {
            source: DependencyObjectRef::Table {
                name: QualifiedName::new("sales", "source"),
            },
            target,
            kind: DependencyKind::CatalogReference,
            is_schema_bound: None,
            read_at: chrono::DateTime::UNIX_EPOCH,
            retained: false,
        }
    }

    fn routine(name: &str, argument: &str) -> DependencyEdge {
        edge(DependencyTarget::Object {
            object: DependencyObjectRef::Routine {
                name: QualifiedName::new("sales", name),
                identity_arguments: Some(vec![QualifiedName::new("pg_catalog", argument)]),
            },
        })
    }

    fn unknown_target(
        status: DependencyReferenceStatus,
        name: Option<&str>,
        class: &str,
    ) -> DependencyEdge {
        edge(DependencyTarget::Reference {
            status,
            server: None,
            database: None,
            schema: name.map(|_| "sales".into()),
            name: name.map(str::to_string),
            object_class: Some(class.into()),
        })
    }

    #[test]
    fn anonymous_unsupported_targets_do_not_hide_confirmed_supported_topology_changes() {
        let first = routine("first", "int4");
        let second = routine("second", "int4");
        let opaque = unknown_target(DependencyReferenceStatus::Unsupported, None, "pg_namespace");
        let result = compare_dependency_edges(&[&first, &opaque], &[&second, &opaque]);
        assert_eq!((result.added, result.removed), (1, 1));
        assert_eq!(unidentified_dependency_targets(&[&first, &opaque]), 1);
        assert!(!result.unidentified_targets_changed);
    }

    #[test]
    fn uncertain_names_defer_only_possible_counterparts_without_choosing_an_overload() {
        let first = routine("same", "int4");
        let overload = routine("same", "text");
        let unrelated = routine("other", "int4");
        let unknown = unknown_target(
            DependencyReferenceStatus::NotVisible,
            Some("same"),
            "routine:f",
        );
        let result = compare_dependency_edges(&[&first, &overload, &unrelated], &[&unknown]);
        assert_eq!((result.added, result.removed), (0, 1));
        assert_eq!(unidentified_dependency_targets(&[&unknown]), 1);
        assert!(result.unidentified_targets_changed);
        let reverse = compare_dependency_edges(&[&unknown], &[&first, &overload, &unrelated]);
        assert_eq!((reverse.added, reverse.removed), (1, 0));
    }

    #[test]
    fn fully_identified_postgresql_overloads_remain_different() {
        let first = routine("same", "int4");
        let second = routine("same", "text");
        let result = compare_dependency_edges(&[&first], &[&second]);
        assert_eq!((result.added, result.removed), (1, 1));
        assert_eq!(unidentified_dependency_targets(&[&first, &second]), 0);
        assert!(!result.unidentified_targets_changed);
    }

    #[test]
    fn an_unsupported_missing_identity_is_not_guessed_equal_to_an_identified_reference() {
        let known = unknown_target(
            DependencyReferenceStatus::Unsupported,
            Some("money"),
            "pg_type",
        );
        let unknown = unknown_target(DependencyReferenceStatus::Unsupported, None, "pg_type");
        let result = compare_dependency_edges(&[&known], &[&unknown]);
        assert_eq!((result.added, result.removed), (0, 0));
        assert!(result.unidentified_targets_changed);
    }
}
