//! Code capture and refresh against SQL Server 2019 and 2022. The fixtures contain synthetic
//! T-SQL only; CLR kinds and unknown catalog values are covered by assembly unit tests.
//! `tests/common` describes the server variables and the fail-closed CI mode.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::print_stderr,
    clippy::indexing_slicing,
    clippy::too_many_lines
)]

mod common;

use std::hash::{BuildHasher, RandomState};
use std::sync::{LazyLock, Mutex};

use schemacraft_core::diff::{CaptureChange, CodeChange, CodeCounts, CodeProperty, SchemaDiff};
use schemacraft_core::inspectors::sqlserver::EncryptionMode;
use schemacraft_core::inspectors::{
    InspectionOptions, InspectionProgress, InspectionStage, ProgressReporter, SilentProgress,
};
use schemacraft_core::model::{
    AccessLevel, CaptureState, CarriedPart, CodeObjectRef, Completeness, Definition, DmlEvent,
    FiringOrder, NotReadReason, Programmability, QualifiedName, Routine, RoutineKind,
    SchemaSnapshot, TriggerTiming, UnknownFields,
};
use schemacraft_core::project::{
    CanvasState, Project, ProjectContent, SavedConnection, SavedSqlServerAuthentication,
    SavedSqlServerConnection, read_project,
};
use serde_json::json;
use tokio_util::sync::CancellationToken;

use common::{
    TestServer, as_login, check_expected_major_version, ensure_seeded, inspector, settings,
    test_server,
};

const DATABASE: &str = "SchemaCraftCode";
const CHANGED_DATABASE: &str = "SchemaCraftCodeChanged";
const READER: &str = "schemacraft_code_reader";
const SCRIPT: &str = include_str!("fixtures/sqlserver/code.sql");
const LOGINS: &str = include_str!("fixtures/sqlserver/code_logins.sql");
const CHANGES: &str = include_str!("fixtures/sqlserver/code_changes.sql");

static PASSWORD: LazyLock<String> = LazyLock::new(|| {
    let random = || RandomState::new().hash_one(std::process::id());
    format!("Sc!{:016x}{:016x}", random(), random())
});

async fn seed(server: &TestServer) {
    let script = format!("{SCRIPT}\nGO\n{LOGINS}").replace("$(PASSWORD)", &PASSWORD);
    ensure_seeded(server, DATABASE, &script).await;
}

async fn inspect(
    server: &TestServer,
    database: &str,
    options: &InspectionOptions,
) -> SchemaSnapshot {
    inspector(settings(server, Some(database)))
        .inspect(options, &SilentProgress, CancellationToken::new())
        .await
        .expect("code inspection succeeds")
}

async fn owner(server: &TestServer) -> SchemaSnapshot {
    seed(server).await;
    inspect(server, DATABASE, &InspectionOptions::default()).await
}

async fn reader(server: &TestServer, options: &InspectionOptions) -> SchemaSnapshot {
    seed(server).await;
    inspect(&as_login(server, READER, &PASSWORD), DATABASE, options).await
}

fn code(snapshot: &SchemaSnapshot) -> &Programmability {
    snapshot
        .programmability
        .as_ref()
        .expect("code capture exists")
}

fn routine<'a>(snapshot: &'a SchemaSnapshot, name: &str) -> &'a Routine {
    code(snapshot)
        .routines
        .iter()
        .find(|routine| routine.name == QualifiedName::new("app", name))
        .unwrap_or_else(|| panic!("routine {name} was captured"))
}

fn routine_ref(name: &str) -> CodeObjectRef {
    CodeObjectRef::Routine {
        name: QualifiedName::new("app", name),
    }
}

fn trigger_ref(name: &str) -> CodeObjectRef {
    CodeObjectRef::Trigger {
        parent: QualifiedName::new("app", "Orders"),
        name: name.to_string(),
    }
}

fn readable_count(code: &Programmability) -> usize {
    code.module_definitions()
        .filter_map(Definition::text)
        .count()
}

