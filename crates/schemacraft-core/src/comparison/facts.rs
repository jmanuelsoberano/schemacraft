use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::{
    ComparisonCapture, ComparisonError, ComparisonItem, ComparisonObjectKind, ComparisonObjectRef,
    ComparisonObservation, ComparisonObservationStatus as Status, ComparisonProperty,
    ComparisonResultKind as Outcome, ComparisonSummary, ComparisonValue, DefinitionTextComparison,
    ProjectComparison,
};
use crate::model::{
    CaptureState, CarriedPart, CodeObjectRef, Column, Completeness, DatabaseProvider, Definition,
    DependencyEdge, DependencyObjectRef, DependencySnapshot, DependencySource, DependencyTarget,
    ForeignKey, ForeignKeyToInvisibleTable, ModuleBody, NotReadReason, QualifiedName, Routine,
    SchemaSnapshot, SnapshotFact, Table, compare_dependency_edges, unidentified_dependency_targets,
};
use crate::source_text::comparable_text;

type Properties = BTreeMap<Vec<String>, ComparisonValue>;

struct Object<'a> {
    observation: ComparisonObservation,
    properties: Properties,
    definition: Option<&'a Definition>,
    definition_observation: ComparisonObservation,
    // These private references can contain external destination identifiers. Only projected
    // count/state values enter the public result; topology equality keys never leave the core.
    dependency_edges: Option<Vec<&'a DependencyEdge>>,
}

fn observation(status: Status, snapshot: &SchemaSnapshot) -> ComparisonObservation {
    ComparisonObservation {
        status,
        read_at: matches!(status, Status::Observed).then_some(snapshot.extracted_at),
    }
}

fn value(observation: &ComparisonObservation, value: &impl Serialize) -> ComparisonValue {
    let encoded = serde_json::to_string(value).ok();
    ComparisonValue {
        observation: if encoded.is_some() {
            observation.clone()
        } else {
            ComparisonObservation {
                status: Status::Unknown,
                read_at: None,
            }
        },
        value: encoded,
    }
}

fn unavailable(status: Status) -> ComparisonValue {
    ComparisonValue {
        observation: ComparisonObservation {
            status,
            read_at: None,
        },
        value: None,
    }
}

fn add(
    properties: &mut Properties,
    path: &[&str],
    evidence: &ComparisonObservation,
    fact: &impl Serialize,
) {
    properties.insert(
        path.iter().map(|part| (*part).to_string()).collect(),
        value(evidence, fact),
    );
}

fn optional<T: Serialize>(
    properties: &mut Properties,
    path: &[&str],
    evidence: &ComparisonObservation,
    fact: Option<&T>,
) {
    properties.insert(
        path.iter().map(|part| (*part).to_string()).collect(),
        fact.map_or_else(
            || unavailable(Status::NotRecorded),
            |fact| value(evidence, fact),
        ),
    );
}

fn definition_value(definition: &Definition, evidence: &ComparisonObservation) -> ComparisonValue {
    match definition {
        Definition::Readable { text } => value(evidence, text),
        Definition::NotVisible => unavailable(Status::NotVisible),
        Definition::NotRecorded => unavailable(Status::NotRecorded),
        Definition::Encrypted => value(evidence, &"encrypted"),
        Definition::Unknown => unavailable(Status::Unknown),
    }
}

fn retained_fact(
    snapshot: &SchemaSnapshot,
    name: &QualifiedName,
    fact: &SnapshotFact,
) -> Option<ComparisonObservation> {
    snapshot
        .carried_over
        .iter()
        .find(|item| &item.object == name && &item.fact == fact)
        .map(|item| ComparisonObservation {
            status: Status::Retained,
            read_at: Some(item.read_at),
        })
}

fn object_evidence(snapshot: &SchemaSnapshot, id: &ComparisonObjectRef) -> ComparisonObservation {
    let fact = match id.kind {
        ComparisonObjectKind::Table => Some(SnapshotFact::Table),
        ComparisonObjectKind::View => Some(SnapshotFact::View),
        ComparisonObjectKind::ForeignKey | ComparisonObjectKind::Trigger => {
            if snapshot.table(&id.name).is_some() {
                Some(SnapshotFact::Table)
            } else {
                Some(SnapshotFact::View)
            }
        }
        ComparisonObjectKind::Routine => None,
    };
    if let Some(evidence) = fact
        .as_ref()
        .and_then(|fact| retained_fact(snapshot, &id.name, fact))
    {
        return evidence;
    }
    if let Some(code_ref) = code_ref(id)
        && let Some(evidence) = snapshot.programmability.as_ref().and_then(|code| {
            code.carried_over
                .iter()
                .find(|item| item.object == code_ref && item.part == CarriedPart::Whole)
        })
    {
        return ComparisonObservation {
            status: Status::Retained,
            read_at: Some(evidence.read_at),
        };
    }
    observation(Status::Observed, snapshot)
}

