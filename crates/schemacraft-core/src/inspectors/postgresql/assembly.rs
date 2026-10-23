//! Pure conversion of PostgreSQL catalog projections into native and common facts.

use std::collections::{BTreeMap, BTreeSet};

use chrono::Utc;

use super::catalog::{
    ColumnRow, ConstraintRow, DefinitionRow, DependencyRow, IndexRow, ObjectRow, RoutineRow,
    TriggerRow,
};
use crate::inspectors::{InspectionOptions, ServerInformation};
use crate::model::{
    AccessCounts, AccessProfile, CaptureScope, CaptureState, CheckConstraint, CodeCapture,
    CodeObjectRef, Column, Completeness, DatabaseProvider, Definition, DependencyEdge,
    DependencyKind, DependencyLimitation, DependencyObjectRef, DependencyReferenceStatus,
    DependencySnapshot, DependencySource, DependencyTarget, DmlEvent, FiringOrder, ForeignKey,
    ForeignKeyColumnPair, Index, IndexKind, ModuleBody, PostgreSqlAccessEvidence, PostgresqlColumn,
    PostgresqlConstraint, PostgresqlIndex, PostgresqlMetadata, PostgresqlRoutine, PostgresqlTable,
    PostgresqlTrigger, PostgresqlView, PrimaryKey, Programmability, ReferentialAction, Routine,
    RoutineDependencyTracking, RoutineKind, SchemaSnapshot, SqlDataType, Table, Trigger,
    TriggerEvent, TriggerTiming, TypeLength, UnknownFields, View, ViewModule,
};

pub(super) struct CatalogRows {
    pub objects: Vec<ObjectRow>,
    pub columns: Vec<ColumnRow>,
    pub indexes: Vec<IndexRow>,
    pub constraints: Vec<ConstraintRow>,
    pub routines: Vec<RoutineRow>,
    pub triggers: Vec<TriggerRow>,
    pub definitions: Vec<DefinitionRow>,
    pub objects_state: CaptureState,
    pub definitions_state: CaptureState,
}

pub(super) fn assemble(
    rows: &CatalogRows,
    server: ServerInformation,
    options: &InspectionOptions,
    mut evidence: PostgreSqlAccessEvidence,
) -> SchemaSnapshot {
    let objects: BTreeMap<_, _> = rows
        .objects
        .iter()
        .map(|object| (object.oid, object))
        .collect();
    let mut native = PostgresqlMetadata::default();
    let (tables, views) = assemble_relations(rows, &mut native);
    assemble_native_indexes(rows, &objects, &mut native);
    let foreign_keys = assemble_constraints(rows, &objects, &mut native);
    let code = assemble_programmability(rows, &objects, &mut native);
    evidence.programmability_catalog_read = rows.objects_state == CaptureState::Read;
    evidence.definitions = rows.definitions_state.clone();
    let scope = CaptureScope {
        schemas: options.schemas.clone(),
        include_views: options.include_views,
        include_programmability: rows.objects_state == CaptureState::Read,
        include_module_definitions: rows.definitions_state == CaptureState::Read,
    };
    let mut snapshot = SchemaSnapshot {
        provider: DatabaseProvider::PostgreSql,
        postgresql: Some(native),
        database_name: server.database_name,
        server_version: Some(server.product),
        extracted_at: Utc::now(),
        access: None,
        tables,
        views,
        foreign_keys,
        foreign_keys_to_invisible_tables: Vec::new(),
        carried_over: Vec::new(),
        programmability: Some(code),
        dependencies: None,
        unknown: UnknownFields::new(),
    };
    snapshot.access = Some(AccessProfile::from_postgresql(
        evidence,
        scope,
        AccessCounts::of(&snapshot),
        !snapshot.tables.is_empty() || !snapshot.views.is_empty(),
    ));
    snapshot
}

fn assemble_relations(
    rows: &CatalogRows,
    native: &mut PostgresqlMetadata,
) -> (Vec<Table>, Vec<View>) {
    let mut tables = Vec::new();
    let mut views = Vec::new();
    for object in &rows.objects {
        let columns: Vec<_> = rows
            .columns
            .iter()
            .filter(|column| column.object_oid == object.oid)
            .map(|column| {
                native.columns.push(native_column(column, object));
                column_from_row(column)
            })
            .collect();
        if matches!(object.kind.as_str(), "v" | "m") {
            views.push(View {
                name: object.name.clone(),
                columns,
            });
            native.views.push(PostgresqlView {
                name: object.name.clone(),
                is_materialized: object.kind == "m",
                is_populated: (object.kind == "m").then_some(object.populated),
                check_option: object.check_option.clone(),
            });
        } else {
            native.tables.push(PostgresqlTable {
                name: object.name.clone(),
                kind: if object.partition {
                    "partition"
                } else if object.kind == "p" {
                    "partitioned"
                } else {
                    "ordinary"
                }
                .into(),
            });
            tables.push(assemble_table(rows, object, columns));
        }
    }
    (tables, views)
}