#[tokio::test]
async fn connects_to_the_expected_major_version() {
    let Some(server) = test_server() else { return };
    check_expected_major_version(&server).await;
}

#[tokio::test]
async fn reads_every_tsql_kind_and_keeps_encryption_apart_from_visibility() {
    let Some(server) = test_server() else { return };
    let snapshot = owner(&server).await;
    let code = code(&snapshot);

    assert_eq!(snapshot.tables.len(), 4);
    assert_eq!(snapshot.views.len(), 4);
    assert_eq!(code.capture.objects, CaptureState::Read);
    assert_eq!(code.capture.definitions, CaptureState::Read);
    assert_eq!(
        CodeCounts::of(code),
        CodeCounts {
            procedures: 10,
            functions: 3,
            triggers: 5,
            views: 4
        }
    );
    assert_eq!(code.module_definitions().count(), 22);
    assert_eq!(readable_count(code), 19);
    assert_eq!(code.carried_over, []);
    assert!(
        !code
            .triggers
            .iter()
            .any(|trigger| trigger.name == "TR_Database_NoOp")
    );
    assert_eq!(
        routine(&snapshot, "fn_Tax").kind,
        RoutineKind::ScalarFunction
    );
    assert_eq!(
        routine(&snapshot, "fn_OrdersOf").kind,
        RoutineKind::InlineTableFunction
    );
    assert_eq!(
        routine(&snapshot, "fn_LinesOf").kind,
        RoutineKind::TableFunction
    );
    assert_eq!(
        routine(&snapshot, "usp_Secret").body.definition(),
        Some(&Definition::Encrypted)
    );
    assert_eq!(
        code.views
            .iter()
            .find(|view| view.view.name == "SecretView")
            .unwrap()
            .definition,
        Definition::Encrypted
    );
    assert_eq!(
        code.triggers
            .iter()
            .find(|trigger| trigger.name == "TR_OrderAudit_Insert")
            .unwrap()
            .body
            .definition(),
        Some(&Definition::Encrypted)
    );
    let access = snapshot.access.as_ref().unwrap();
    assert_eq!(access.level, AccessLevel::Full);
    assert_eq!(
        access.coverage.programmability,
        Some(Completeness::Complete)
    );
    assert_eq!(
        access.coverage.module_definitions,
        Some(Completeness::Complete)
    );
    assert_eq!(access.counts.module_definitions, 22);
    assert_eq!(access.counts.module_definitions_encrypted, 3);
    assert_eq!(access.counts.module_definitions_not_visible, 0);

    // The persisted representation is deterministic apart from the capture timestamp.
    let again = owner(&server).await;
    assert_eq!(Some(code), again.programmability.as_ref());
}