fn code_ref(id: &ComparisonObjectRef) -> Option<CodeObjectRef> {
    match id.kind {
        ComparisonObjectKind::View => Some(CodeObjectRef::View {
            name: id.name.clone(),
        }),
        ComparisonObjectKind::Routine => Some(id.identity_arguments.as_ref().map_or_else(
            || CodeObjectRef::Routine {
                name: id.name.clone(),
            },
            |argument_types| CodeObjectRef::RoutineOverload {
                name: id.name.clone(),
                argument_types: argument_types.clone(),
            },
        )),
        ComparisonObjectKind::Trigger => {
            id.member_name.as_ref().map(|name| CodeObjectRef::Trigger {
                parent: id.name.clone(),
                name: name.clone(),
            })
        }
        ComparisonObjectKind::Table | ComparisonObjectKind::ForeignKey => None,
    }
}

fn empty_object<'a>(snapshot: &SchemaSnapshot, id: &ComparisonObjectRef) -> Object<'a> {
    let evidence = object_evidence(snapshot, id);
    Object {
        observation: evidence.clone(),
        properties: Properties::new(),
        definition: None,
        definition_observation: evidence,
        dependency_edges: None,
    }
}

fn identity(
    kind: ComparisonObjectKind,
    name: &QualifiedName,
    member_name: Option<&str>,
) -> ComparisonObjectRef {
    ComparisonObjectRef {
        kind,
        name: name.clone(),
        member_name: member_name.map(str::to_string),
        identity_arguments: None,
    }
}

fn columns(
    object: &mut Object<'_>,
    columns: &[Column],
    snapshot: &SchemaSnapshot,
    name: &QualifiedName,
    include_defaults: bool,
) {
    for column in columns {
        let prefix = ["columns", column.name.as_str()];
        add(&mut object.properties, &prefix, &object.observation, &true);
        for (property, encoded) in [
            ("dataType", value(&object.observation, &column.data_type)),
            (
                "nullability",
                value(&object.observation, &column.is_nullable),
            ),
            ("identity", value(&object.observation, &column.is_identity)),
            ("computed", value(&object.observation, &column.is_computed)),
        ] {
            object.properties.insert(
                vec![
                    "columns".to_string(),
                    column.name.clone(),
                    property.to_string(),
                ],
                encoded,
            );
        }
        if !include_defaults {
            continue;
        }
        let fact = SnapshotFact::ColumnDefault {
            column: column.name.clone(),
        };
        let evidence =
            retained_fact(snapshot, name, &fact).unwrap_or_else(|| object.observation.clone());
        let default = column.default_expression.as_ref().map_or_else(
            || {
                unavailable(if snapshot.access.is_some() {
                    Status::Absent
                } else {
                    Status::NotRecorded
                })
            },
            |definition| definition_value(definition, &evidence),
        );
        object.properties.insert(
            vec![
                "columns".to_string(),
                column.name.clone(),
                "defaultExpression".to_string(),
            ],
            default,
        );
    }
}

fn table_objects<'a>(
    snapshot: &'a SchemaSnapshot,
    result: &mut BTreeMap<ComparisonObjectRef, Object<'a>>,
) {
    for table in &snapshot.tables {
        let id = identity(ComparisonObjectKind::Table, &table.name, None);
        let mut object = empty_object(snapshot, &id);
        columns(&mut object, &table.columns, snapshot, &table.name, true);
        table_primary_key(&mut object, table, snapshot.provider);
        table_indexes(&mut object, table, snapshot.provider);
        table_checks(&mut object, table, snapshot);
        result.insert(id, object);
    }
    view_objects(snapshot, result);
}

fn table_primary_key(object: &mut Object<'_>, table: &Table, provider: DatabaseProvider) {
    if let Some(key) = &table.primary_key {
        add(
            &mut object.properties,
            &["primaryKey", "name"],
            &object.observation,
            &key.name,
        );
        add(
            &mut object.properties,
            &["primaryKey", "columns"],
            &object.observation,
            &key.columns,
        );
        if provider == DatabaseProvider::SqlServer {
            add(
                &mut object.properties,
                &["primaryKey", "clustered"],
                &object.observation,
                &key.is_clustered,
            );
            optional(
                &mut object.properties,
                &["primaryKey", "enabled"],
                &object.observation,
                key.is_enabled.as_ref(),
            );
        }
    }
}

fn table_indexes(object: &mut Object<'_>, table: &Table, provider: DatabaseProvider) {
    for index in &table.indexes {
        for (property, encoded) in [
            ("columns", value(&object.observation, &index.columns)),
            ("kind", value(&object.observation, &index.kind)),
            ("clustered", value(&object.observation, &index.is_clustered)),
            (
                "includedColumns",
                index.included_columns.as_ref().map_or_else(
                    || unavailable(Status::NotRecorded),
                    |fact| value(&object.observation, fact),
                ),
            ),
            (
                "filtered",
                index.is_filtered.as_ref().map_or_else(
                    || unavailable(Status::NotRecorded),
                    |fact| value(&object.observation, fact),
                ),
            ),
            (
                "enabled",
                index.is_enabled.as_ref().map_or_else(
                    || unavailable(Status::NotRecorded),
                    |fact| value(&object.observation, fact),
                ),
            ),
        ] {
            // PostgreSQL records index validity/readiness and CLUSTER history natively.
            // An inapplicable SQL Server flag is not an unrecorded PostgreSQL fact.
            if provider == DatabaseProvider::PostgreSql
                && matches!(property, "clustered" | "enabled")
            {
                continue;
            }
            object.properties.insert(
                vec![
                    "indexes".to_string(),
                    index.name.clone(),
                    property.to_string(),
                ],
                encoded,
            );
        }
    }
}

