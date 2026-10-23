#![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

use crate::diff::SchemaDiff;
use crate::model::test_fixtures::sample_snapshot;
use crate::model::{
    CaptureScope, CaptureState, Completeness, DatabaseProvider, Definition, DependencyEdge,
    DependencyKind, DependencyLimitation, DependencyObjectRef, DependencyReferenceStatus,
    DependencySnapshot, DependencySource, DependencyTarget, NotReadReason, PostgresqlConstraint,
    PostgresqlMetadata, Programmability, QualifiedName, SchemaSnapshot,
};

fn with_dependencies() -> SchemaSnapshot {
    let mut snapshot = sample_snapshot();
    let source = DependencyObjectRef::Table {
        name: snapshot.tables[0].name.clone(),
    };
    snapshot.dependencies = Some(DependencySnapshot {
        capture: CaptureState::Read,
        scope: CaptureScope::everything_with_code(),
        observed_at: snapshot.extracted_at,
        sources: vec![DependencySource {
            object: source.clone(),
            coverage: Completeness::Complete,
            routine_body_tracking: None,
            read_at: snapshot.extracted_at,
            retained: false,
        }],
        edges: vec![DependencyEdge {
            source,
            target: DependencyTarget::Object {
                object: DependencyObjectRef::Table {
                    name: QualifiedName::new("sales", "Orders"),
                },
            },
            kind: DependencyKind::CatalogReference,
            is_schema_bound: Some(false),
            read_at: snapshot.extracted_at,
            retained: false,
        }],
        limitations: vec![DependencyLimitation::RuntimeReferencesNotTracked],
        unknown: serde_json::Map::default(),
    });
    snapshot
}

#[test]
fn new_dependency_evidence_is_reviewed_without_claiming_database_additions() {
    let after = with_dependencies();
    let mut before = after.clone();
    before.dependencies = None;
    let diff = SchemaDiff::between(&before, &after);
    assert!(diff.metadata.dependencies.newly_recorded);
    assert_eq!(diff.metadata.dependencies.changes, []);
    assert!(!diff.has_object_changes());
    assert!(!diff.is_up_to_date());
    assert!(SchemaDiff::between(&after, &after).is_up_to_date());
}

#[test]
fn confirmed_catalog_reference_removal_is_an_object_difference() {
    let before = with_dependencies();
    let mut after = before.clone();
    after.dependencies.as_mut().unwrap().edges.clear();
    let diff = SchemaDiff::between(&before, &after);
    assert_eq!(diff.metadata.dependencies.changes.len(), 1);
    assert_eq!(diff.metadata.dependencies.changes[0].removed, 1);
    assert!(diff.has_object_changes());
    assert!(!diff.is_up_to_date());
}

fn unavailable_dependency_target(
    reason: NotReadReason,
    status: DependencyReferenceStatus,
) -> (SchemaSnapshot, SchemaSnapshot) {
    let mut before = with_dependencies();
    let mut code = crate::model::test_fixtures::sample_programmability();
    code.carried_over.clear();
    let name = code.routines[0].name.clone();
    before.dependencies.as_mut().unwrap().edges[0].target = DependencyTarget::Object {
        object: DependencyObjectRef::Routine {
            name: name.clone(),
            identity_arguments: None,
        },
    };
    before.programmability = Some(code);
    let mut after = before.clone();
    after.extracted_at += chrono::Duration::days(1);
    after.programmability = Some(Programmability::not_read(reason));
    let family = after.dependencies.as_mut().unwrap();
    family.scope.include_programmability = reason != NotReadReason::OptionOff;
    family.observed_at = after.extracted_at;
    family.sources[0].read_at = after.extracted_at;
    family.edges[0].read_at = after.extracted_at;
    family.edges[0].target = DependencyTarget::Reference {
        status,
        server: None,
        database: None,
        schema: Some(name.schema),
        name: Some(name.name),
        object_class: None,
    };
    (before, after)
}

#[test]
fn dependency_target_scope_exclusion_is_unchecked_instead_of_a_topology_change() {
    let (before, after) = unavailable_dependency_target(
        NotReadReason::OptionOff,
        DependencyReferenceStatus::OutOfScope,
    );
    let diff = SchemaDiff::between(&before, &after);
    assert!(diff.metadata.dependencies.scope_changed);
    assert_eq!(diff.metadata.dependencies.changes, []);
    assert_eq!(diff.metadata.dependencies.not_checked.len(), 1);
    assert_eq!(
        diff.metadata.dependencies.not_checked[0].read_at,
        before.extracted_at
    );
    assert!(diff.metadata.dependencies.not_checked[0].retained);
    assert!(!diff.metadata.has_object_changes());
}