#[tokio::test]
async fn reads_parameters_returns_table_columns_and_per_event_trigger_facts() {
    let Some(server) = test_server() else { return };
    let snapshot = owner(&server).await;
    let place = routine(&snapshot, "usp_PlaceOrder");
    let parameters: Vec<_> = place
        .parameters
        .iter()
        .map(|parameter| {
            (
                parameter.name.as_str(),
                parameter.ordinal_position,
                parameter.data_type.declaration(),
                parameter.is_output,
                parameter.is_read_only,
            )
        })
        .collect();
    assert_eq!(
        parameters,
        [
            ("@CustomerId", 1, "INT".to_string(), false, false),
            ("@Total", 2, "DECIMAL(18,2)".to_string(), false, false),
            ("@OrderId", 3, "INT".to_string(), true, false),
        ]
    );
    assert!(place.returns.is_none() && place.columns.is_empty());
    let lines = &routine(&snapshot, "usp_AddLines").parameters[1];
    assert!(lines.is_read_only);
    assert_eq!(
        lines.data_type.user_defined_type_name.as_deref(),
        Some("app.OrderLineType")
    );
    let scalar = routine(&snapshot, "fn_Tax");
    assert_eq!(scalar.parameters.len(), 1);
    assert_eq!(
        scalar.returns.as_ref().unwrap().declaration(),
        "DECIMAL(18,2)"
    );
    for (name, expected) in [
        ("fn_OrdersOf", vec!["OrderId", "Status", "Total"]),
        ("fn_LinesOf", vec!["LineNumber", "Quantity"]),
    ] {
        let function = routine(&snapshot, name);
        assert!(function.returns.is_none());
        assert_eq!(
            function
                .columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<Vec<_>>(),
            expected
        );
        assert!(
            function
                .columns
                .iter()
                .enumerate()
                .all(
                    |(index, column)| usize::try_from(column.ordinal_position).unwrap()
                        == index + 1
                )
        );
    }
    assert!(!routine(&snapshot, "fn_LinesOf").columns[0].is_nullable);
    let trigger = |name: &str| {
        code(&snapshot)
            .triggers
            .iter()
            .find(|trigger| trigger.name == name)
            .unwrap()
    };
    let first = trigger("TR_Orders_InsertUpdate");
    assert_eq!(first.timing, TriggerTiming::After);
    assert_eq!(
        first
            .events
            .iter()
            .map(|event| (event.event, event.order))
            .collect::<Vec<_>>(),
        [
            (DmlEvent::Insert, FiringOrder::First),
            (DmlEvent::Update, FiringOrder::Unspecified),
        ]
    );
    let last = trigger("TR_Orders_Delete");
    assert_eq!(last.events[0].order, FiringOrder::Last);
    assert!(last.is_not_for_replication && last.is_enabled);
    assert!(!trigger("TR_Orders_Update").is_enabled);
    assert_eq!(
        trigger("TR_OrderSummary_Insert").timing,
        TriggerTiming::InsteadOf
    );
    assert_eq!(
        trigger("TR_OrderSummary_Insert").parent,
        QualifiedName::new("app", "OrderSummary")
    );
    let view = |name: &str| {
        code(&snapshot)
            .views
            .iter()
            .find(|view| view.view.name == name)
            .unwrap()
    };
    assert!(view("OpenOrders").has_check_option);
    assert!(!view("OrderSummary").has_check_option);
    assert!(view("OrderTotals").is_indexed);
    assert!(!view("OpenOrders").is_indexed);
}

#[tokio::test]
async fn table_function_defaults_stay_in_the_body_and_do_not_change_structure_with_visibility() {
    let Some(server) = test_server() else { return };
    let saved = owner(&server).await;
    let saved_function = routine(&saved, "fn_LinesOf");
    assert!(
        saved_function
            .body
            .definition()
            .and_then(Definition::text)
            .unwrap()
            .contains("Quantity int DEFAULT (4) NOT NULL")
    );
    assert!(
        saved_function
            .columns
            .iter()
            .all(|column| column.default_expression.is_none())
    );

    for include_module_definitions in [true, false] {
        let fresh = reader(
            &server,
            &InspectionOptions {
                include_module_definitions,
                ..InspectionOptions::default()
            },
        )
        .await;
        assert_eq!(
            routine(&fresh, "fn_LinesOf").columns,
            saved_function.columns
        );
        let diff = SchemaDiff::between(&saved, &fresh);
        assert_eq!(diff.code.changes, [], "{diff:?}");
        let merged = fresh.with_unchecked_facts_from(&saved);
        let merged_function = routine(&merged, "fn_LinesOf");
        assert_eq!(merged_function.columns, saved_function.columns);
        if include_module_definitions {
            assert_eq!(merged_function.body, saved_function.body);
        } else {
            assert_eq!(
                merged_function.body.definition(),
                Some(&Definition::NotRecorded)
            );
            assert!(
                !serde_json::to_string(merged_function)
                    .unwrap()
                    .contains("DEFAULT")
            );
        }
    }
}