fn table_checks(object: &mut Object<'_>, table: &Table, snapshot: &SchemaSnapshot) {
    for check in &table.check_constraints {
        let evidence = retained_fact(
            snapshot,
            &table.name,
            &SnapshotFact::CheckConstraint {
                name: check.name.clone(),
            },
        )
        .unwrap_or_else(|| object.observation.clone());
        object.properties.insert(
            vec![
                "checkConstraints".to_string(),
                check.name.clone(),
                "expression".to_string(),
            ],
            definition_value(&check.expression, &evidence),
        );
        if snapshot.provider == DatabaseProvider::SqlServer {
            optional(
                &mut object.properties,
                &["checkConstraints", &check.name, "enabled"],
                &object.observation,
                check.is_enabled.as_ref(),
            );
            optional(
                &mut object.properties,
                &["checkConstraints", &check.name, "trusted"],
                &object.observation,
                check.is_trusted.as_ref(),
            );
        }
    }
}

fn view_objects<'a>(
    snapshot: &'a SchemaSnapshot,
    result: &mut BTreeMap<ComparisonObjectRef, Object<'a>>,
) {
    for view in &snapshot.views {
        let id = identity(ComparisonObjectKind::View, &view.name, None);
        let mut object = empty_object(snapshot, &id);
        columns(&mut object, &view.columns, snapshot, &view.name, false);
        if let Some(module) = snapshot
            .programmability
            .as_ref()
            .and_then(|code| code.views.iter().find(|module| module.view == view.name))
        {
            add(
                &mut object.properties,
                &["viewSettings", "checkOption"],
                &object.observation,
                &module.has_check_option,
            );
            if snapshot.provider == DatabaseProvider::SqlServer {
                add(
                    &mut object.properties,
                    &["viewSettings", "indexed"],
                    &object.observation,
                    &module.is_indexed,
                );
            }
            attach_definition(&mut object, snapshot, &id, &module.definition);
        } else {
            let status = code_capture_status(snapshot, false);
            object.properties.insert(
                vec!["viewSettings".to_string(), "checkOption".to_string()],
                unavailable(status),
            );
            if snapshot.provider == DatabaseProvider::SqlServer {
                object.properties.insert(
                    vec!["viewSettings".to_string(), "indexed".to_string()],
                    unavailable(status),
                );
            }
            object.properties.insert(
                vec!["definitionState".to_string()],
                unavailable(code_capture_status(snapshot, true)),
            );
        }
        result.insert(id, object);
    }
}

fn code_capture_status(snapshot: &SchemaSnapshot, definitions: bool) -> Status {
    let Some(code) = &snapshot.programmability else {
        return Status::NotRecorded;
    };
    let capture = if definitions {
        &code.capture.definitions
    } else {
        &code.capture.objects
    };
    match capture {
        CaptureState::Read => Status::NotRecorded,
        CaptureState::NotRead {
            reason: NotReadReason::OptionOff,
        } => Status::Excluded,
        CaptureState::NotRead {
            reason: NotReadReason::QueryFailed | NotReadReason::TimedOut,
        } => Status::Failed,
        CaptureState::NotRead {
            reason: NotReadReason::PermissionDenied,
        } => Status::NotVisible,
        CaptureState::NotRead {
            reason: NotReadReason::Unknown,
        }
        | CaptureState::Unknown => Status::Unknown,
    }
}

fn attach_definition<'a>(
    object: &mut Object<'a>,
    snapshot: &SchemaSnapshot,
    id: &ComparisonObjectRef,
    definition: &'a Definition,
) {
    let evidence = code_ref(id)
        .and_then(|id| {
            snapshot
                .programmability
                .as_ref()?
                .carried_over
                .iter()
                .find(|item| item.object == id && item.part == CarriedPart::Definition)
        })
        .map_or_else(
            || object.observation.clone(),
            |item| ComparisonObservation {
                status: Status::Retained,
                read_at: Some(item.read_at),
            },
        );
    let state = match definition {
        Definition::Readable { .. } => value(&evidence, &"readable"),
        Definition::Encrypted => value(&evidence, &"encrypted"),
        Definition::NotVisible => unavailable(Status::NotVisible),
        Definition::NotRecorded => unavailable(code_capture_status(snapshot, true)),
        Definition::Unknown => unavailable(Status::Unknown),
    };
    object.definition = Some(definition);
    object.definition_observation = state.observation.clone();
    object
        .properties
        .insert(vec!["definitionState".to_string()], state);
}