fn native_column(column: &ColumnRow, object: &ObjectRow) -> PostgresqlColumn {
    PostgresqlColumn {
        object: object.name.clone(),
        name: column.name.clone(),
        type_name: column.type_name.clone(),
        type_kind: match column.type_kind.as_str() {
            "b" => "base",
            "c" => "composite",
            "d" => "domain",
            "e" => "enum",
            "r" => "range",
            "m" => "multirange",
            "p" => "pseudo",
            _ => "unknown",
        }
        .into(),
        identity_generation: match column.identity.as_str() {
            "a" => Some("always".into()),
            "d" => Some("byDefault".into()),
            _ => None,
        },
        generation: match column.generated.as_str() {
            "s" => Some("stored".into()),
            "v" => Some("virtual".into()),
            _ => None,
        },
        generation_expression: column
            .generation_expression
            .clone()
            .map(Definition::readable),
    }
}

fn assemble_table(rows: &CatalogRows, object: &ObjectRow, columns: Vec<Column>) -> Table {
    let indexes: Vec<_> = rows
        .indexes
        .iter()
        .filter(|index| index.table_oid == object.oid)
        .collect();
    let primary_key = indexes
        .iter()
        .find(|index| index.primary)
        .map(|index| PrimaryKey {
            name: index
                .constraint
                .clone()
                .unwrap_or_else(|| index.name.name.clone()),
            columns: index.key_columns.iter().flatten().cloned().collect(),
            is_clustered: false,
            is_enabled: None,
        });
    let check_constraints = rows
        .constraints
        .iter()
        .filter(|constraint| constraint.table_oid == object.oid && constraint.kind == "c")
        .map(|constraint| CheckConstraint {
            name: constraint.name.clone(),
            expression: constraint
                .expression
                .clone()
                .map_or(Definition::NotRecorded, Definition::readable),
            is_enabled: None,
            is_trusted: None,
        })
        .collect();
    Table {
        name: object.name.clone(),
        columns,
        primary_key,
        indexes: indexes
            .into_iter()
            .filter(|index| !index.primary)
            .map(common_index)
            .collect(),
        check_constraints,
    }
}

fn assemble_native_indexes(
    rows: &CatalogRows,
    objects: &BTreeMap<u32, &ObjectRow>,
    native: &mut PostgresqlMetadata,
) {
    for index in &rows.indexes {
        if let Some(table) = objects.get(&index.table_oid) {
            native.indexes.push(PostgresqlIndex {
                table: table.name.clone(),
                name: index.name.clone(),
                method: index.method.clone(),
                definition: Definition::readable(&index.definition),
                key_terms: index.key_terms.clone(),
                key_columns: index.key_columns.clone(),
                included_columns: index.included_columns.clone(),
                predicate: index.predicate.clone().map(Definition::readable),
                is_unique: index.unique,
                is_valid: index.valid,
                is_ready: index.ready,
                is_live: index.live,
                nulls_not_distinct: index.nulls_not_distinct,
                was_clustered: index.clustered,
                constraint: index.constraint.clone(),
            });
        }
    }
}

