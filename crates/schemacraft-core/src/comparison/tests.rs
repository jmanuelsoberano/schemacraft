#![allow(clippy::unwrap_used, clippy::expect_used, clippy::indexing_slicing)]

use chrono::Duration;

use super::*;
use crate::model::test_fixtures::{full_profile, sample_programmability, sample_snapshot};
use crate::model::{
    AccessCounts, CaptureScope, CaptureState, Completeness, DatabaseProvider, Definition,
    DependencyEdge, DependencyKind, DependencyLimitation, DependencyObjectRef,
    DependencyReferenceStatus, DependencySnapshot, DependencySource, DependencyTarget, ModuleBody,
    NotReadReason, PostgresqlConstraint, PostgresqlMetadata, PostgresqlRoutine, PostgresqlTable,
    QualifiedName, RoutineDependencyTracking, SchemaSnapshot,
};

fn observed() -> SchemaSnapshot {
    let mut snapshot = sample_snapshot();
    let mut profile = full_profile(AccessCounts::default());
    profile.scope = CaptureScope::everything_with_code();
    snapshot.access = Some(profile);
    snapshot
}

fn postgresql_observed() -> SchemaSnapshot {
    let mut snapshot = observed();
    snapshot.provider = DatabaseProvider::PostgreSql;
    snapshot.views.clear();
    for table in &mut snapshot.tables {
        if let Some(key) = &mut table.primary_key {
            key.is_enabled = None;
            key.is_clustered = false;
        }
        for index in &mut table.indexes {
            index.included_columns = Some(Vec::new());
            index.is_filtered = Some(false);
            index.is_enabled = None;
            index.is_clustered = false;
        }
        for check in &mut table.check_constraints {
            check.is_enabled = None;
            check.is_trusted = None;
        }
    }
    snapshot.postgresql = Some(PostgresqlMetadata {
        constraints: vec![PostgresqlConstraint {
            table: snapshot.tables[0].name.clone(),
            name: snapshot.tables[0].check_constraints[0].name.clone(),
            kind: "check".into(),
            definition: Definition::readable("CHECK (length(\"Name\") > 0)"),
            is_validated: true,
            is_enforced: Some(true),
            is_deferrable: false,
            is_initially_deferred: false,
            match_type: None,
            delete_set_columns: Vec::new(),
        }],
        ..PostgresqlMetadata::default()
    });
    snapshot.dependencies = Some(DependencySnapshot {
        capture: CaptureState::Read,
        scope: CaptureScope::everything_with_code(),
        observed_at: snapshot.extracted_at,
        sources: snapshot
            .tables
            .iter()
            .map(|table| DependencySource {
                object: DependencyObjectRef::Table {
                    name: table.name.clone(),
                },
                coverage: Completeness::Complete,
                routine_body_tracking: None,
                read_at: snapshot.extracted_at,
                retained: false,
            })
            .collect(),
        edges: Vec::new(),
        limitations: vec![DependencyLimitation::RuntimeReferencesNotTracked],
        unknown: serde_json::Map::default(),
    });
    snapshot
}

fn with_routine_tracking(tracking: Option<RoutineDependencyTracking>) -> SchemaSnapshot {
    let mut snapshot = postgresql_observed();
    let mut code = sample_programmability();
    code.carried_over.clear();
    code.views.clear();
    code.triggers.clear();
    code.routines.truncate(1);
    let routine = &mut code.routines[0];
    routine.identity_arguments = Some(Vec::new());
    routine.body = ModuleBody::PostgreSql {
        name: "sql".into(),
        definition: Definition::readable("SELECT 1"),
    };
    snapshot
        .postgresql
        .as_mut()
        .unwrap()
        .routines
        .push(PostgresqlRoutine {
            object: routine.object_ref(),
            language: "sql".into(),
            routine_body_tracking: tracking,
            returns_set: false,
            arguments: None,
            result: None,
            argument_modes: Vec::new(),
            definition_is_reconstructed: true,
        });
    snapshot
        .dependencies
        .as_mut()
        .unwrap()
        .sources
        .push(DependencySource {
            object: DependencyObjectRef::Routine {
                name: routine.name.clone(),
                identity_arguments: routine.identity_arguments.clone(),
            },
            coverage: Completeness::Complete,
            routine_body_tracking: tracking,
            read_at: snapshot.extracted_at,
            retained: false,
        });
    snapshot.programmability = Some(code);
    snapshot
}