fn attach_body<'a>(
    object: &mut Object<'a>,
    snapshot: &SchemaSnapshot,
    id: &ComparisonObjectRef,
    body: &'a ModuleBody,
) {
    match body {
        ModuleBody::Sql { definition } => {
            add(
                &mut object.properties,
                &["language"],
                &object.observation,
                &"sql",
            );
            attach_definition(object, snapshot, id, definition);
        }
        ModuleBody::PostgreSql { name, definition } => {
            add(
                &mut object.properties,
                &["language"],
                &object.observation,
                name,
            );
            attach_definition(object, snapshot, id, definition);
        }
        ModuleBody::Clr => add(
            &mut object.properties,
            &["language"],
            &object.observation,
            &"clr",
        ),
        ModuleBody::Unknown => {
            object
                .properties
                .insert(vec!["language".to_string()], unavailable(Status::Unknown));
        }
    }
}

fn routine_properties(object: &mut Object<'_>, routine: &Routine, snapshot: &SchemaSnapshot) {
    let kind = serde_json::to_value(routine.kind).ok();
    object.properties.insert(
        vec!["routineKind".to_string()],
        if kind.as_ref().is_some_and(|kind| kind == "unknown") {
            unavailable(Status::Unknown)
        } else {
            value(&object.observation, &routine.kind)
        },
    );
    add(
        &mut object.properties,
        &["parameters"],
        &object.observation,
        &routine.parameters,
    );
    add(
        &mut object.properties,
        &["returns"],
        &object.observation,
        &routine.returns,
    );
    columns(object, &routine.columns, snapshot, &routine.name, false);
}

fn code_objects<'a>(
    snapshot: &'a SchemaSnapshot,
    result: &mut BTreeMap<ComparisonObjectRef, Object<'a>>,
) {
    let Some(code) = &snapshot.programmability else {
        return;
    };
    for routine in &code.routines {
        let mut id = identity(ComparisonObjectKind::Routine, &routine.name, None);
        id.identity_arguments
            .clone_from(&routine.identity_arguments);
        let mut object = empty_object(snapshot, &id);
        routine_properties(&mut object, routine, snapshot);
        attach_body(&mut object, snapshot, &id, &routine.body);
        result.insert(id, object);
    }
    for trigger in &code.triggers {
        let id = identity(
            ComparisonObjectKind::Trigger,
            &trigger.parent,
            Some(&trigger.name),
        );
        let mut object = empty_object(snapshot, &id);
        let timing = serde_json::to_value(trigger.timing).ok();
        object.properties.insert(
            vec!["timing".to_string()],
            if timing.as_ref().is_some_and(|timing| timing == "unknown") {
                unavailable(Status::Unknown)
            } else {
                value(&object.observation, &trigger.timing)
            },
        );
        let mut events = trigger.events.clone();
        events.sort_by_key(|event| event.event);
        if events.iter().any(|event| {
            matches!(event.event, crate::model::DmlEvent::Unknown)
                || matches!(event.order, crate::model::FiringOrder::Unknown)
        }) {
            object
                .properties
                .insert(vec!["events".to_string()], unavailable(Status::Unknown));
        } else {
            add(
                &mut object.properties,
                &["events"],
                &object.observation,
                &events,
            );
        }
        add(
            &mut object.properties,
            &["enabled"],
            &object.observation,
            &trigger.is_enabled,
        );
        if snapshot.provider == DatabaseProvider::SqlServer {
            add(
                &mut object.properties,
                &["notForReplication"],
                &object.observation,
                &trigger.is_not_for_replication,
            );
        }
        attach_body(&mut object, snapshot, &id, &trigger.body);
        result.insert(id, object);
    }
}

fn foreign_key<'a>(
    snapshot: &SchemaSnapshot,
    key: &ForeignKey,
) -> (ComparisonObjectRef, Object<'a>) {
    let id = identity(
        ComparisonObjectKind::ForeignKey,
        &key.referencing_table,
        Some(&key.name),
    );
    let mut object = empty_object(snapshot, &id);
    let target_evidence = retained_fact(
        snapshot,
        &key.referencing_table,
        &SnapshotFact::ForeignKey {
            name: key.name.clone(),
        },
    )
    .unwrap_or_else(|| object.observation.clone());
    add(
        &mut object.properties,
        &["referencedTable"],
        &target_evidence,
        &key.referenced_table,
    );
    let local: Vec<_> = key
        .column_pairs
        .iter()
        .map(|pair| &pair.referencing_column)
        .collect();
    let remote: Vec<_> = key
        .column_pairs
        .iter()
        .map(|pair| &pair.referenced_column)
        .collect();
    add(
        &mut object.properties,
        &["referencingColumns"],
        &object.observation,
        &local,
    );
    add(
        &mut object.properties,
        &["referencedColumns"],
        &target_evidence,
        &remote,
    );
    add(
        &mut object.properties,
        &["onDelete"],
        &object.observation,
        &key.on_delete,
    );
    add(
        &mut object.properties,
        &["onUpdate"],
        &object.observation,
        &key.on_update,
    );
    add(
        &mut object.properties,
        &["enabled"],
        &object.observation,
        &key.is_enabled,
    );
    if snapshot.provider == DatabaseProvider::SqlServer {
        optional(
            &mut object.properties,
            &["trusted"],
            &object.observation,
            key.is_trusted.as_ref(),
        );
    }
    (id, object)
}

