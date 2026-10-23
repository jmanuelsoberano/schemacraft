//! Real PostgreSQL 15–18 catalog, permissions, comparison and round-trip contracts.
//! Requires SCHEMACRAFT_TEST_PG_HOST/PORT/USER/PASSWORD/MAJOR; tests fail closed when
//! SCHEMACRAFT_TEST_PG_REQUIRE_SERVER=1. The database must be schemacraft_fixture.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::too_many_lines,
    clippy::print_stderr,
    clippy::indexing_slicing
)]

use schemacraft_core::inspectors::postgresql::{
    PostgreSqlConnectionSettings, PostgreSqlEncryptionMode, PostgreSqlInspector,
};
use schemacraft_core::inspectors::sqlserver::PasswordSource;
use schemacraft_core::inspectors::{DatabaseInspector, InspectionOptions, SilentProgress};
use schemacraft_core::model::{
    CaptureState, CodeObjectRef, DatabaseProvider, Definition, DependencyKind, DependencyObjectRef,
    DependencyTarget, NotReadReason, QualifiedName, ReferentialAction, TriggerTiming,
};
use secrecy::ExposeSecret;
use tokio_postgres::NoTls;
use tokio_util::sync::CancellationToken;

fn settings() -> Option<PostgreSqlConnectionSettings> {
    let required =
        std::env::var("SCHEMACRAFT_TEST_PG_REQUIRE_SERVER").is_ok_and(|value| value != "0");
    let names = ["HOST", "PORT", "USER", "PASSWORD", "MAJOR"];
    let values: Vec<_> = names
        .iter()
        .map(|name| {
            std::env::var(format!("SCHEMACRAFT_TEST_PG_{name}"))
                .ok()
                .filter(|value| !value.is_empty())
        })
        .collect();
    if values.iter().any(Option::is_none) {
        assert!(
            !required,
            "required PostgreSQL fixture variables are missing"
        );
        eprintln!("skipping PostgreSQL integration: SCHEMACRAFT_TEST_PG_* variables are not set");
        return None;
    }
    Some(PostgreSqlConnectionSettings {
        host: values[0].clone().unwrap(),
        port: Some(
            values[1]
                .as_ref()
                .unwrap()
                .parse()
                .expect("fixture TCP port"),
        ),
        database: Some("schemacraft_fixture".into()),
        username: values[2].clone().unwrap(),
        password: PasswordSource::Provided {
            value: values[3].clone().unwrap().into(),
        },
        encryption: PostgreSqlEncryptionMode::Disable,
        root_certificate: None,
        connect_timeout_seconds: 15,
    })
}

async fn capture(
    settings: PostgreSqlConnectionSettings,
    options: &InspectionOptions,
) -> schemacraft_core::model::SchemaSnapshot {
    PostgreSqlInspector::new(settings)
        .unwrap()
        .inspect(options, &SilentProgress, CancellationToken::new())
        .await
        .expect("PostgreSQL capture")
}