#[test]
fn routine_body_tracking_knowledge_and_changes_reach_comparison_and_refresh_honestly() {
    let unrecorded = with_routine_tracking(None);
    let parsed = with_routine_tracking(Some(RoutineDependencyTracking::ParsedSqlBody));
    let text_body = with_routine_tracking(Some(RoutineDependencyTracking::SignatureOnly));
    let path = ["postgresql", "routine", "routineBodyTracking"];
    let newly_known = compare_snapshots(&unrecorded, &parsed).unwrap();
    let property = newly_known
        .items
        .iter()
        .flat_map(|item| &item.properties)
        .find(|property| property.path == path)
        .unwrap();
    assert_eq!(property.result, ComparisonResultKind::NotComparable);
    assert_eq!(
        property.reference.observation.status,
        ComparisonObservationStatus::NotRecorded
    );
    assert_eq!(newly_known.summary.different, 0);
    let refresh = crate::diff::SchemaDiff::between(&unrecorded, &parsed);
    assert!(!refresh.has_object_changes());
    assert!(
        refresh
            .metadata
            .native_not_checked
            .iter()
            .flat_map(|item| &item.properties)
            .any(|property| property.path == path)
    );

    let changed = compare_snapshots(&parsed, &text_body).unwrap();
    assert!(
        changed
            .items
            .iter()
            .flat_map(|item| &item.properties)
            .any(|property| property.path == path
                && property.result == ComparisonResultKind::Different)
    );
    let refresh = crate::diff::SchemaDiff::between(&parsed, &text_body);
    assert!(refresh.has_object_changes());
    assert!(
        refresh
            .metadata
            .native_changes
            .iter()
            .flat_map(|item| &item.properties)
            .any(|property| property.path == path)
    );
}

#[test]
fn postgresql_self_comparison_has_no_inapplicable_sql_server_limitations() {
    let snapshot = postgresql_observed();
    let result = compare_snapshots(&snapshot, &snapshot).unwrap();
    assert_eq!(result.items, []);
    assert_eq!(
        result.summary.equal,
        snapshot.tables.len() + snapshot.foreign_keys.len()
    );
    assert_eq!(result.summary.not_comparable, 0);
    assert_eq!(result.summary.with_limitations, 0);
}

#[test]
fn missing_native_enforcement_evidence_remains_unrecorded() {
    let before = postgresql_observed();
    let mut after = before.clone();
    after.postgresql.as_mut().unwrap().constraints[0].is_enforced = None;
    let result = compare_snapshots(&before, &after).unwrap();
    let property = result
        .items
        .iter()
        .flat_map(|item| &item.properties)
        .find(|property| {
            property
                .path
                .last()
                .is_some_and(|part| part == "isEnforced")
        })
        .unwrap();
    assert_eq!(property.result, ComparisonResultKind::NotComparable);
    assert_eq!(
        property.compared.observation.status,
        ComparisonObservationStatus::NotRecorded
    );
    assert_eq!(result.summary.different, 0);
}

#[test]
fn recorded_native_enforcement_changes_are_compared() {
    let before = postgresql_observed();
    let mut after = before.clone();
    after.postgresql.as_mut().unwrap().constraints[0].is_enforced = Some(false);
    let result = compare_snapshots(&before, &after).unwrap();
    assert!(
        result
            .items
            .iter()
            .flat_map(|item| &item.properties)
            .any(|property| property
                .path
                .last()
                .is_some_and(|part| part == "isEnforced")
                && property.result == ComparisonResultKind::Different)
    );
    assert_eq!(result.summary.not_comparable, 0);
}

#[test]
fn independent_comparison_is_immutable_and_ignores_capture_dates_and_column_position() {
    let before = observed();
    let mut after = before.clone();
    after.extracted_at += Duration::hours(1);
    after.tables[0].columns.reverse();
    for column in &mut after.tables[0].columns {
        column.ordinal_position += 7;
    }
    let saved_before = before.clone();
    let saved_after = after.clone();
    let result = compare_snapshots(&before, &after).unwrap();
    assert_eq!(result.summary.different, 0);
    assert_eq!(result.summary.only_reference, 0);
    assert_eq!(result.summary.only_compared, 0);
    assert_eq!(before, saved_before);
    assert_eq!(after, saved_after);
}