#[tokio::test]
async fn preserves_stored_text_including_comments_crlf_spaces_and_the_original_name() {
    let Some(server) = test_server() else { return };
    let snapshot = owner(&server).await;
    let text = |name| {
        routine(&snapshot, name)
            .body
            .definition()
            .unwrap()
            .text()
            .unwrap()
    };
    assert_eq!(
        text("usp_Scripted"),
        "CREATE PROCEDURE app.usp_Scripted  \r\nAS \r\nSELECT OrderId FROM app.Orders;\r\n"
    );
    assert!(text("usp_Commented").starts_with(
        "-- Its batch starts with this comment, which its text keeps.\nCREATE PROCEDURE"
    ));
    assert!(text("usp_Renamed").contains("CREATE PROCEDURE app.usp_FormerName"));
    assert!(text("usp_Connect").contains("Pwd=example;"));
    assert!(text("usp_Search").contains("EXEC sys.sp_executesql"));
}

#[tokio::test]
async fn schema_and_view_filters_apply_to_code_and_the_schema_picker() {
    let Some(server) = test_server() else { return };
    seed(&server).await;
    let description = inspector(settings(&server, Some(DATABASE)))
        .describe_database()
        .await
        .unwrap();
    assert_eq!(description.schemas, ["app"]);
    assert_eq!(description.programmability_only_schemas, ["code_only"]);
    let filtered = inspect(
        &server,
        DATABASE,
        &InspectionOptions {
            schemas: vec!["code_only".to_string()],
            ..InspectionOptions::default()
        },
    )
    .await;
    assert!(filtered.tables.is_empty() && filtered.views.is_empty());
    assert_eq!(code(&filtered).routines.len(), 1);
    assert_eq!(
        code(&filtered).routines[0].name,
        QualifiedName::new("code_only", "usp_Ping")
    );
    assert!(code(&filtered).views.is_empty() && code(&filtered).triggers.is_empty());
    let without_views = inspect(
        &server,
        DATABASE,
        &InspectionOptions {
            include_views: false,
            schemas: vec!["app".to_string()],
            ..InspectionOptions::default()
        },
    )
    .await;
    assert!(without_views.views.is_empty() && code(&without_views).views.is_empty());
    assert_eq!(code(&without_views).triggers.len(), 4);
    assert_eq!(code(&without_views).routines.len(), 12);
    assert!(
        code(&without_views)
            .triggers
            .iter()
            .all(|trigger| trigger.parent.name != "OrderSummary")
    );
    assert_eq!(code(&without_views).module_definitions().count(), 16);
    let unmatched = inspect(
        &server,
        DATABASE,
        &InspectionOptions {
            schemas: vec!["app' OR 1=1 --".to_string()],
            ..InspectionOptions::default()
        },
    )
    .await;
    assert!(unmatched.tables.is_empty() && unmatched.views.is_empty());
    assert!(code(&unmatched).routines.is_empty() && code(&unmatched).triggers.is_empty());
    assert_eq!(code(&unmatched).module_definitions().count(), 0);
}

#[derive(Default)]
struct RecordingProgress(Mutex<Vec<InspectionProgress>>);
impl ProgressReporter for RecordingProgress {
    fn report(&self, progress: InspectionProgress) {
        self.0.lock().unwrap().push(progress);
    }
}

#[tokio::test]
async fn reports_the_code_stages_with_counts_and_skips_texts_when_the_option_is_off() {
    let Some(server) = test_server() else { return };
    seed(&server).await;
    for texts in [true, false] {
        let progress = RecordingProgress::default();
        let snapshot = inspector(settings(&server, Some(DATABASE)))
            .inspect(
                &InspectionOptions {
                    include_module_definitions: texts,
                    ..InspectionOptions::default()
                },
                &progress,
                CancellationToken::new(),
            )
            .await
            .unwrap();
        let updates = progress.0.lock().unwrap();
        let objects = updates
            .iter()
            .position(|update| update.stage == InspectionStage::ReadingProgrammability)
            .unwrap();
        assert!(updates[objects].count.is_some());
        let definitions = updates
            .iter()
            .position(|update| update.stage == InspectionStage::ReadingModuleDefinitions);
        if texts {
            let definitions = definitions.expect("text stage");
            assert!(objects < definitions);
            assert!(updates[definitions].count.is_some());
        } else {
            assert!(definitions.is_none());
            assert_eq!(
                code(&snapshot).capture.definitions,
                CaptureState::NotRead {
                    reason: NotReadReason::OptionOff
                }
            );
            assert!(
                code(&snapshot)
                    .module_definitions()
                    .all(|definition| *definition == Definition::NotRecorded)
            );
        }
    }
}