fn invisible_key<'a>(
    snapshot: &SchemaSnapshot,
    key: &ForeignKeyToInvisibleTable,
) -> (ComparisonObjectRef, Object<'a>) {
    let id = identity(
        ComparisonObjectKind::ForeignKey,
        &key.referencing_table,
        Some(&key.name),
    );
    let mut object = empty_object(snapshot, &id);
    object.properties.insert(
        vec!["referencedTable".to_string()],
        unavailable(Status::NotVisible),
    );
    object.properties.insert(
        vec!["referencedColumns".to_string()],
        unavailable(Status::NotVisible),
    );
    add(
        &mut object.properties,
        &["referencingColumns"],
        &object.observation,
        &key.columns,
    );
    add(
        &mut object.properties,
        &["onDelete"],
        &object.observation,
        &key.on_delete,
    );
    add(
        &mut object.properties,
        &["onUpdate"],
        &object.observation,
        &key.on_update,
    );
    add(
        &mut object.properties,
        &["enabled"],
        &object.observation,
        &key.is_enabled,
    );
    if snapshot.provider == DatabaseProvider::SqlServer {
        optional(
            &mut object.properties,
            &["trusted"],
            &object.observation,
            key.is_trusted.as_ref(),
        );
    }
    (id, object)
}

fn objects(snapshot: &SchemaSnapshot) -> BTreeMap<ComparisonObjectRef, Object<'_>> {
    let mut result = BTreeMap::new();
    table_objects(snapshot, &mut result);
    code_objects(snapshot, &mut result);
    result.extend(
        snapshot
            .foreign_keys
            .iter()
            .map(|key| foreign_key(snapshot, key)),
    );
    result.extend(
        snapshot
            .foreign_keys_to_invisible_tables
            .iter()
            .map(|key| invisible_key(snapshot, key)),
    );
    dependency_properties(snapshot, &mut result);
    native_properties(snapshot, &mut result);
    result
}

fn dependency_ref(id: &ComparisonObjectRef) -> Option<DependencyObjectRef> {
    match id.kind {
        ComparisonObjectKind::Table => Some(DependencyObjectRef::Table {
            name: id.name.clone(),
        }),
        ComparisonObjectKind::View => Some(DependencyObjectRef::View {
            name: id.name.clone(),
        }),
        ComparisonObjectKind::Routine => Some(DependencyObjectRef::Routine {
            name: id.name.clone(),
            identity_arguments: id.identity_arguments.clone(),
        }),
        ComparisonObjectKind::Trigger => {
            id.member_name
                .as_ref()
                .map(|name| DependencyObjectRef::Trigger {
                    parent: id.name.clone(),
                    name: name.clone(),
                })
        }
        ComparisonObjectKind::ForeignKey => None,
    }
}

fn dependency_properties<'a>(
    snapshot: &'a SchemaSnapshot,
    objects: &mut BTreeMap<ComparisonObjectRef, Object<'a>>,
) {
    let sources: BTreeMap<_, _> = snapshot
        .dependencies
        .iter()
        .flat_map(|family| &family.sources)
        .map(|source| (&source.object, source))
        .collect();
    let mut edges_by_source = BTreeMap::<_, Vec<_>>::new();
    for edge in snapshot
        .dependencies
        .iter()
        .flat_map(|family| &family.edges)
    {
        edges_by_source.entry(&edge.source).or_default().push(edge);
    }
    for (id, object) in objects {
        let Some(source) = dependency_ref(id) else {
            continue;
        };
        let path = vec!["dependencies".to_string()];
        let Some(dependencies) = &snapshot.dependencies else {
            object
                .properties
                .insert(path, unavailable(Status::NotRecorded));
            continue;
        };
        let evidence = dependency_evidence(dependencies, sources.get(&source).copied());
        let edges = edges_by_source.get(&source).map_or(&[][..], Vec::as_slice);
        let unidentified = unidentified_dependency_targets(edges);
        if unidentified != 0 {
            let mut identity_evidence = evidence.clone();
            if identity_evidence.status == Status::Observed {
                identity_evidence.status = Status::NotVisible;
            }
            add(
                &mut object.properties,
                &["dependencies", "targetIdentity"],
                &identity_evidence,
                &serde_json::json!({ "unidentifiedTargets": unidentified }),
            );
        }
        let resolved = edges
            .iter()
            .filter(|edge| matches!(edge.target, DependencyTarget::Object { .. }))
            .count();
        let projected = serde_json::json!({ "knownReferences": edges.len(), "resolvedReferences": resolved, "referenceLocationsOmitted": true });
        object
            .properties
            .insert(path.clone(), value(&evidence, &projected));
        object.dependency_edges = Some(edges.to_vec());
    }
}