#[test]
fn unrecorded_native_family_cannot_prove_new_native_properties_were_absent() {
    let mut before = observed();
    before.provider = DatabaseProvider::PostgreSql;
    let mut after = before.clone();
    after.postgresql = Some(PostgresqlMetadata {
        tables: vec![PostgresqlTable {
            name: after.tables[0].name.clone(),
            kind: "ordinary".to_string(),
        }],
        ..PostgresqlMetadata::default()
    });
    let comparison = compare_snapshots(&before, &after).unwrap();
    let properties: Vec<_> = comparison
        .items
        .iter()
        .flat_map(|item| &item.properties)
        .filter(|property| {
            property
                .path
                .first()
                .is_some_and(|part| part == "postgresql")
        })
        .collect();
    assert_ne!(properties, [] as [&super::ComparisonProperty; 0]);
    assert!(
        properties
            .iter()
            .all(|property| property.result == ComparisonResultKind::NotComparable)
    );
    assert!(
        properties
            .iter()
            .all(|property| property.reference.observation.status
                == ComparisonObservationStatus::NotRecorded)
    );
    assert_eq!(comparison.summary.different, 0);
}

#[test]
fn independent_absence_needs_each_sides_own_scope_and_visibility() {
    let before = observed();
    let name = before.tables[0].name.clone();
    let mut after = before.clone();
    after.tables.remove(0);
    let confirmed = compare_snapshots(&before, &after).unwrap();
    assert!(
        confirmed
            .items
            .iter()
            .any(|item| item.object.name == name
                && item.result == ComparisonResultKind::OnlyReference)
    );

    after.access.as_mut().unwrap().scope.schemas = vec!["a different schema".to_string()];
    let excluded = compare_snapshots(&before, &after).unwrap();
    let item = excluded
        .items
        .iter()
        .find(|item| item.object.kind == ComparisonObjectKind::Table && item.object.name == name)
        .unwrap();
    assert_eq!(item.result, ComparisonResultKind::NotComparable);
    assert_eq!(item.compared.status, ComparisonObservationStatus::Excluded);

    after.access = None;
    let old = compare_snapshots(&before, &after).unwrap();
    let item = old
        .items
        .iter()
        .find(|item| item.object.kind == ComparisonObjectKind::Table && item.object.name == name)
        .unwrap();
    assert_eq!(item.result, ComparisonResultKind::NotComparable);
    assert_eq!(
        item.compared.status,
        ComparisonObservationStatus::NotRecorded
    );
    assert!(!after.tables.iter().any(|table| table.name == name));
}

#[test]
fn names_with_dots_never_collide_and_swapping_sides_reverses_only_direction() {
    let mut before = observed();
    before.tables.truncate(1);
    before.tables[0].name = QualifiedName::new("a.b", "c");
    before.views.clear();
    before.foreign_keys.clear();
    let mut after = before.clone();
    after.tables[0].name = QualifiedName::new("a", "b.c");
    let forward = compare_snapshots(&before, &after).unwrap();
    let reverse = compare_snapshots(&after, &before).unwrap();
    assert_eq!(forward.summary.only_reference, 1);
    assert_eq!(forward.summary.only_compared, 1);
    assert_eq!(forward.items.len(), 2);
    for item in &forward.items {
        let swapped = reverse
            .items
            .iter()
            .find(|other| other.object == item.object)
            .unwrap();
        assert_eq!(item.reference, swapped.compared);
        assert_eq!(item.compared, swapped.reference);
        assert_ne!(item.result, swapped.result);
    }
}

#[test]
fn old_unrecorded_state_and_retained_defaults_do_not_become_confirmed_changes() {
    let mut before = observed();
    before.tables[0].columns[0].default_expression = Some(Definition::readable("1"));
    let mut after = before.clone();
    after.tables[0].columns[0].default_expression = Some(Definition::readable("2"));
    after.carried_over.push(crate::model::CarriedFact {
        object: after.tables[0].name.clone(),
        fact: crate::model::SnapshotFact::ColumnDefault {
            column: after.tables[0].columns[0].name.clone(),
        },
        read_at: before.extracted_at - Duration::days(2),
    });
    let result = compare_snapshots(&before, &after).unwrap();
    let property = result
        .items
        .iter()
        .flat_map(|item| &item.properties)
        .find(|property| {
            property
                .path
                .last()
                .is_some_and(|part| part == "defaultExpression")
                && property.compared.observation.status == ComparisonObservationStatus::Retained
        })
        .unwrap();
    assert_eq!(property.result, ComparisonResultKind::NotComparable);
    assert_eq!(
        property.compared.observation.read_at,
        Some(before.extracted_at - Duration::days(2))
    );
    assert_eq!(result.summary.different, 0);
}