#[tokio::test]
async fn native_catalog_code_permissions_and_all_capture_families() {
    let Some(settings) = settings() else {
        return;
    };
    let config = std::env::var("SCHEMACRAFT_TEST_PG_MAJOR")
        .unwrap()
        .parse::<u32>()
        .unwrap();
    assert!((15..=18).contains(&config));
    let inspector = PostgreSqlInspector::new(settings.clone()).unwrap();
    let information = inspector.test_connection().await.unwrap();
    assert_eq!(
        information
            .product_version
            .split('.')
            .next()
            .unwrap()
            .parse::<u32>()
            .unwrap(),
        config,
        "wrong server major"
    );
    let ca_path = std::env::var("SCHEMACRAFT_TEST_PG_CA").ok();
    let require_tls =
        std::env::var("SCHEMACRAFT_TEST_PG_REQUIRE_TLS").is_ok_and(|value| value != "0");
    assert!(
        !require_tls || ca_path.is_some(),
        "TLS matrix requires its ephemeral public CA path"
    );
    if let Some(ca_path) = ca_path {
        let strict = PostgreSqlConnectionSettings {
            host: "localhost".into(),
            encryption: PostgreSqlEncryptionMode::VerifyFull,
            root_certificate: Some(std::fs::read_to_string(ca_path).expect("public fixture CA")),
            ..settings.clone()
        };
        PostgreSqlInspector::new(strict.clone())
            .unwrap()
            .test_connection()
            .await
            .expect("trusted custom CA and matching hostname");
        let mismatch = PostgreSqlConnectionSettings {
            host: "127.0.0.1".into(),
            ..strict.clone()
        };
        assert!(
            matches!(
                PostgreSqlInspector::new(mismatch)
                    .unwrap()
                    .test_connection()
                    .await,
                Err(schemacraft_core::inspectors::InspectorError::UntrustedCertificate { .. })
            ),
            "a trusted CA must not bypass hostname validation"
        );
        let untrusted = PostgreSqlConnectionSettings {
            root_certificate: None,
            ..strict.clone()
        };
        assert!(
            matches!(
                PostgreSqlInspector::new(untrusted)
                    .unwrap()
                    .test_connection()
                    .await,
                Err(schemacraft_core::inspectors::InspectorError::UntrustedCertificate { .. })
            ),
            "an ephemeral CA must not become globally trusted"
        );
        let wrong_password = PostgreSqlConnectionSettings {
            password: PasswordSource::Provided {
                value: "wrong-synthetic-password".into(),
            },
            ..strict
        };
        assert!(matches!(
            PostgreSqlInspector::new(wrong_password)
                .unwrap()
                .test_connection()
                .await,
            Err(schemacraft_core::inspectors::InspectorError::AuthenticationFailed { .. })
        ));
    }
    let PasswordSource::Provided { value: password } = &settings.password else {
        panic!("typed synthetic password");
    };
    let mut admin_config = tokio_postgres::Config::new();
    admin_config
        .host(&settings.host)
        .port(settings.port.unwrap())
        .user(&settings.username)
        .password(password.expose_secret())
        .dbname("schemacraft_fixture");
    let (admin, connection) = admin_config.connect(NoTls).await.unwrap();
    let task = tokio::spawn(async move {
        connection.await.unwrap();
    });
    let database: String = admin
        .query_one("SELECT current_database()", &[])
        .await
        .unwrap()
        .get(0);
    assert_eq!(
        database, "schemacraft_fixture",
        "fixtures may mutate only their dedicated synthetic database"
    );
    admin
        .batch_execute(include_str!("fixtures/postgresql/fixture.sql"))
        .await
        .unwrap();
    let options = InspectionOptions::default();
    let snapshot = capture(settings.clone(), &options).await;
    assert_eq!(snapshot.provider, DatabaseProvider::PostgreSql);
    assert_eq!(snapshot.tables.len(), 9);
    assert_eq!(snapshot.views.len(), 3);
    let access = snapshot.access.as_ref().unwrap();
    assert!(access.probe.is_none());
    assert!(access.postgresql.as_ref().unwrap().object_catalog_read);
    let native = snapshot.postgresql.as_ref().unwrap();
    assert!(
        native
            .constraints
            .iter()
            .all(|constraint| constraint.is_enforced.is_some()),
        "enforcement declaration is known on every supported server version"
    );
    assert!(
        native
            .tables
            .iter()
            .any(|table| table.name.name == "events" && table.kind == "partitioned")
    );
    assert!(
        native
            .tables
            .iter()
            .any(|table| table.name.name == "events_2026" && table.kind == "partition")
    );
    assert!(
        native
            .views
            .iter()
            .any(|view| view.is_materialized && view.is_populated == Some(false))
    );
    assert!(native.indexes.iter().any(|index| index.method == "gin"));
    assert!(
        native
            .indexes
            .iter()
            .any(|index| index.key_columns.contains(&None) && index.predicate.is_some())
    );
    assert!(native.indexes.iter().any(|index| index.nulls_not_distinct));
    assert!(
        native
            .constraints
            .iter()
            .any(|constraint| constraint.match_type.as_deref() == Some("full"))
    );
    assert!(
        native
            .constraints
            .iter()
            .any(|constraint| constraint.name == "fk_subset"
                && constraint.delete_set_columns == ["code"])
    );
    assert!(
        native
            .constraints
            .iter()
            .any(|constraint| constraint.name == "ck_optional_amount" && !constraint.is_validated)
    );
    assert!(
        snapshot
            .foreign_keys
            .iter()
            .any(|key| key.name == "fk_order_customer"
                && key.on_delete == ReferentialAction::Restrict)
    );
    let amount = &snapshot
        .table(&QualifiedName::new("sales", "orders"))
        .unwrap()
        .column("large_amount")
        .unwrap()
        .data_type;
    assert_eq!(amount.precision, Some(1000));
    assert_eq!(amount.scale, Some(-3));
    assert_eq!(amount.declaration(), "numeric(1000,-3)");
    assert!(
        snapshot
            .table(&QualifiedName::new("odd.schema", "order.items"))
            .unwrap()
            .column("line.total")
            .is_some()
    );
    let code = snapshot.programmability.as_ref().unwrap();
    assert_eq!(code.capture.objects, CaptureState::Read);
    assert_eq!(code.capture.definitions, CaptureState::Read);
    let overloads: Vec<_> = code
        .routines
        .iter()
        .filter(|routine| routine.name == QualifiedName::new("sales", "order_total"))
        .collect();
    assert_eq!(overloads.len(), 2);
    assert_ne!(overloads[0].object_ref(), overloads[1].object_ref());
    assert!(matches!(
        overloads[0].object_ref(),
        CodeObjectRef::RoutineOverload { .. }
    ));
    assert!(
        code.routines
            .iter()
            .all(|routine| matches!(routine.body.definition(), Some(Definition::Readable { .. })))
    );
    assert!(
        code.triggers
            .iter()
            .any(|trigger| trigger.timing == TriggerTiming::Before)
    );
    assert!(
        code.triggers
            .iter()
            .any(|trigger| trigger.timing == TriggerTiming::InsteadOf)
    );
    assert!(
        native
            .triggers
            .iter()
            .any(|trigger| trigger.enabled_mode == "replica")
    );
    let deps = snapshot.dependencies.as_ref().unwrap();
    assert_eq!(deps.capture, CaptureState::Read);
    assert!(deps.edges.iter().any(|edge| {
        matches!(&edge.source, DependencyObjectRef::Table { name } if name == &QualifiedName::new("sales", "customers"))
            && matches!(&edge.target, DependencyTarget::Reference { status: schemacraft_core::model::DependencyReferenceStatus::Unsupported, name: Some(name), object_class: Some(class), .. } if name == "customer_ticket_seq" && class == "relation:S")
    }), "an unsupported sequence stays a named reference, never an excluded table node");
    assert!(
        deps.limitations
            .contains(&schemacraft_core::model::DependencyLimitation::UnsupportedTargets)
    );
    for routine_name in ["normalized_name", "has_nonempty_name"] {
        assert_eq!(deps.edges.iter().filter(|edge| {
            matches!(&edge.source, DependencyObjectRef::Table { name } if name == &QualifiedName::new("sales", "customers"))
                && matches!(&edge.target, DependencyTarget::Object { object: DependencyObjectRef::Routine { name, .. } } if name == &QualifiedName::new("sales", routine_name))
        }).count(), 1, "index expressions and predicates contribute one known table-to-routine edge");
    }
    assert!(
        deps.edges
            .iter()
            .any(|edge| edge.kind == DependencyKind::TriggerFunction)
    );
    assert!(deps.edges.iter().any(|edge|matches!(&edge.source,DependencyObjectRef::View {name} if name.name=="order_summary")&&matches!(&edge.target,DependencyTarget::Object {object:DependencyObjectRef::Table {name}} if name.name=="orders")));
    assert!(deps.edges.iter().any(|edge|matches!(&edge.source,DependencyObjectRef::Routine {name,..} if name.name=="order_total")&&matches!(&edge.target,DependencyTarget::Object {object:DependencyObjectRef::Table {name}} if name.name=="orders")));
    let json = serde_json::to_string(&snapshot).unwrap();
    let reopened: schemacraft_core::model::SchemaSnapshot = serde_json::from_str(&json).unwrap();
    assert_eq!(reopened, snapshot);
    let comparison = schemacraft_core::comparison::compare_snapshots(&snapshot, &reopened).unwrap();
    assert_eq!(comparison.summary.different, 0);
    assert_eq!(comparison.summary.only_reference, 0);
    assert_eq!(comparison.summary.only_compared, 0);
    let selected = capture(
        settings.clone(),
        &InspectionOptions {
            schemas: vec!["odd.schema".into()],
            ..options.clone()
        },
    )
    .await;
    assert_eq!(selected.tables.len(), 1);
    let outside = selected
        .foreign_keys
        .iter()
        .find(|key| key.name == "fk_cross_schema")
        .expect("retain a visible local key to an unselected schema");
    assert_eq!(
        outside.referenced_table,
        QualifiedName::new("sales", "customers")
    );
    assert!(
        selected.table(&outside.referenced_table).is_none(),
        "a named endpoint does not capture the unselected table"
    );

    // Native catalog metadata is available without schema USAGE; that does not grant data access.
    let reader = PostgreSqlConnectionSettings {
        username: "schemacraft_pg_reader".into(),
        password: PasswordSource::Provided {
            value: "SchemaCraftPgReader!2026".into(),
        },
        ..settings.clone()
    };
    let limited = capture(reader.clone(), &options).await;
    assert_eq!(limited.tables.len(), snapshot.tables.len());
    assert!(
        limited
            .access
            .as_ref()
            .unwrap()
            .postgresql
            .as_ref()
            .unwrap()
            .schemas
            .iter()
            .any(|schema| schema.name == "sales" && !schema.has_usage)
    );
    assert!(
        limited
            .access
            .as_ref()
            .unwrap()
            .lists_every_object_in("sales")
    );

    let no_text = InspectionOptions {
        include_module_definitions: false,
        ..options.clone()
    };
    let without_text = capture(reader.clone(), &no_text).await;
    assert!(
        without_text
            .programmability
            .as_ref()
            .unwrap()
            .module_definitions()
            .all(|definition| definition.text().is_none())
    );
    assert_eq!(
        without_text.dependencies.as_ref().unwrap().capture,
        CaptureState::Read
    );
    for (name, argument_type, tracking) in [
        (
            "order_total",
            "int4",
            schemacraft_core::model::RoutineDependencyTracking::ParsedSqlBody,
        ),
        (
            "order_total",
            "uuid",
            schemacraft_core::model::RoutineDependencyTracking::SignatureOnly,
        ),
        (
            "confirm_order",
            "uuid",
            schemacraft_core::model::RoutineDependencyTracking::SignatureOnly,
        ),
    ] {
        let routine = without_text
            .programmability
            .as_ref()
            .unwrap()
            .routines
            .iter()
            .find(|routine| {
                routine.name == QualifiedName::new("sales", name)
                    && routine
                        .identity_arguments
                        .as_ref()
                        .is_some_and(|arguments| {
                            arguments
                                .first()
                                .is_some_and(|argument| argument.name == argument_type)
                        })
            })
            .unwrap();
        assert!(routine.body.definition().unwrap().text().is_none());
        let native = without_text
            .postgresql
            .as_ref()
            .unwrap()
            .routines
            .iter()
            .find(|native| native.object == routine.object_ref())
            .unwrap();
        assert_eq!(native.routine_body_tracking, Some(tracking));
        let source = without_text.dependencies.as_ref().unwrap().sources.iter().find(|source| {
            matches!(&source.object, DependencyObjectRef::Routine { name, identity_arguments } if name == &routine.name && identity_arguments == &routine.identity_arguments)
        }).unwrap();
        assert_eq!(source.routine_body_tracking, Some(tracking));
    }

    // Denied optional definition and dependency queries stay isolated from structural reads.
    admin.batch_execute("REVOKE EXECUTE ON FUNCTION pg_catalog.pg_get_functiondef(oid) FROM PUBLIC; REVOKE SELECT ON pg_catalog.pg_depend FROM PUBLIC;").await.unwrap();
    let denied_result = PostgreSqlInspector::new(reader.clone())
        .unwrap()
        .inspect(&options, &SilentProgress, CancellationToken::new())
        .await;
    admin.batch_execute("GRANT EXECUTE ON FUNCTION pg_catalog.pg_get_functiondef(oid) TO PUBLIC; GRANT SELECT ON pg_catalog.pg_depend TO PUBLIC;").await.unwrap();
    let denied = denied_result.expect("optional failures leave structural capture usable");
    assert_eq!(denied.tables, snapshot.tables);
    assert_eq!(
        denied.programmability.as_ref().unwrap().capture.definitions,
        CaptureState::NotRead {
            reason: NotReadReason::PermissionDenied
        }
    );
    assert_eq!(
        denied.dependencies.as_ref().unwrap().capture,
        CaptureState::NotRead {
            reason: NotReadReason::PermissionDenied
        }
    );
    let retained = denied.with_unchecked_facts_from(&snapshot);
    assert_eq!(
        retained.programmability.as_ref().unwrap().routines.len(),
        snapshot.programmability.as_ref().unwrap().routines.len()
    );
    assert!(
        retained
            .dependencies
            .as_ref()
            .unwrap()
            .edges
            .iter()
            .all(|edge| edge.retained)
    );

    admin
        .batch_execute("REVOKE SELECT ON pg_catalog.pg_proc FROM PUBLIC;")
        .await
        .unwrap();
    let no_code_result = PostgreSqlInspector::new(reader)
        .unwrap()
        .inspect(&options, &SilentProgress, CancellationToken::new())
        .await;
    admin
        .batch_execute("GRANT SELECT ON pg_catalog.pg_proc TO PUBLIC;")
        .await
        .unwrap();
    let no_code = no_code_result
        .expect("optional program catalog denial must not break structure")
        .with_unchecked_facts_from(&snapshot);
    assert_eq!(
        no_code.programmability.as_ref().unwrap().routines.len(),
        code.routines.len()
    );
    assert_eq!(
        no_code.postgresql.as_ref().unwrap().routines.len(),
        native.routines.len()
    );
    assert!(
        no_code
            .programmability
            .as_ref()
            .unwrap()
            .carried_over
            .iter()
            .any(|entry| matches!(entry.object, CodeObjectRef::RoutineOverload { .. }))
    );
    drop(admin);
    task.abort();
}