fn dependency_evidence(
    dependencies: &DependencySnapshot,
    source: Option<&DependencySource>,
) -> ComparisonObservation {
    source.map_or_else(
        || ComparisonObservation {
            status: match &dependencies.capture {
                CaptureState::NotRead {
                    reason: NotReadReason::OptionOff,
                } => Status::Excluded,
                CaptureState::NotRead {
                    reason: NotReadReason::QueryFailed | NotReadReason::TimedOut,
                } => Status::Failed,
                CaptureState::NotRead {
                    reason: NotReadReason::PermissionDenied,
                } => Status::NotVisible,
                CaptureState::Read => Status::NotRecorded,
                CaptureState::Unknown
                | CaptureState::NotRead {
                    reason: NotReadReason::Unknown,
                } => Status::Unknown,
            },
            read_at: None,
        },
        |item| ComparisonObservation {
            status: if item.retained {
                Status::Retained
            } else if item.coverage == Completeness::Complete {
                Status::Observed
            } else {
                Status::NotVisible
            },
            read_at: Some(item.read_at),
        },
    )
}

fn from_code(reference: &CodeObjectRef) -> Option<ComparisonObjectRef> {
    match reference {
        CodeObjectRef::View { name } => Some(identity(ComparisonObjectKind::View, name, None)),
        CodeObjectRef::Routine { name } => {
            Some(identity(ComparisonObjectKind::Routine, name, None))
        }
        CodeObjectRef::RoutineOverload {
            name,
            argument_types,
        } => {
            let mut id = identity(ComparisonObjectKind::Routine, name, None);
            id.identity_arguments = Some(argument_types.clone());
            Some(id)
        }
        CodeObjectRef::Trigger { parent, name } => {
            Some(identity(ComparisonObjectKind::Trigger, parent, Some(name)))
        }
        CodeObjectRef::Unknown => None,
    }
}

fn native_record(object: &mut Object<'_>, prefix: &[&str], record: &impl Serialize, omit: &[&str]) {
    let Ok(serde_json::Value::Object(fields)) = serde_json::to_value(record) else {
        return;
    };
    for (field, fact) in fields {
        if omit.iter().any(|omitted| *omitted == field) {
            continue;
        }
        let mut path: Vec<_> = prefix.iter().map(|part| (*part).to_string()).collect();
        path.push(field.clone());
        let captured = if fact.get("status").is_some() {
            serde_json::from_value::<Definition>(fact).map_or_else(
                |_| unavailable(Status::Unknown),
                |definition| definition_value(&definition, &object.observation),
            )
        } else if fact == "unknown" {
            unavailable(Status::Unknown)
        } else if fact.is_null() && field == "isEnforced" {
            unavailable(Status::NotRecorded)
        } else {
            value(&object.observation, &fact)
        };
        object.properties.insert(path, captured);
    }
}

fn native_routine_properties(object: &mut Object<'_>, routine: &crate::model::PostgresqlRoutine) {
    // Argument defaults are part of reconstructed module source. Do not copy that
    // argument SQL into a generic structural result that a report might serialize.
    native_record(
        object,
        &["postgresql", "routine"],
        routine,
        &["object", "arguments", "definitionIsReconstructed"],
    );
    if routine.routine_body_tracking.is_none() {
        object.properties.insert(
            vec![
                "postgresql".into(),
                "routine".into(),
                "routineBodyTracking".into(),
            ],
            unavailable(Status::NotRecorded),
        );
    }
}

fn native_properties(
    snapshot: &SchemaSnapshot,
    objects: &mut BTreeMap<ComparisonObjectRef, Object<'_>>,
) {
    if snapshot.provider != crate::model::DatabaseProvider::PostgreSql {
        return;
    }
    let Some(native) = &snapshot.postgresql else {
        for object in objects.values_mut() {
            object.properties.insert(
                vec!["postgresql".to_string()],
                unavailable(Status::NotRecorded),
            );
        }
        return;
    };
    for table in &native.tables {
        if let Some(object) =
            objects.get_mut(&identity(ComparisonObjectKind::Table, &table.name, None))
        {
            native_record(object, &["postgresql", "table"], table, &["name"]);
        }
    }
    for view in &native.views {
        if let Some(object) =
            objects.get_mut(&identity(ComparisonObjectKind::View, &view.name, None))
        {
            native_record(object, &["postgresql", "view"], view, &["name"]);
        }
    }
    for column in &native.columns {
        let kind =
            if objects.contains_key(&identity(ComparisonObjectKind::Table, &column.object, None)) {
                ComparisonObjectKind::Table
            } else {
                ComparisonObjectKind::View
            };
        if let Some(object) = objects.get_mut(&identity(kind, &column.object, None)) {
            native_record(
                object,
                &["postgresql", "columns", &column.name],
                column,
                &["object", "name"],
            );
        }
    }
    for index in &native.indexes {
        let kind =
            if objects.contains_key(&identity(ComparisonObjectKind::Table, &index.table, None)) {
                ComparisonObjectKind::Table
            } else {
                ComparisonObjectKind::View
            };
        if let Some(object) = objects.get_mut(&identity(kind, &index.table, None)) {
            native_record(
                object,
                &["postgresql", "indexes", &index.name.name],
                index,
                &["table", "name"],
            );
        }
    }
    for constraint in &native.constraints {
        let id = if constraint.kind == "foreignKey" {
            identity(
                ComparisonObjectKind::ForeignKey,
                &constraint.table,
                Some(&constraint.name),
            )
        } else {
            identity(ComparisonObjectKind::Table, &constraint.table, None)
        };
        if let Some(object) = objects.get_mut(&id) {
            native_record(
                object,
                &["postgresql", "constraints", &constraint.name],
                constraint,
                &["table", "name"],
            );
        }
    }
    for routine in &native.routines {
        if let Some(object) = from_code(&routine.object)
            .as_ref()
            .and_then(|id| objects.get_mut(id))
        {
            native_routine_properties(object, routine);
        }
    }
    for trigger in &native.triggers {
        if let Some(object) = from_code(&trigger.object)
            .as_ref()
            .and_then(|id| objects.get_mut(id))
        {
            native_record(object, &["postgresql", "trigger"], trigger, &["object"]);
        }
    }
}