#[test]
fn literal_module_changes_survive_legacy_normalization_and_source_never_enters_results() {
    let mut before = observed();
    let mut code = sample_programmability();
    code.carried_over.clear();
    let routine = code
        .routines
        .iter_mut()
        .find(|routine| {
            routine
                .body
                .definition()
                .and_then(Definition::text)
                .is_some()
        })
        .unwrap();
    routine.body = ModuleBody::Sql {
        definition: Definition::readable("SELECT 'SOURCE_SENTINEL\nvalue  \n';\n"),
    };
    before.programmability = Some(code);
    let mut after = before.clone();
    let routine = after
        .programmability
        .as_mut()
        .unwrap()
        .routines
        .iter_mut()
        .find(|routine| {
            routine
                .body
                .definition()
                .and_then(Definition::text)
                .is_some()
        })
        .unwrap();
    routine.body = ModuleBody::Sql {
        definition: Definition::readable("SELECT 'SOURCE_SENTINEL\nvalue\n';\n"),
    };
    let comparison = compare_snapshots(&before, &after).unwrap();
    assert!(comparison.items.iter().any(|item| {
        item.definition_text
            .as_ref()
            .is_some_and(|text| text.differs && text.equal_under_legacy_normalization)
            && item.result == ComparisonResultKind::Different
    }));
    assert!(
        !serde_json::to_string(&comparison)
            .unwrap()
            .contains("SOURCE_SENTINEL")
    );
}

#[test]
fn historical_source_cannot_prove_a_fresh_text_change() {
    let mut before = observed();
    before.programmability = Some(sample_programmability());
    let mut after = before.clone();
    let routine = after
        .programmability
        .as_mut()
        .unwrap()
        .routines
        .iter_mut()
        .find(|routine| routine.name.name == "usp_PlaceOrder")
        .unwrap();
    routine.body = ModuleBody::Sql {
        definition: Definition::readable("HISTORICAL_SOURCE_SENTINEL"),
    };
    let comparison = compare_snapshots(&before, &after).unwrap();
    let routine = comparison
        .items
        .iter()
        .find(|item| item.object.name.name == "usp_PlaceOrder")
        .unwrap();
    assert!(routine.definition_text.is_none());
    assert_eq!(routine.result, ComparisonResultKind::NotComparable);
    assert!(
        !serde_json::to_string(&comparison)
            .unwrap()
            .contains("HISTORICAL_SOURCE_SENTINEL")
    );
}

#[test]
fn providers_cannot_be_compared_and_postgresql_overloads_are_distinct() {
    let before = observed();
    let mut after = before.clone();
    after.provider = DatabaseProvider::PostgreSql;
    assert_eq!(
        compare_snapshots(&before, &after),
        Err(ComparisonError::DifferentProviders)
    );

    let mut first = observed();
    first.provider = DatabaseProvider::PostgreSql;
    first.programmability = Some(sample_programmability());
    let code = first.programmability.as_mut().unwrap();
    code.routines.truncate(1);
    code.routines[0].identity_arguments = Some(Vec::new());
    let mut overload = code.routines[0].clone();
    overload.identity_arguments = Some(vec![QualifiedName::new("pg_catalog", "int4")]);
    code.routines.push(overload);
    let comparison = compare_snapshots(&first, &first).unwrap();
    let routines: Vec<_> = comparison
        .items
        .iter()
        .filter(|item| item.object.kind == ComparisonObjectKind::Routine)
        .collect();
    assert_eq!(routines.len(), 2);
    assert_ne!(
        routines[0].object.identity_arguments,
        routines[1].object.identity_arguments
    );
}