#[test]
fn dependency_target_optional_metadata_failure_is_unchecked_with_original_date() {
    let (before, after) = unavailable_dependency_target(
        NotReadReason::QueryFailed,
        DependencyReferenceStatus::NotVisible,
    );
    let diff = SchemaDiff::between(&before, &after);
    assert!(!diff.metadata.dependencies.scope_changed);
    assert_eq!(diff.metadata.dependencies.changes, []);
    assert_eq!(diff.metadata.dependencies.not_checked.len(), 1);
    assert_eq!(
        diff.metadata.dependencies.not_checked[0].read_at,
        before.extracted_at
    );
    assert!(!diff.metadata.has_object_changes());
}

#[test]
fn confirmed_catalog_reference_retargeting_with_unchanged_count_is_an_object_difference() {
    let mut before = with_dependencies();
    let mut opaque = before.dependencies.as_ref().unwrap().edges[0].clone();
    opaque.target = DependencyTarget::Reference {
        status: DependencyReferenceStatus::Unsupported,
        server: None,
        database: None,
        schema: None,
        name: None,
        object_class: Some("pg_namespace".into()),
    };
    before.dependencies.as_mut().unwrap().edges.push(opaque);
    let mut after = before.clone();
    after.dependencies.as_mut().unwrap().edges[0].target = DependencyTarget::Object {
        object: DependencyObjectRef::Table {
            name: after.tables[0].name.clone(),
        },
    };
    let diff = SchemaDiff::between(&before, &after);
    assert_eq!(diff.metadata.dependencies.changes.len(), 1);
    assert_eq!(diff.metadata.dependencies.changes[0].removed, 1);
    assert_eq!(diff.metadata.dependencies.changes[0].added, 1);
    assert_eq!(diff.metadata.dependencies.not_checked, []);
    assert!(diff.metadata.has_object_changes());
}

#[test]
fn stable_unidentified_dependency_targets_do_not_manufacture_a_refresh_review() {
    let mut before = with_dependencies();
    let family = before.dependencies.as_mut().unwrap();
    for (status, name, class) in [
        (
            DependencyReferenceStatus::Unsupported,
            None,
            Some("pg_namespace"),
        ),
        (
            DependencyReferenceStatus::Unresolved,
            Some("missing_target"),
            Some("OBJECT_OR_COLUMN"),
        ),
    ] {
        let mut edge = family.edges[0].clone();
        edge.target = DependencyTarget::Reference {
            status,
            server: None,
            database: None,
            schema: Some("sales".into()),
            name: name.map(str::to_string),
            object_class: class.map(str::to_string),
        };
        family.edges.push(edge);
    }
    let mut after = before.clone();
    after.extracted_at += chrono::Duration::days(1);
    let family = after.dependencies.as_mut().unwrap();
    family.observed_at = after.extracted_at;
    for source in &mut family.sources {
        source.read_at = after.extracted_at;
    }
    for edge in &mut family.edges {
        edge.read_at = after.extracted_at;
    }
    let diff = SchemaDiff::between(&before, &after);
    assert_eq!(diff.metadata.dependencies.changes, []);
    assert_eq!(diff.metadata.dependencies.not_checked, []);
    assert!(!diff.metadata.has_review());
    assert!(diff.is_up_to_date());
}

#[test]
fn table_trigger_removal_is_verified_when_views_are_excluded() {
    let mut before = with_dependencies();
    let mut code = crate::model::test_fixtures::sample_programmability();
    code.carried_over.clear();
    let trigger = code.triggers[0].clone();
    code.triggers = vec![trigger.clone()];
    before.programmability = Some(code);
    let source = DependencyObjectRef::Trigger {
        parent: trigger.parent,
        name: trigger.name,
    };
    let family = before.dependencies.as_mut().unwrap();
    family.sources[0].object = source.clone();
    family.edges[0].source = source.clone();
    let mut after = before.clone();
    after.access = Some(crate::model::test_fixtures::full_profile(
        crate::model::AccessCounts::default(),
    ));
    let scope = &mut after.access.as_mut().unwrap().scope;
    scope.include_programmability = true;
    scope.include_views = false;
    after.programmability.as_mut().unwrap().triggers.clear();
    let family = after.dependencies.as_mut().unwrap();
    family.scope.include_views = false;
    family.sources.clear();
    family.edges.clear();

    let diff = SchemaDiff::between(&before, &after);
    assert_eq!(diff.metadata.dependencies.changes.len(), 1);
    assert_eq!(diff.metadata.dependencies.changes[0].object, source);
    assert_eq!(diff.metadata.dependencies.changes[0].removed, 1);
    assert_eq!(diff.metadata.dependencies.not_checked, []);
}