fn assemble_constraints(
    rows: &CatalogRows,
    objects: &BTreeMap<u32, &ObjectRow>,
    native: &mut PostgresqlMetadata,
) -> Vec<ForeignKey> {
    let mut foreign_keys = Vec::new();
    for constraint in &rows.constraints {
        let Some(table) = objects.get(&constraint.table_oid) else {
            continue;
        };
        native.constraints.push(PostgresqlConstraint {
            table: table.name.clone(),
            name: constraint.name.clone(),
            kind: match constraint.kind.as_str() {
                "p" => "primaryKey",
                "u" => "unique",
                "f" => "foreignKey",
                "c" => "check",
                "x" => "exclusion",
                _ => "unknown",
            }
            .into(),
            definition: Definition::readable(&constraint.definition),
            is_validated: constraint.validated,
            is_enforced: constraint.enforced,
            is_deferrable: constraint.deferrable,
            is_initially_deferred: constraint.initially_deferred,
            match_type: (constraint.kind == "f").then(|| {
                match constraint.match_type.as_str() {
                    "f" => "full",
                    "p" => "partial",
                    _ => "simple",
                }
                .into()
            }),
            delete_set_columns: constraint.delete_set_columns.clone(),
        });
        if constraint.kind == "f"
            && let Some(referenced) = &constraint.referenced_name
        {
            foreign_keys.push(ForeignKey {
                name: constraint.name.clone(),
                referencing_table: table.name.clone(),
                referenced_table: referenced.clone(),
                column_pairs: constraint
                    .columns
                    .iter()
                    .zip(&constraint.referenced_columns)
                    .map(|(left, right)| ForeignKeyColumnPair {
                        referencing_column: left.clone(),
                        referenced_column: right.clone(),
                    })
                    .collect(),
                on_delete: action(&constraint.on_delete),
                on_update: action(&constraint.on_update),
                is_enabled: constraint.enabled,
                is_trusted: None,
            });
        }
    }
    foreign_keys
}

fn assemble_programmability(
    rows: &CatalogRows,
    objects: &BTreeMap<u32, &ObjectRow>,
    native: &mut PostgresqlMetadata,
) -> Programmability {
    let definitions: BTreeMap<_, _> = rows
        .definitions
        .iter()
        .map(|row| ((row.kind.as_str(), row.oid), &row.text))
        .collect();
    let definition = |kind: &'static str, oid: u32| {
        definitions
            .get(&(kind, oid))
            .map_or(Definition::NotRecorded, |text| Definition::readable(*text))
    };
    let routines = assemble_routines(rows, &definition, native);
    let triggers = assemble_triggers(rows, objects, &definition, native);
    let code_views = if rows.objects_state == CaptureState::Read {
        rows.objects
            .iter()
            .filter(|row| matches!(row.kind.as_str(), "v" | "m"))
            .map(|row| ViewModule {
                view: row.name.clone(),
                definition: definition("view", row.oid),
                has_check_option: row.check_option != "none",
                is_indexed: false,
            })
            .collect()
    } else {
        Vec::new()
    };
    Programmability {
        capture: CodeCapture {
            objects: rows.objects_state.clone(),
            definitions: rows.definitions_state.clone(),
        },
        views: code_views,
        routines,
        triggers,
        carried_over: Vec::new(),
        unknown: UnknownFields::new(),
    }
}