#[tokio::test]
async fn a_reader_lists_table_functions_and_triggers_but_not_procedures_or_scalar_functions() {
    let Some(server) = test_server() else { return };
    let snapshot = reader(&server, &InspectionOptions::default()).await;
    assert_eq!(
        code(&snapshot)
            .routines
            .iter()
            .map(|routine| routine.name.name.as_str())
            .collect::<Vec<_>>(),
        ["fn_LinesOf", "fn_OrdersOf"]
    );
    assert_eq!(code(&snapshot).views.len(), 4);
    assert_eq!(code(&snapshot).triggers.len(), 5);
    assert_eq!(readable_count(code(&snapshot)), 0);
    let access = snapshot.access.as_ref().unwrap();
    // No table CHECK or DEFAULT is present; a function's internal default stays in its body,
    // so incomplete code alone does not change Full.
    assert_eq!(access.level, AccessLevel::Full);
    assert_eq!(access.coverage.programmability, Some(Completeness::Partial));
    assert_eq!(
        access.coverage.module_definitions,
        Some(Completeness::NotAvailable)
    );
    assert_eq!(access.counts.module_definitions, 11);
    assert_eq!(access.counts.module_definitions_not_visible, 9);
    assert_eq!(access.counts.module_definitions_encrypted, 2);
}

#[tokio::test]
async fn weaker_refreshes_keep_code_and_stronger_refreshes_make_it_available() {
    let Some(server) = test_server() else { return };
    let owner = owner(&server).await;
    let reader = reader(&server, &InspectionOptions::default()).await;
    let diff = SchemaDiff::between(&owner, &reader);
    assert!(diff.is_empty(), "{diff:?}");
    assert!(!diff.is_up_to_date());
    assert_ne!(diff.code.not_checked, []);
    assert!(
        diff.code
            .not_checked
            .iter()
            .all(|carried| carried.read_at == owner.extracted_at)
    );
    let merged = reader.clone().with_unchecked_facts_from(&owner);
    assert_eq!(code(&merged).routines, code(&owner).routines);
    assert_eq!(code(&merged).triggers, code(&owner).triggers);
    assert_eq!(code(&merged).views, code(&owner).views);
    assert_eq!(merged.clone().with_unchecked_facts_from(&owner), merged);
    let available = SchemaDiff::between(&reader, &owner);
    assert!(available.is_empty(), "{available:?}");
    assert!(available.code.now_available.iter().any(|item| item.object
        == routine_ref("usp_PlaceOrder")
        && item.part == CarriedPart::Whole));
    assert_eq!(available.code.changes, []);
    assert_eq!(available.code.not_checked, []);
    // Restoring full rights clears the kept facts instead of reporting the same texts again.
    let restored = SchemaDiff::between(&merged, &owner);
    assert!(restored.code.now_available.is_empty() && restored.code.not_checked.is_empty());
}