fn absent_object(snapshot: &SchemaSnapshot, id: &ComparisonObjectRef) -> ComparisonObservation {
    let Some(access) = &snapshot.access else {
        return observation(Status::NotRecorded, snapshot);
    };
    if !access.scope.includes_schema(&id.name.schema)
        || (id.kind == ComparisonObjectKind::View && !access.scope.include_views)
    {
        return observation(Status::Excluded, snapshot);
    }
    let current_parent = snapshot.tables.iter().any(|table| table.name == id.name)
        || snapshot.views.iter().any(|view| view.name == id.name);
    let parent_retained = snapshot.carried_over.iter().any(|item| {
        item.object == id.name && matches!(item.fact, SnapshotFact::Table | SnapshotFact::View)
    });
    let status = match id.kind {
        ComparisonObjectKind::Table | ComparisonObjectKind::View => {
            if access.lists_every_object_in(&id.name.schema) {
                Status::Absent
            } else {
                Status::NotVisible
            }
        }
        ComparisonObjectKind::ForeignKey => {
            if !parent_retained && (current_parent || access.lists_every_object_in(&id.name.schema))
            {
                Status::Absent
            } else {
                Status::NotVisible
            }
        }
        ComparisonObjectKind::Routine | ComparisonObjectKind::Trigger => {
            if id.kind == ComparisonObjectKind::Trigger
                && !access.scope.include_views
                && !current_parent
            {
                return observation(Status::Excluded, snapshot);
            }
            if !access.scope.include_programmability
                || snapshot
                    .programmability
                    .as_ref()
                    .is_none_or(|code| code.capture.objects != CaptureState::Read)
            {
                code_capture_status(snapshot, false)
            } else if id.kind == ComparisonObjectKind::Routine {
                if access.lists_every_programmable_object_in(&id.name.schema) {
                    Status::Absent
                } else {
                    Status::NotVisible
                }
            } else if !parent_retained
                && (current_parent || access.lists_every_object_in(&id.name.schema))
            {
                Status::Absent
            } else {
                Status::NotVisible
            }
        }
    };
    observation(status, snapshot)
}

fn trusted(status: Status) -> bool {
    matches!(status, Status::Observed | Status::Absent)
}

fn missing_property(object: &Object<'_>, path: &[String]) -> ComparisonValue {
    let mut ancestor = path.to_vec();
    while ancestor.pop().is_some() {
        if let Some(evidence) = object.properties.get(&ancestor)
            && !trusted(evidence.observation.status)
        {
            // Missing descendants of an unrecorded family are unknown, not absent facts.
            return ComparisonValue {
                observation: evidence.observation.clone(),
                value: None,
            };
        }
    }
    ComparisonValue {
        observation: ComparisonObservation {
            status: if object.observation.status == Status::Observed {
                Status::Absent
            } else {
                object.observation.status
            },
            read_at: object.observation.read_at,
        },
        value: None,
    }
}

fn compare_properties(before: &Object<'_>, after: &Object<'_>) -> Vec<ComparisonProperty> {
    let paths: BTreeSet<_> = before
        .properties
        .keys()
        .chain(after.properties.keys())
        .cloned()
        .collect();
    paths
        .into_iter()
        .filter_map(|path| {
            let reference = before
                .properties
                .get(&path)
                .cloned()
                .unwrap_or_else(|| missing_property(before, &path));
            let compared = after
                .properties
                .get(&path)
                .cloned()
                .unwrap_or_else(|| missing_property(after, &path));
            let result =
                if trusted(reference.observation.status) && trusted(compared.observation.status) {
                    if path == ["dependencies"] {
                        let topology = compare_dependency_edges(
                            before.dependency_edges.as_deref().unwrap_or_default(),
                            after.dependency_edges.as_deref().unwrap_or_default(),
                        );
                        if topology.added == 0 && topology.removed == 0 {
                            return None;
                        }
                        return Some(ComparisonProperty {
                            path,
                            result: Outcome::Different,
                            reference,
                            compared,
                        });
                    }
                    if reference.value == compared.value
                        && reference.observation.status == compared.observation.status
                    {
                        return None;
                    }
                    Outcome::Different
                } else {
                    Outcome::NotComparable
                };
            Some(ComparisonProperty {
                path,
                result,
                reference,
                compared,
            })
        })
        .collect()
}