#[test]
fn dependency_location_changes_are_compared_without_leaking_destination_names() {
    let mut before = observed();
    let source = DependencyObjectRef::Table {
        name: before.tables[0].name.clone(),
    };
    before.dependencies = Some(DependencySnapshot {
        capture: CaptureState::Read,
        scope: CaptureScope::everything_with_code(),
        observed_at: before.extracted_at,
        sources: vec![DependencySource {
            object: source.clone(),
            coverage: Completeness::Complete,
            routine_body_tracking: None,
            read_at: before.extracted_at,
            retained: false,
        }],
        edges: vec![DependencyEdge {
            source,
            target: DependencyTarget::Reference {
                status: DependencyReferenceStatus::External,
                server: Some("PRIVATE_SERVER_A".to_string()),
                database: Some("PRIVATE_DATABASE".to_string()),
                schema: Some("external".to_string()),
                name: Some("PRIVATE_TARGET".to_string()),
                object_class: None,
            },
            kind: DependencyKind::CatalogReference,
            is_schema_bound: Some(false),
            read_at: before.extracted_at,
            retained: false,
        }],
        limitations: vec![DependencyLimitation::RuntimeReferencesNotTracked],
        unknown: serde_json::Map::default(),
    });
    let mut after = before.clone();
    if let DependencyTarget::Reference { server, .. } =
        &mut after.dependencies.as_mut().unwrap().edges[0].target
    {
        *server = Some("PRIVATE_SERVER_B".to_string());
    }
    let comparison = compare_snapshots(&before, &after).unwrap();
    assert!(
        comparison
            .items
            .iter()
            .flat_map(|item| &item.properties)
            .any(|property| property.path == ["dependencies"]
                && property.result == ComparisonResultKind::Different)
    );
    let output = serde_json::to_string(&comparison).unwrap();
    assert!(!output.contains("PRIVATE_"));
}

#[test]
fn dependency_target_resolution_changes_do_not_claim_database_changes_or_guess_overloads() {
    let mut before = with_routine_tracking(Some(RoutineDependencyTracking::ParsedSqlBody));
    let routine = &before.programmability.as_ref().unwrap().routines[0];
    let name = routine.name.clone();
    let family = before.dependencies.as_mut().unwrap();
    family.edges.push(DependencyEdge {
        source: family.sources[0].object.clone(),
        target: DependencyTarget::Object {
            object: DependencyObjectRef::Routine {
                name: name.clone(),
                identity_arguments: routine.identity_arguments.clone(),
            },
        },
        kind: DependencyKind::CatalogReference,
        is_schema_bound: None,
        read_at: before.extracted_at,
        retained: false,
    });
    for status in [
        DependencyReferenceStatus::OutOfScope,
        DependencyReferenceStatus::NotVisible,
    ] {
        let mut after = before.clone();
        after.extracted_at += Duration::days(1);
        let family = after.dependencies.as_mut().unwrap();
        family.scope.include_programmability = status != DependencyReferenceStatus::OutOfScope;
        family.sources[0].read_at = after.extracted_at;
        family.edges[0].target = DependencyTarget::Reference {
            status,
            server: None,
            database: None,
            schema: Some(name.schema.clone()),
            name: Some(name.name.clone()),
            object_class: Some("routine:f".into()),
        };
        after.programmability = Some(crate::model::Programmability::not_read(
            if status == DependencyReferenceStatus::OutOfScope {
                NotReadReason::OptionOff
            } else {
                NotReadReason::QueryFailed
            },
        ));
        let result = compare_snapshots(&before, &after).unwrap();
        let property = result
            .items
            .iter()
            .flat_map(|item| &item.properties)
            .find(|property| property.path == ["dependencies", "targetIdentity"])
            .unwrap();
        assert_eq!(property.result, ComparisonResultKind::NotComparable);
        assert_eq!(
            property.reference.observation.read_at,
            Some(before.extracted_at)
        );
        assert_eq!(
            property.compared.observation.read_at,
            Some(after.extracted_at)
        );
        assert_eq!(result.summary.different, 0);
        let reverse = compare_snapshots(&after, &before).unwrap();
        assert_eq!(reverse.summary.different, 0);
        assert!(reverse.items.iter().flat_map(|item| &item.properties).any(
            |property| property.path == ["dependencies", "targetIdentity"]
                && property.result == ComparisonResultKind::NotComparable
        ));
    }
}