#[tokio::test]
async fn turning_texts_off_preserves_hidden_objects_and_turning_objects_off_reports_removal() {
    let Some(server) = test_server() else { return };
    let owner = owner(&server).await;
    let without_texts = reader(
        &server,
        &InspectionOptions {
            include_module_definitions: false,
            ..InspectionOptions::default()
        },
    )
    .await;
    let kept = without_texts.clone().with_unchecked_facts_from(&owner);
    assert_eq!(code(&kept).routines.len(), code(&owner).routines.len());
    assert_eq!(readable_count(code(&kept)), 0);
    let diff = SchemaDiff::between(&owner, &without_texts);
    assert_eq!(diff.code.changes, []);
    assert_eq!(
        diff.capture_changes,
        [CaptureChange::ModuleDefinitionsNoLongerRecorded { count: 19 }]
    );
    let without_objects = inspect(
        &server,
        DATABASE,
        &InspectionOptions {
            include_programmability: false,
            ..InspectionOptions::default()
        },
    )
    .await;
    let dropped = without_objects.clone().with_unchecked_facts_from(&owner);
    assert!(
        code(&dropped).routines.is_empty()
            && code(&dropped).triggers.is_empty()
            && code(&dropped).views.is_empty()
    );
    let diff = SchemaDiff::between(&owner, &without_objects);
    assert_eq!(
        diff.capture_changes,
        [
            CaptureChange::ProgrammabilityNoLongerRecorded {
                counts: CodeCounts::of(code(&owner))
            },
            CaptureChange::ModuleDefinitionsNoLongerRecorded { count: 19 },
        ]
    );
    assert_eq!(diff.code.changes, []);
    assert!(!diff.is_up_to_date());
}

fn project_with(snapshot: SchemaSnapshot) -> ProjectContent {
    ProjectContent {
        connection: SavedConnection::SqlServer(SavedSqlServerConnection {
            host: "localhost".to_string(),
            instance: None,
            port: Some(1433),
            database: Some(DATABASE.to_string()),
            authentication: SavedSqlServerAuthentication::SqlLogin {
                username: "sa".to_string(),
            },
            encryption: EncryptionMode::Mandatory,
            trust_server_certificate: true,
        }),
        inspection: InspectionOptions::default(),
        snapshot,
        canvas: CanvasState::default(),
        unknown: UnknownFields::new(),
    }
}

#[tokio::test]
async fn a_format_two_project_first_records_code_without_object_additions_or_access_change() {
    let Some(server) = test_server() else { return };
    let fresh = owner(&server).await;
    let project = Project::new(
        project_with(fresh.clone()),
        fresh.extracted_at,
        "SchemaCraft 1.1.0",
    );
    let mut value = serde_json::to_value(project).unwrap();
    value["formatVersion"] = json!(2);
    value["snapshot"]
        .as_object_mut()
        .unwrap()
        .remove("programmability");
    // A real format-2 capture held no index/constraint state or code facts. The fixture has
    // four primary keys and two foreign keys, so the review records those six states as well.
    for table in value["snapshot"]["tables"].as_array_mut().unwrap() {
        if let Some(key) = table["primaryKey"].as_object_mut() {
            key.remove("isEnabled");
        }
    }
    for key in value["snapshot"]["foreignKeys"].as_array_mut().unwrap() {
        key.as_object_mut().unwrap().remove("isTrusted");
    }
    for key in ["programmability", "moduleDefinitions"] {
        value["snapshot"]["access"]["coverage"]
            .as_object_mut()
            .unwrap()
            .remove(key);
    }
    for key in [
        "moduleDefinitions",
        "moduleDefinitionsNotVisible",
        "moduleDefinitionsEncrypted",
    ] {
        value["snapshot"]["access"]["counts"]
            .as_object_mut()
            .unwrap()
            .remove(key);
    }
    value["snapshot"]["access"]["probe"]
        .as_object_mut()
        .unwrap()
        .remove("executeDenials");
    for schema in value["snapshot"]["access"]["probe"]["schemas"]
        .as_array_mut()
        .unwrap()
    {
        schema
            .as_object_mut()
            .unwrap()
            .remove("hasVisibleProgrammability");
        schema.as_object_mut().unwrap().remove("isExecuteDenied");
    }
    for key in ["includeProgrammability", "includeModuleDefinitions"] {
        value["inspection"].as_object_mut().unwrap().remove(key);
        value["snapshot"]["access"]["scope"]
            .as_object_mut()
            .unwrap()
            .remove(key);
    }
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("version-1.1.scraft");
    std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    let old = read_project(&path).unwrap().project.content;
    assert!(old.inspection.include_programmability && old.inspection.include_module_definitions);
    let diff = SchemaDiff::between(&old.snapshot, &fresh);
    assert!(diff.is_empty() && !diff.has_object_changes());
    assert!(!diff.is_up_to_date() && !diff.access_changed);
    assert!(diff.code.changes.is_empty() && diff.code.now_available.is_empty());
    assert_eq!(
        diff.capture_changes,
        [
            CaptureChange::IndexAndConstraintStateRecorded { count: 6 },
            CaptureChange::ProgrammabilityRecorded {
                counts: CodeCounts::of(code(&fresh))
            },
            CaptureChange::ModuleDefinitionsRecorded { count: 19 },
        ]
    );
    let refreshed = old.with_refreshed_snapshot(fresh.clone());
    assert_eq!(refreshed.snapshot, fresh);
    let written = Project::new(refreshed, fresh.extracted_at, "SchemaCraft 1.2.0");
    std::fs::write(&path, serde_json::to_vec(&written).unwrap()).unwrap();
    let reopened = read_project(&path).unwrap().project.content.snapshot;
    assert_eq!(reopened, fresh);
    assert!(SchemaDiff::between(&reopened, &fresh).is_up_to_date());
}