fn assemble_routines(
    rows: &CatalogRows,
    definition: &impl Fn(&'static str, u32) -> Definition,
    native: &mut PostgresqlMetadata,
) -> Vec<Routine> {
    rows.routines
        .iter()
        .map(|row| {
            let routine = Routine {
                name: row.name.clone(),
                identity_arguments: Some(row.identity_arguments.clone()),
                kind: if row.kind == "p" {
                    RoutineKind::Procedure
                } else if row.returns_set {
                    RoutineKind::TableFunction
                } else {
                    RoutineKind::ScalarFunction
                },
                body: ModuleBody::PostgreSql {
                    name: row.language.clone(),
                    definition: definition("routine", row.oid),
                },
                parameters: row.parameters.clone(),
                returns: if row.returns_set {
                    None
                } else {
                    row.returns.clone()
                },
                columns: row.columns.clone(),
            };
            native.routines.push(PostgresqlRoutine {
                object: routine.object_ref(),
                language: row.language.clone(),
                routine_body_tracking: Some(routine_body_tracking(row)),
                returns_set: row.returns_set,
                arguments: None,
                result: row.result.clone(),
                argument_modes: row.argument_modes.clone(),
                definition_is_reconstructed: true,
            });
            routine
        })
        .collect()
}

fn routine_body_tracking(row: &RoutineRow) -> RoutineDependencyTracking {
    // prosqlbody stores the pre-parsed SQL-standard form, not string/PL bodies.
    // https://www.postgresql.org/docs/18/catalog-pg-proc.html
    if row.parsed_sql_body {
        RoutineDependencyTracking::ParsedSqlBody
    } else {
        RoutineDependencyTracking::SignatureOnly
    }
}

fn assemble_triggers(
    rows: &CatalogRows,
    objects: &BTreeMap<u32, &ObjectRow>,
    definition: &impl Fn(&'static str, u32) -> Definition,
    native: &mut PostgresqlMetadata,
) -> Vec<Trigger> {
    let mut triggers = Vec::new();
    for row in &rows.triggers {
        let Some(parent) = objects.get(&row.parent_oid) else {
            continue;
        };
        let trigger = Trigger {
            parent: parent.name.clone(),
            name: row.name.clone(),
            timing: match row.timing.as_str() {
                "before" => TriggerTiming::Before,
                "insteadOf" => TriggerTiming::InsteadOf,
                _ => TriggerTiming::After,
            },
            events: row
                .events
                .iter()
                .map(|event| TriggerEvent {
                    event: match event.as_str() {
                        "insert" => DmlEvent::Insert,
                        "delete" => DmlEvent::Delete,
                        "update" => DmlEvent::Update,
                        "truncate" => DmlEvent::Truncate,
                        _ => DmlEvent::Unknown,
                    },
                    order: FiringOrder::Unspecified,
                })
                .collect(),
            is_enabled: row.enabled_mode != "disabled",
            is_not_for_replication: false,
            body: ModuleBody::PostgreSql {
                name: "sql".into(),
                definition: definition("trigger", row.oid),
            },
        };
        let argument_types = rows
            .routines
            .iter()
            .find(|routine| routine.oid == row.function_oid)
            .map_or_else(Vec::new, |routine| routine.identity_arguments.clone());
        native.triggers.push(PostgresqlTrigger {
            object: trigger.object_ref(),
            function: Some(CodeObjectRef::RoutineOverload {
                name: row.function_name.clone(),
                argument_types,
            }),
            level: row.level.clone(),
            enabled_mode: row.enabled_mode.clone(),
            is_constraint: row.constraint,
            is_deferrable: row.deferrable,
            is_initially_deferred: row.initially_deferred,
            update_columns: row.update_columns.clone(),
        });
        triggers.push(trigger);
    }
    triggers
}

fn column_from_row(row: &ColumnRow) -> Column {
    Column {
        name: row.name.clone(),
        ordinal_position: row.ordinal,
        data_type: SqlDataType {
            name: row.type_name.name.clone(),
            length: row.length.map(|value| TypeLength::Fixed { value }),
            precision: row.precision,
            scale: row.scale,
            user_defined_type_name: (row.type_name.schema != "pg_catalog").then(|| {
                format!(
                    "{}.{}",
                    quote(&row.type_name.schema),
                    quote(&row.type_name.name)
                )
            }),
            native_declaration: Some(row.declaration.clone()),
        },
        is_nullable: row.nullable,
        default_expression: row.default_expression.clone().map(Definition::readable),
        is_identity: !row.identity.is_empty(),
        is_computed: !row.generated.is_empty(),
    }
}

fn common_index(row: &IndexRow) -> Index {
    Index {
        name: row.name.name.clone(),
        // An expression is not a column name. Keep no fabricated partial key in the common
        // projection; all exact terms remain in the native index record.
        columns: if row.key_columns.iter().any(Option::is_none) {
            Vec::new()
        } else {
            row.key_columns.iter().flatten().cloned().collect()
        },
        kind: if row.constraint.is_some() && row.unique {
            IndexKind::UniqueConstraint
        } else if row.unique {
            IndexKind::UniqueIndex
        } else {
            IndexKind::NonUnique
        },
        is_clustered: false,
        included_columns: Some(row.included_columns.clone()),
        is_filtered: Some(row.predicate.is_some()),
        is_enabled: None,
    }
}

fn action(value: &str) -> ReferentialAction {
    match value {
        "r" => ReferentialAction::Restrict,
        "c" => ReferentialAction::Cascade,
        "n" => ReferentialAction::SetNull,
        "d" => ReferentialAction::SetDefault,
        _ => ReferentialAction::NoAction,
    }
}

fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

/// Local catalog IDs are used only while joining one capture, never persisted as identity.
pub(super) fn object_ids(
    rows: &CatalogRows,
    include_code: bool,
) -> BTreeMap<(String, u32), DependencyObjectRef> {
    let mut result = BTreeMap::new();
    for object in &rows.objects {
        result.insert(
            ("relation".into(), object.oid),
            if matches!(object.kind.as_str(), "v" | "m") {
                DependencyObjectRef::View {
                    name: object.name.clone(),
                }
            } else {
                DependencyObjectRef::Table {
                    name: object.name.clone(),
                }
            },
        );
    }
    if include_code {
        for routine in &rows.routines {
            result.insert(
                ("routine".into(), routine.oid),
                DependencyObjectRef::Routine {
                    name: routine.name.clone(),
                    identity_arguments: Some(routine.identity_arguments.clone()),
                },
            );
        }
        for trigger in &rows.triggers {
            if let Some(parent) = rows
                .objects
                .iter()
                .find(|object| object.oid == trigger.parent_oid)
            {
                result.insert(
                    ("trigger".into(), trigger.oid),
                    DependencyObjectRef::Trigger {
                        parent: parent.name.clone(),
                        name: trigger.name.clone(),
                    },
                );
            }
        }
    }
    result
}

fn dependency_target(
    reference: &DependencyRow,
    identities: &BTreeMap<(String, u32), DependencyObjectRef>,
    options: &InspectionOptions,
) -> DependencyTarget {
    identities
        .get(&(reference.target_class.clone(), reference.target_oid))
        .map_or_else(
            || {
                let status = dependency_target_status(reference, options);
                DependencyTarget::Reference {
                    status,
                    server: None,
                    database: None,
                    schema: reference
                        .target_name
                        .as_ref()
                        .map(|name| name.schema.clone()),
                    name: reference.target_name.as_ref().map(|name| name.name.clone()),
                    object_class: Some(reference.target_kind.as_ref().map_or_else(
                        || reference.target_class.clone(),
                        |kind| format!("{}:{kind}", reference.target_class),
                    )),
                }
            },
            |object| DependencyTarget::Object {
                object: object.clone(),
            },
        )
}

fn dependency_target_status(
    reference: &DependencyRow,
    options: &InspectionOptions,
) -> DependencyReferenceStatus {
    let family_excluded = match (
        reference.target_class.as_str(),
        reference.target_kind.as_deref(),
    ) {
        ("relation", Some("r" | "p")) => false,
        ("relation", Some("v" | "m")) => !options.include_views,
        ("routine", Some("f" | "p")) => !options.include_programmability,
        // pg_class also contains sequences, indexes and foreign tables. Being absent from
        // inspected nodes does not turn one of those unsupported kinds into a scope choice.
        _ => return DependencyReferenceStatus::Unsupported,
    };
    let schema_excluded = reference.target_name.as_ref().is_some_and(|name| {
        name.schema.starts_with("pg_")
            || name.schema == "information_schema"
            || !options.includes_schema(&name.schema)
    });
    if family_excluded || schema_excluded {
        DependencyReferenceStatus::OutOfScope
    } else {
        DependencyReferenceStatus::NotVisible
    }
}

pub(super) fn dependencies(
    rows: &CatalogRows,
    references: &[super::catalog::DependencyRow],
    options: &InspectionOptions,
    state: CaptureState,
    observed_at: chrono::DateTime<Utc>,
) -> DependencySnapshot {
    let identities = object_ids(rows, options.include_programmability);
    let mut edges = Vec::new();
    let mut seen = BTreeSet::new();
    let mut limitations = vec![
        DependencyLimitation::RuntimeReferencesNotTracked,
        DependencyLimitation::RoutineBodiesNotFullyTracked,
    ];
    if state == CaptureState::Read {
        for reference in references {
            let Some(source) =
                identities.get(&(reference.source_class.clone(), reference.source_oid))
            else {
                continue;
            };
            if !seen.insert((
                reference.source_class.clone(),
                reference.source_oid,
                reference.target_class.clone(),
                reference.target_oid,
            )) {
                continue;
            }
            let target = dependency_target(reference, &identities, options);
            if matches!(
                target,
                DependencyTarget::Reference {
                    status: DependencyReferenceStatus::Unsupported,
                    ..
                }
            ) && !limitations.contains(&DependencyLimitation::UnsupportedTargets)
            {
                limitations.push(DependencyLimitation::UnsupportedTargets);
            }
            edges.push(DependencyEdge {
                source: source.clone(),
                target,
                kind: if reference.source_class == "trigger" && reference.target_class == "routine"
                {
                    DependencyKind::TriggerFunction
                } else {
                    DependencyKind::CatalogReference
                },
                is_schema_bound: None,
                read_at: observed_at,
                retained: false,
            });
        }
    }
    let scope = CaptureScope {
        schemas: options.schemas.clone(),
        include_views: options.include_views,
        include_programmability: options.include_programmability,
        include_module_definitions: false,
    };
    let sources = if state == CaptureState::Read {
        let routine_tracking: BTreeMap<_, _> = rows
            .routines
            .iter()
            .map(|routine| (routine.oid, routine_body_tracking(routine)))
            .collect();
        identities
            .into_iter()
            .map(|((class, oid), object)| DependencySource {
                object,
                coverage: Completeness::Complete,
                routine_body_tracking: if class == "routine" {
                    routine_tracking.get(&oid).copied()
                } else {
                    None
                },
                read_at: observed_at,
                retained: false,
            })
            .collect()
    } else {
        Vec::new()
    };
    DependencySnapshot {
        capture: state,
        scope,
        observed_at,
        sources,
        edges,
        limitations,
        unknown: UnknownFields::new(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;
    use crate::model::QualifiedName;

    fn reference(class: &str, kind: &str) -> DependencyRow {
        DependencyRow {
            source_class: "relation".into(),
            source_oid: 100,
            target_class: class.into(),
            target_kind: Some(kind.into()),
            target_oid: 200,
            target_name: Some(QualifiedName::new("sales", "target")),
        }
    }

    #[test]
    fn unsupported_catalog_kinds_are_never_promoted_to_scope_choices() {
        let options = InspectionOptions::default();
        for (class, kind) in [
            ("relation", "S"),
            ("relation", "i"),
            ("relation", "I"),
            ("relation", "f"),
            ("routine", "a"),
            ("routine", "w"),
        ] {
            let target = dependency_target(&reference(class, kind), &BTreeMap::new(), &options);
            assert!(matches!(target, DependencyTarget::Reference {
                status: DependencyReferenceStatus::Unsupported,
                object_class: Some(native_class), ..
            } if native_class == format!("{class}:{kind}")));
        }
    }

    #[test]
    fn only_explicitly_excluded_supported_targets_are_out_of_scope() {
        let everything = InspectionOptions::default();
        for (class, kind) in [
            ("relation", "r"),
            ("relation", "p"),
            ("relation", "v"),
            ("relation", "m"),
            ("routine", "f"),
            ("routine", "p"),
        ] {
            assert_eq!(
                dependency_target_status(&reference(class, kind), &everything),
                DependencyReferenceStatus::NotVisible,
            );
            let selected = InspectionOptions {
                schemas: vec!["other".into()],
                ..everything.clone()
            };
            assert_eq!(
                dependency_target_status(&reference(class, kind), &selected),
                DependencyReferenceStatus::OutOfScope,
            );
        }
        for (class, kind) in [("relation", "v"), ("relation", "m"), ("routine", "f")] {
            let families_off = InspectionOptions {
                include_views: false,
                include_programmability: false,
                ..everything.clone()
            };
            assert_eq!(
                dependency_target_status(&reference(class, kind), &families_off),
                DependencyReferenceStatus::OutOfScope,
            );
        }
        let mut system = reference("routine", "f");
        system.target_name = Some(QualifiedName::new("pg_catalog", "builtin"));
        assert_eq!(
            dependency_target_status(&system, &everything),
            DependencyReferenceStatus::OutOfScope,
        );
    }

    #[test]
    fn captured_target_identity_wins_and_sequence_limitations_are_retained() {
        let options = InspectionOptions::default();
        let name = QualifiedName::new("sales", "target");
        let identities = BTreeMap::from([(
            ("relation".into(), 200),
            DependencyObjectRef::Table { name: name.clone() },
        )]);
        assert_eq!(
            dependency_target(&reference("relation", "r"), &identities, &options),
            DependencyTarget::Object {
                object: DependencyObjectRef::Table { name }
            },
        );
        let rows = CatalogRows {
            objects: vec![ObjectRow {
                oid: 100,
                name: QualifiedName::new("sales", "source"),
                kind: "r".into(),
                partition: false,
                populated: true,
                check_option: "none".into(),
            }],
            columns: Vec::new(),
            indexes: Vec::new(),
            constraints: Vec::new(),
            routines: Vec::new(),
            triggers: Vec::new(),
            definitions: Vec::new(),
            objects_state: CaptureState::Read,
            definitions_state: CaptureState::Read,
        };
        let family = dependencies(
            &rows,
            &[reference("relation", "S")],
            &options,
            CaptureState::Read,
            Utc::now(),
        );
        assert!(
            family
                .limitations
                .contains(&DependencyLimitation::UnsupportedTargets)
        );
        assert_eq!(family.edges.len(), 1);
        assert!(matches!(
            &family.edges[0].target,
            DependencyTarget::Reference {
                status: DependencyReferenceStatus::Unsupported,
                ..
            }
        ));
    }
}