#[test]
fn dependency_known_retargeting_remains_different_beside_unidentified_unsupported_targets() {
    let mut before = postgresql_observed();
    let source = before.dependencies.as_ref().unwrap().sources[0]
        .object
        .clone();
    let target = DependencyObjectRef::Table {
        name: before.tables[0].name.clone(),
    };
    let edges = &mut before.dependencies.as_mut().unwrap().edges;
    edges.push(DependencyEdge {
        source: source.clone(),
        target: DependencyTarget::Object { object: target },
        kind: DependencyKind::CatalogReference,
        is_schema_bound: None,
        read_at: before.extracted_at,
        retained: false,
    });
    edges.push(DependencyEdge {
        source,
        target: DependencyTarget::Reference {
            status: DependencyReferenceStatus::Unsupported,
            server: None,
            database: None,
            schema: None,
            name: None,
            object_class: Some("pg_namespace".into()),
        },
        kind: DependencyKind::CatalogReference,
        is_schema_bound: None,
        read_at: before.extracted_at,
        retained: false,
    });
    let mut after = before.clone();
    after.dependencies.as_mut().unwrap().edges[0].target = DependencyTarget::Object {
        object: DependencyObjectRef::Table {
            name: before.tables[1].name.clone(),
        },
    };
    let result = compare_snapshots(&before, &after).unwrap();
    let table = result
        .items
        .iter()
        .find(|item| item.object.name == before.tables[0].name)
        .unwrap();
    assert_eq!(table.result, ComparisonResultKind::Different);
    assert!(
        table
            .properties
            .iter()
            .any(|property| property.path == ["dependencies"]
                && property.result == ComparisonResultKind::Different)
    );
    assert!(table.properties.iter().any(|property| property.path
        == ["dependencies", "targetIdentity"]
        && property.result == ComparisonResultKind::NotComparable
        && property.reference.value.as_deref() == Some("{\"unidentifiedTargets\":1}")));
    assert!(result.summary.with_limitations > 0);
}

fn reconstruct(rows: &[SourceDiffLine], reference: bool) -> String {
    let mut result = String::new();
    for line in rows {
        if (reference && line.kind == SourceLineKind::Added)
            || (!reference && line.kind == SourceLineKind::Removed)
        {
            continue;
        }
        result.push_str(&line.text);
        result.push_str(match line.ending {
            SourceLineEnding::None => "",
            SourceLineEnding::Lf => "\n",
            SourceLineEnding::CrLf => "\r\n",
            SourceLineEnding::Cr => "\r",
        });
    }
    result
}

#[test]
fn exact_line_operations_reconstruct_original_unicode_whitespace_and_endings() {
    let cases = [
        ("", ""),
        ("", "x\n"),
        ("x\n", ""),
        ("á\r\nβ\r\n", "á\nβ\n"),
        ("same\nold\nend", "same\nnew\nend"),
        ("\n\n", "\n"),
        ("SELECT 'one  \n two';\r", "SELECT 'one\n two';\r\n"),
        ("x\nx\ny\n", "x\ny\nx\n"),
        ("one\ntwo\n", "prefix\none\ntwo\nsuffix"),
    ];
    for (reference, compared) in cases {
        let result = compare_source_lines(
            reference,
            compared,
            SourceDiffOptions {
                limit: 2_000,
                ..SourceDiffOptions::default()
            },
            || false,
        );
        assert_eq!(result.status, SourceDiffStatus::Complete);
        assert_eq!(reconstruct(&result.lines, true), reference);
        assert_eq!(reconstruct(&result.lines, false), compared);
        assert_eq!(result.exact_equal, reference == compared);
    }
}

#[test]
fn source_pages_are_bounded_and_cancellation_and_limits_are_explicit() {
    let before = "same\n".repeat(3_000);
    let first = compare_source_lines(
        &before,
        &before,
        SourceDiffOptions {
            limit: usize::MAX,
            ..SourceDiffOptions::default()
        },
        || false,
    );
    assert_eq!(first.lines.len(), 2_000);
    assert_eq!(first.next_offset, Some(2_000));
    assert_eq!(first.total_rows, Some(3_000));
    let second = compare_source_lines(
        &before,
        &before,
        SourceDiffOptions {
            offset: 2_000,
            limit: 2_000,
            ..SourceDiffOptions::default()
        },
        || false,
    );
    assert_eq!(second.lines.len(), 1_000);
    assert_eq!(second.lines[0].reference_line, Some(2_001));
    assert_eq!(second.next_offset, None);
    let cancelled = compare_source_lines("a", "b", SourceDiffOptions::default(), || true);
    assert_eq!(cancelled.status, SourceDiffStatus::Cancelled);
    let limited = compare_source_lines(
        "a\nb\nc",
        "x\ny\nz",
        SourceDiffOptions {
            max_work: 1,
            ..SourceDiffOptions::default()
        },
        || false,
    );
    assert_eq!(limited.status, SourceDiffStatus::Limited);
    assert_eq!(limited.total_rows, None);
}