fn compare_text(before: &Object<'_>, after: &Object<'_>) -> Option<DefinitionTextComparison> {
    if before.definition_observation.status != Status::Observed
        || after.definition_observation.status != Status::Observed
    {
        return None;
    }
    let (Some(reference), Some(compared)) = (
        before.definition.and_then(Definition::text),
        after.definition.and_then(Definition::text),
    ) else {
        return None;
    };
    Some(DefinitionTextComparison {
        differs: reference != compared,
        equal_under_legacy_normalization: comparable_text(reference) == comparable_text(compared),
    })
}

fn capture(snapshot: &SchemaSnapshot) -> ComparisonCapture {
    ComparisonCapture {
        provider: snapshot.provider,
        extracted_at: snapshot.extracted_at,
        scope: snapshot.access.as_ref().map(|access| access.scope.clone()),
        access_level: snapshot.access.as_ref().map(|access| access.level),
        has_unknown_extensions: !snapshot.unknown.is_empty()
            || snapshot
                .programmability
                .as_ref()
                .is_some_and(|code| !code.unknown.is_empty())
            || snapshot
                .dependencies
                .as_ref()
                .is_some_and(|dependencies| !dependencies.unknown.is_empty()),
    }
}

/// Compares two independent captures without mutating, merging or reconnecting either side.
///
/// Mixed providers are rejected before facts are compared. Absence is established
/// separately from each capture's own recorded scope and permissions. Old files without that
/// evidence can contribute positive facts, but cannot prove absence. The output intentionally
/// excludes module bodies, connections, usernames and permission-probe details.
pub fn compare_snapshots(
    reference: &SchemaSnapshot,
    compared: &SchemaSnapshot,
) -> Result<ProjectComparison, ComparisonError> {
    if reference.provider != compared.provider {
        return Err(ComparisonError::DifferentProviders);
    }
    let before = objects(reference);
    let after = objects(compared);
    let identities: BTreeSet<_> = before.keys().chain(after.keys()).cloned().collect();
    let mut summary = ComparisonSummary {
        objects_compared: identities.len(),
        ..ComparisonSummary::default()
    };
    let mut items = Vec::new();
    for id in identities {
        let (reference_observation, compared_observation, properties, definition_text, result) =
            match (before.get(&id), after.get(&id)) {
                (Some(left), Some(right)) => {
                    let properties = compare_properties(left, right);
                    let text = compare_text(left, right);
                    let differs = properties
                        .iter()
                        .any(|property| property.result == Outcome::Different)
                        || text.as_ref().is_some_and(|text| text.differs);
                    let uncertain = left.observation.status != Status::Observed
                        || right.observation.status != Status::Observed
                        || properties
                            .iter()
                            .any(|property| property.result == Outcome::NotComparable);
                    if !differs && !uncertain {
                        summary.equal += 1;
                        continue;
                    }
                    (
                        left.observation.clone(),
                        right.observation.clone(),
                        properties,
                        text,
                        if differs {
                            Outcome::Different
                        } else {
                            Outcome::NotComparable
                        },
                    )
                }
                (Some(left), None) => {
                    let missing = absent_object(compared, &id);
                    let outcome = if left.observation.status == Status::Observed
                        && missing.status == Status::Absent
                    {
                        Outcome::OnlyReference
                    } else {
                        Outcome::NotComparable
                    };
                    (left.observation.clone(), missing, Vec::new(), None, outcome)
                }
                (None, Some(right)) => {
                    let missing = absent_object(reference, &id);
                    let outcome = if right.observation.status == Status::Observed
                        && missing.status == Status::Absent
                    {
                        Outcome::OnlyCompared
                    } else {
                        Outcome::NotComparable
                    };
                    (
                        missing,
                        right.observation.clone(),
                        Vec::new(),
                        None,
                        outcome,
                    )
                }
                (None, None) => continue,
            };
        match result {
            Outcome::OnlyReference => summary.only_reference += 1,
            Outcome::OnlyCompared => summary.only_compared += 1,
            Outcome::Different => summary.different += 1,
            Outcome::NotComparable => summary.not_comparable += 1,
        }
        if result == Outcome::NotComparable
            || properties
                .iter()
                .any(|property| property.result == Outcome::NotComparable)
        {
            summary.with_limitations += 1;
        }
        items.push(ComparisonItem {
            object: id,
            result,
            reference: reference_observation,
            compared: compared_observation,
            properties,
            definition_text,
        });
    }
    Ok(ProjectComparison {
        reference: capture(reference),
        compared: capture(compared),
        items,
        summary,
    })
}