#[test]
fn excluded_view_trigger_is_not_reported_as_a_dependency_removal() {
    let mut before = with_dependencies();
    let mut code = crate::model::test_fixtures::sample_programmability();
    code.carried_over.clear();
    let mut trigger = code.triggers[0].clone();
    trigger.parent = before.views[0].name.clone();
    code.triggers = vec![trigger.clone()];
    before.programmability = Some(code);
    let source = DependencyObjectRef::Trigger {
        parent: trigger.parent,
        name: trigger.name,
    };
    let family = before.dependencies.as_mut().unwrap();
    family.sources[0].object = source.clone();
    family.edges[0].source = source;
    let mut after = before.clone();
    after.views.clear();
    after.programmability.as_mut().unwrap().triggers.clear();
    let family = after.dependencies.as_mut().unwrap();
    family.scope.include_views = false;
    family.sources.clear();
    family.edges.clear();

    let diff = SchemaDiff::between(&before, &after);
    assert_eq!(diff.metadata.dependencies.changes, []);
    assert_eq!(diff.metadata.dependencies.not_checked, []);
}

#[test]
fn optional_failure_and_explicit_exclusion_are_distinct_reviews() {
    let before = with_dependencies();
    let mut after = before.clone();
    after.dependencies.as_mut().unwrap().capture = CaptureState::NotRead {
        reason: NotReadReason::PermissionDenied,
    };
    after.dependencies.as_mut().unwrap().sources.clear();
    after.dependencies.as_mut().unwrap().edges.clear();
    let failed = SchemaDiff::between(&before, &after);
    assert_eq!(
        failed.metadata.dependencies.read_failure,
        Some(NotReadReason::PermissionDenied)
    );
    assert_eq!(
        failed.metadata.dependencies.not_checked[0].read_at,
        before.extracted_at
    );
    assert_eq!(failed.metadata.dependencies.changes, []);
    assert!(!failed.has_object_changes());
    assert!(!failed.is_up_to_date());

    after.dependencies.as_mut().unwrap().capture = CaptureState::NotRead {
        reason: NotReadReason::OptionOff,
    };
    let excluded = SchemaDiff::between(&before, &after);
    assert!(excluded.metadata.dependencies.excluded);
    assert_eq!(excluded.metadata.dependencies.not_checked, []);
    assert_eq!(excluded.metadata.dependencies.changes, []);
    assert!(!excluded.has_object_changes());
    assert!(!excluded.is_up_to_date());
}

#[test]
fn scope_exclusion_is_metadata_removal_not_catalog_reference_deletion() {
    let before = with_dependencies();
    let mut after = before.clone();
    after.dependencies.as_mut().unwrap().scope.schemas = vec!["unrelated".to_string()];
    after.dependencies.as_mut().unwrap().sources.clear();
    after.dependencies.as_mut().unwrap().edges.clear();
    let diff = SchemaDiff::between(&before, &after);
    assert!(diff.metadata.dependencies.scope_changed);
    assert_eq!(diff.metadata.dependencies.changes, []);
    assert_eq!(diff.metadata.dependencies.not_checked, []);
    assert!(!diff.is_up_to_date());
}

#[test]
fn retained_or_partial_source_does_not_confirm_a_dependency_change() {
    let before = with_dependencies();
    let mut after = before.clone();
    let family = after.dependencies.as_mut().unwrap();
    family.sources[0].coverage = Completeness::Partial;
    family.sources[0].retained = true;
    family.edges.clear();
    let diff = SchemaDiff::between(&before, &after);
    assert_eq!(diff.metadata.dependencies.changes, []);
    assert_eq!(diff.metadata.dependencies.not_checked.len(), 1);
    assert!(!diff.has_object_changes());
    assert!(!diff.is_up_to_date());
}

#[test]
fn a_new_native_deferrability_fact_reaches_the_refresh_verdict_and_properties() {
    let mut before = sample_snapshot();
    before.provider = DatabaseProvider::PostgreSql;
    before.postgresql = Some(PostgresqlMetadata {
        constraints: vec![PostgresqlConstraint {
            table: QualifiedName::new("sales", "Orders"),
            name: "FK_Orders_Customers".to_string(),
            kind: "foreignKey".to_string(),
            definition: Definition::readable(
                "FOREIGN KEY (CustomerId) REFERENCES dbo.Customers(CustomerId)",
            ),
            is_validated: true,
            is_enforced: None,
            is_deferrable: false,
            is_initially_deferred: false,
            match_type: Some("simple".to_string()),
            delete_set_columns: Vec::new(),
        }],
        ..PostgresqlMetadata::default()
    });
    let mut after = before.clone();
    after.postgresql.as_mut().unwrap().constraints[0].is_deferrable = true;
    let diff = SchemaDiff::between(&before, &after);
    assert!(diff.has_object_changes());
    assert!(!diff.is_up_to_date());
    assert!(
        diff.metadata
            .native_changes
            .iter()
            .flat_map(|change| &change.properties)
            .any(|property| property
                .path
                .last()
                .is_some_and(|part| part == "isDeferrable"))
    );
}