#[tokio::test]
async fn reports_exact_code_changes_and_ignores_only_line_end_and_trailing_space_edits() {
    let Some(server) = test_server() else { return };
    let before = owner(&server).await;
    let script = format!(
        "{}\nGO\nUSE {CHANGED_DATABASE};\nGO\n{CHANGES}",
        SCRIPT.replace(DATABASE, CHANGED_DATABASE)
    );
    ensure_seeded(&server, CHANGED_DATABASE, &script).await;
    let after = inspect(&server, CHANGED_DATABASE, &InspectionOptions::default()).await;
    let diff = SchemaDiff::between(&before, &after);
    assert!(diff.tables.is_empty() && diff.views.is_empty() && diff.foreign_keys.is_empty());
    assert!(
        diff.capture_changes.is_empty()
            && diff.code.not_checked.is_empty()
            && diff.code.now_available.is_empty()
    );
    assert!(!diff.access_changed && diff.has_object_changes() && !diff.is_up_to_date());
    let changed = |object, routine_kind, properties| CodeChange::Changed {
        object,
        routine_kind,
        properties,
    };
    assert_eq!(
        diff.code.changes,
        [
            changed(
                CodeObjectRef::View {
                    name: QualifiedName::new("app", "OpenOrders")
                },
                None,
                vec![CodeProperty::Definition, CodeProperty::CheckOption]
            ),
            CodeChange::Removed {
                object: routine_ref("fn_LinesOf"),
                routine_kind: Some(RoutineKind::TableFunction)
            },
            CodeChange::Added {
                object: routine_ref("usp_Added"),
                routine_kind: Some(RoutineKind::Procedure)
            },
            changed(
                routine_ref("usp_PlaceOrder"),
                Some(RoutineKind::Procedure),
                vec![CodeProperty::Definition]
            ),
            changed(
                trigger_ref("TR_Orders_Delete"),
                None,
                vec![CodeProperty::Enabled]
            ),
            changed(
                trigger_ref("TR_Orders_InsertUpdate"),
                None,
                vec![CodeProperty::Definition, CodeProperty::FiringOrder]
            ),
            changed(
                trigger_ref("TR_Orders_Update"),
                None,
                vec![CodeProperty::Enabled]
            ),
        ]
    );
    assert_ne!(
        routine(&before, "usp_Scripted").body,
        routine(&after, "usp_Scripted").body
    );
}
