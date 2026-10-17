//! Integration tests against a real SQL Server instance, connected as a login that sees
//! everything. `tests/common` says when they run.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::print_stderr,
    clippy::too_many_lines
)]

mod common;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use schemacraft_core::diff::{
    ChangeCounts, ColumnChange, ColumnProperty, ForeignKeyChange, ForeignKeyProperty, IndexChange,
    SchemaDiff, TableChange,
};
use schemacraft_core::inspectors::sqlserver::SqlServerConnectionSettings;
use schemacraft_core::inspectors::{
    InspectionOptions, InspectionProgress, InspectionStage, InspectorError, InspectorErrorKind,
    ProgressReporter, SilentProgress,
};
use schemacraft_core::model::{
    AccessLevel, Completeness, Definition, IndexKind, QualifiedName, ReferentialAction,
    SchemaSnapshot, UnknownFields,
};
use schemacraft_core::project::{CanvasState, NodeState, Point};
use serde::Deserialize;
use tokio_util::sync::CancellationToken;

use self::common::{
    TestClient, TestServer, connect, ensure_seeded, inspector, settings, test_server,
};

const FIXTURE_DATABASE: &str = "SchemaCraftFixture";
const STRESS_DATABASE: &str = "SchemaCraftStress";
const FIXTURE_SCRIPT: &str = include_str!("fixtures/sqlserver/fixture.sql");
const STRESS_SCRIPT: &str = include_str!("fixtures/sqlserver/stress_200_tables.sql");
const CHANGED_DATABASE: &str = "SchemaCraftFixtureChanged";
const CHANGES_SCRIPT: &str = include_str!("fixtures/sqlserver/changes.sql");
/// A database of its own, so the fixture, the changes and the permission logins stay untouched.
const CHECK_FORMS_DATABASE: &str = "SchemaCraftCheckForms";
const CHECK_FORMS: &str = include_str!("fixtures/sqlserver/check_forms.json");
const RULE_FACTS_SCRIPT: &str = include_str!("fixtures/sqlserver/rule_facts.sql");

/// Error 547: a statement conflicted with a `CHECK`, `FOREIGN KEY` or `REFERENCE` constraint.
const CONSTRAINT_CONFLICT: u32 = 547;
/// Error 8102: an identity column cannot be updated.
const IDENTITY_UPDATE: u32 = 8102;
/// Error 2601: a duplicate key in a unique index.
const DUPLICATE_KEY: u32 = 2601;

/// Budget for inspecting 200 tables; the product target is 3 seconds on a local network.
const STRESS_BUDGET: Duration = Duration::from_secs(5);

#[derive(Default)]
struct RecordingProgress {
    updates: Mutex<Vec<InspectionProgress>>,
}

impl ProgressReporter for RecordingProgress {
    fn report(&self, progress: InspectionProgress) {
        self.updates.lock().expect("progress log").push(progress);
    }
}

async fn inspect_fixture(server: &TestServer, options: InspectionOptions) -> SchemaSnapshot {
    ensure_seeded(server, FIXTURE_DATABASE, FIXTURE_SCRIPT).await;
    inspector(settings(server, Some(FIXTURE_DATABASE)))
        .inspect(&options, &SilentProgress, CancellationToken::new())
        .await
        .expect("inspection succeeds")
}

fn kind_of(result: Result<impl std::fmt::Debug, InspectorError>) -> InspectorErrorKind {
    match result {
        Ok(value) => panic!("expected a failure, got {value:?}"),
        Err(error) => error.kind(),
    }
}

#[tokio::test]
async fn test_connection_reports_server_identity() {
    let Some(server) = test_server() else { return };

    let information = inspector(settings(&server, None))
        .test_connection()
        .await
        .expect("connection succeeds");

    assert!(
        information.product.starts_with("Microsoft SQL Server"),
        "{}",
        information.product
    );
    assert_ne!(information.product_version, "");
    assert_ne!(information.edition, "");
    assert_eq!(information.database_name, "master");
}

#[tokio::test]
async fn wrong_password_is_an_authentication_failure() {
    let Some(server) = test_server() else { return };
    let wrong = TestServer {
        password: "definitely-not-the-password".to_string(),
        ..server
    };

    let kind = kind_of(inspector(settings(&wrong, None)).test_connection().await);
    assert_eq!(kind, InspectorErrorKind::AuthenticationFailed);
}

#[tokio::test]
async fn unknown_database_is_reported_as_unavailable() {
    let Some(server) = test_server() else { return };

    let kind = kind_of(
        inspector(settings(&server, Some("SchemaCraftDoesNotExist")))
            .test_connection()
            .await,
    );
    assert_eq!(kind, InspectorErrorKind::DatabaseUnavailable);
}

#[tokio::test]
async fn self_signed_certificate_is_rejected_unless_trusted() {
    let Some(server) = test_server() else { return };
    let strict = SqlServerConnectionSettings {
        trust_server_certificate: false,
        ..settings(&server, None)
    };

    let kind = kind_of(inspector(strict).test_connection().await);
    assert_eq!(kind, InspectorErrorKind::UntrustedCertificate);
}

#[tokio::test]
async fn closed_port_is_unreachable() {
    let Some(server) = test_server() else { return };
    let closed = SqlServerConnectionSettings {
        port: Some(1),
        connect_timeout_seconds: 3,
        ..settings(&server, None)
    };

    let kind = kind_of(inspector(closed).test_connection().await);
    assert!(
        matches!(
            kind,
            InspectorErrorKind::Unreachable | InspectorErrorKind::Timeout
        ),
        "{kind:?}"
    );
}

#[tokio::test]
async fn lists_databases_and_schemas() {
    let Some(server) = test_server() else { return };
    ensure_seeded(&server, FIXTURE_DATABASE, FIXTURE_SCRIPT).await;

    let databases = inspector(settings(&server, None))
        .list_databases()
        .await
        .expect("databases");
    assert!(
        databases.iter().any(|name| name == FIXTURE_DATABASE),
        "{databases:?}"
    );
    assert!(!databases.iter().any(|name| name == "master"));

    let description = inspector(settings(&server, Some(FIXTURE_DATABASE)))
        .describe_database()
        .await
        .expect("database description");
    // `staging` is empty and `db_datareader` is owned by dbo in the fixture; neither is offered.
    assert_eq!(description.schemas, ["dbo", "hr", "sales"]);
    let access = &description.access;
    assert_eq!(access.level, AccessLevel::Full);
    assert_eq!(access.coverage.objects, Completeness::Complete);
    assert_eq!(access.coverage.definitions, Completeness::Complete);
    assert_eq!(access.probe.explicit_denials, Some(0));
    assert_eq!(access.probe.database_user.as_deref(), Some("dbo"));
    // The empty schema is still judged: an object there would have been visible.
    assert!(
        access
            .probe
            .schemas
            .iter()
            .any(|schema| schema.name == "staging" && !schema.has_visible_objects)
    );
}

#[tokio::test]
async fn inspects_tables_columns_and_types() {
    let Some(server) = test_server() else { return };
    let snapshot = inspect_fixture(&server, InspectionOptions::default()).await;

    assert_eq!(snapshot.database_name, FIXTURE_DATABASE);
    assert!(
        snapshot
            .server_version
            .as_deref()
            .unwrap_or_default()
            .starts_with("Microsoft SQL Server")
    );
    let access = snapshot.access.as_ref().expect("an access profile");
    assert_eq!(access.level, AccessLevel::Full);
    assert_eq!(access.counts.definitions_not_visible, 0);
    assert_eq!(snapshot.foreign_keys_to_invisible_tables, []);
    let table_names: Vec<String> = snapshot
        .tables
        .iter()
        .map(|table| table.name.to_string())
        .collect();
    assert_eq!(
        table_names,
        [
            "dbo.CustomerTags",
            "dbo.Customers",
            "dbo.Tags",
            "hr.Employees",
            "sales.OrderLines",
            "sales.Orders",
            "sales.Shipments",
        ]
    );

    let customers = snapshot
        .table(&QualifiedName::new("dbo", "Customers"))
        .expect("customers");
    let declarations: Vec<String> = customers
        .columns
        .iter()
        .map(|column| format!("{} {}", column.name, column.data_type.declaration()))
        .collect();
    assert_eq!(
        declarations,
        [
            "CustomerId INT",
            "Name NVARCHAR(120)",
            "Email VARCHAR(254)",
            "Notes NVARCHAR(MAX)",
            "CreatedAt DATETIME2(3)",
            "IsActive BIT",
        ]
    );
    assert!(customers.columns[0].is_identity);
    assert!(customers.columns[3].is_nullable);
    assert_eq!(
        customers.columns[4]
            .default_expression
            .as_ref()
            .and_then(Definition::text),
        Some("(sysutcdatetime())")
    );
    assert_eq!(
        customers.columns[5]
            .default_expression
            .as_ref()
            .and_then(Definition::text),
        Some("((1))")
    );

    let employees = snapshot
        .table(&QualifiedName::new("hr", "Employees"))
        .expect("employees");
    let salary = employees.column("Salary").expect("salary");
    assert_eq!(salary.data_type.declaration(), "DECIMAL(19,4)");
    assert_eq!(
        salary.data_type.user_defined_type_name.as_deref(),
        Some("dbo.Money2")
    );

    let orders = snapshot
        .table(&QualifiedName::new("sales", "Orders"))
        .expect("orders");
    assert!(orders.column("Total").expect("total").is_computed);
    assert_eq!(
        orders
            .column("PlacedAt")
            .expect("placed at")
            .data_type
            .declaration(),
        "DATETIME2(7)"
    );
    assert_eq!(
        orders
            .column("Status")
            .expect("status")
            .data_type
            .declaration(),
        "CHAR(1)"
    );

    let lines = snapshot
        .table(&QualifiedName::new("sales", "OrderLines"))
        .expect("order lines");
    assert_eq!(
        lines
            .column("UnitPrice")
            .expect("unit price")
            .data_type
            .declaration(),
        "MONEY"
    );
    assert_eq!(
        lines
            .column("Discount")
            .expect("discount")
            .data_type
            .declaration(),
        "REAL"
    );
    assert_eq!(
        lines
            .column("Payload")
            .expect("payload")
            .data_type
            .declaration(),
        "VARBINARY(MAX)"
    );
    assert_eq!(
        lines
            .column("RowVersion")
            .expect("row version")
            .data_type
            .declaration(),
        "TIMESTAMP"
    );

    let shipments = snapshot
        .table(&QualifiedName::new("sales", "Shipments"))
        .expect("shipments");
    assert_eq!(
        shipments
            .column("ShipmentId")
            .expect("id")
            .data_type
            .declaration(),
        "UNIQUEIDENTIFIER"
    );
    assert_eq!(
        shipments
            .column("ShipmentId")
            .expect("id")
            .default_expression
            .as_ref()
            .and_then(Definition::text),
        Some("(newid())")
    );
    assert_eq!(
        shipments
            .column("ShippedAt")
            .expect("shipped at")
            .data_type
            .declaration(),
        "DATETIMEOFFSET(0)"
    );
}

#[tokio::test]
async fn inspects_keys_indexes_and_constraints() {
    let Some(server) = test_server() else { return };
    let snapshot = inspect_fixture(&server, InspectionOptions::default()).await;

    let customers = snapshot
        .table(&QualifiedName::new("dbo", "Customers"))
        .expect("customers");
    let primary_key = customers.primary_key.as_ref().expect("primary key");
    assert_eq!(primary_key.name, "PK_Customers");
    assert_eq!(primary_key.columns, ["CustomerId"]);
    assert!(primary_key.is_clustered);
    assert_eq!(customers.indexes.len(), 1);
    assert_eq!(customers.indexes[0].name, "UQ_Customers_Email");
    assert_eq!(customers.indexes[0].kind, IndexKind::UniqueConstraint);
    assert_eq!(customers.check_constraints.len(), 1);
    assert_eq!(customers.check_constraints[0].name, "CK_Customers_Email");

    let orders = snapshot
        .table(&QualifiedName::new("sales", "Orders"))
        .expect("orders");
    let mut index_summaries: Vec<String> = orders
        .indexes
        .iter()
        .map(|index| {
            format!(
                "{} {:?} {}",
                index.name,
                index.kind,
                index.columns.join(",")
            )
        })
        .collect();
    index_summaries.sort();
    assert_eq!(
        index_summaries,
        [
            "IX_Orders_CustomerId NonUnique CustomerId",
            "IX_Orders_Open NonUnique Status",
            "UX_Orders_Customer_PlacedAt UniqueIndex CustomerId,PlacedAt",
        ]
    );

    let lines = snapshot
        .table(&QualifiedName::new("sales", "OrderLines"))
        .expect("order lines");
    assert_eq!(
        lines.primary_key.as_ref().expect("composite key").columns,
        ["OrderId", "LineNumber"]
    );
    assert_eq!(
        lines.check_constraints[0].expression,
        Definition::readable("([Quantity]>(0))")
    );
    assert_eq!(lines.check_constraints[0].is_enabled, Some(true));
}

#[tokio::test]
async fn inspects_foreign_keys_with_actions_and_state() {
    let Some(server) = test_server() else { return };
    let snapshot = inspect_fixture(&server, InspectionOptions::default()).await;

    let summaries: Vec<String> = snapshot
        .foreign_keys
        .iter()
        .map(|key| {
            format!(
                "{} {}->{} {:?}/{:?} {}",
                key.name,
                key.referencing_table,
                key.referenced_table,
                key.on_delete,
                key.on_update,
                if key.is_enabled {
                    "enabled"
                } else {
                    "disabled"
                }
            )
        })
        .collect();
    assert_eq!(
        summaries,
        [
            "FK_CustomerTags_Customers dbo.CustomerTags->dbo.Customers Cascade/NoAction enabled",
            "FK_CustomerTags_Tags dbo.CustomerTags->dbo.Tags NoAction/NoAction enabled",
            "FK_Employees_Manager hr.Employees->hr.Employees NoAction/NoAction enabled",
            "FK_OrderLines_Orders sales.OrderLines->sales.Orders Cascade/NoAction enabled",
            "FK_Orders_Customers sales.Orders->dbo.Customers NoAction/Cascade enabled",
            "FK_Orders_Employees sales.Orders->hr.Employees SetNull/NoAction enabled",
            "FK_Shipments_OrderLines sales.Shipments->sales.OrderLines NoAction/NoAction enabled",
            "FK_Shipments_Orders_Disabled sales.Shipments->sales.Orders NoAction/NoAction disabled",
        ]
    );

    let composite = snapshot
        .foreign_keys
        .iter()
        .find(|key| key.name == "FK_Shipments_OrderLines")
        .expect("composite key");
    assert_eq!(composite.column_pairs.len(), 2);
    assert_eq!(composite.column_pairs[1].referencing_column, "LineNumber");
    assert_eq!(composite.on_delete, ReferentialAction::NoAction);
    assert!(snapshot.is_foreign_key_column(&QualifiedName::new("sales", "Orders"), "CustomerId"));
}

#[tokio::test]
async fn inspects_views_and_honours_filters() {
    let Some(server) = test_server() else { return };

    let full = inspect_fixture(&server, InspectionOptions::default()).await;
    assert_eq!(full.views.len(), 1);
    assert_eq!(full.views[0].name.to_string(), "sales.RecentOrders");
    assert_eq!(full.views[0].columns.len(), 4);

    let filtered = inspect_fixture(
        &server,
        InspectionOptions {
            schemas: vec!["sales".to_string()],
            include_views: false,
        },
    )
    .await;
    let table_names: Vec<String> = filtered
        .tables
        .iter()
        .map(|table| table.name.to_string())
        .collect();
    assert_eq!(
        table_names,
        ["sales.OrderLines", "sales.Orders", "sales.Shipments"]
    );
    assert_eq!(filtered.views, []);
    let key_names: Vec<&str> = filtered
        .foreign_keys
        .iter()
        .map(|key| key.name.as_str())
        .collect();
    assert_eq!(
        key_names,
        [
            "FK_OrderLines_Orders",
            "FK_Shipments_OrderLines",
            "FK_Shipments_Orders_Disabled"
        ]
    );
}

#[tokio::test]
async fn reports_progress_in_order_of_completion() {
    let Some(server) = test_server() else { return };
    ensure_seeded(&server, FIXTURE_DATABASE, FIXTURE_SCRIPT).await;
    let progress = RecordingProgress::default();

    inspector(settings(&server, Some(FIXTURE_DATABASE)))
        .inspect(
            &InspectionOptions::default(),
            &progress,
            CancellationToken::new(),
        )
        .await
        .expect("inspection succeeds");

    let updates = progress.updates.lock().expect("progress log");
    assert_eq!(
        updates.first().map(|update| update.stage),
        Some(InspectionStage::Connecting)
    );
    assert_eq!(
        updates.last(),
        Some(&InspectionProgress {
            stage: InspectionStage::Completed,
            count: Some(7)
        })
    );
    let objects = updates
        .iter()
        .find(|update| update.stage == InspectionStage::ReadingObjects)
        .expect("objects stage");
    assert_eq!(objects.count, Some(8));
    assert!(
        updates
            .iter()
            .any(|update| update.stage == InspectionStage::CheckingAccess),
        "{updates:?}"
    );
}

#[tokio::test]
async fn cancellation_stops_the_inspection() {
    let Some(server) = test_server() else { return };
    let cancellation = CancellationToken::new();
    cancellation.cancel();

    let result = inspector(settings(&server, None))
        .inspect(&InspectionOptions::default(), &SilentProgress, cancellation)
        .await;
    assert_eq!(kind_of(result), InspectorErrorKind::Cancelled);
}

#[tokio::test]
async fn inspects_two_hundred_tables_within_budget() {
    let Some(server) = test_server() else { return };
    ensure_seeded(&server, STRESS_DATABASE, STRESS_SCRIPT).await;

    let started = Instant::now();
    let snapshot = inspector(settings(&server, Some(STRESS_DATABASE)))
        .inspect(
            &InspectionOptions::default(),
            &SilentProgress,
            CancellationToken::new(),
        )
        .await
        .expect("inspection succeeds");
    let elapsed = started.elapsed();

    eprintln!("inspected {} tables in {elapsed:?}", snapshot.tables.len());
    assert_eq!(snapshot.tables.len(), 200);
    assert_eq!(snapshot.foreign_keys.len(), 199);
    assert!(snapshot.tables.iter().all(|table| table.indexes.len() == 2));
    assert!(elapsed < STRESS_BUDGET, "inspection took {elapsed:?}");
}

/// The fixture recreated under another name, with `changes.sql` applied on top.
fn changed_fixture_script() -> String {
    format!(
        "{}\nGO\nUSE {CHANGED_DATABASE};\nGO\n{}",
        FIXTURE_SCRIPT.replace(FIXTURE_DATABASE, CHANGED_DATABASE),
        CHANGES_SCRIPT
    )
}

fn placed(schema: &str, name: &str) -> NodeState {
    NodeState {
        name: QualifiedName::new(schema, name),
        position: Point { x: 10.0, y: 20.0 },
        is_collapsed: false,
        is_hidden: false,
        unknown: UnknownFields::new(),
    }
}

#[tokio::test]
async fn refresh_reports_the_differences_and_keeps_surviving_positions() {
    let Some(server) = test_server() else { return };
    let previous = inspect_fixture(&server, InspectionOptions::default()).await;
    ensure_seeded(&server, CHANGED_DATABASE, &changed_fixture_script()).await;
    let current = inspector(settings(&server, Some(CHANGED_DATABASE)))
        .inspect(
            &InspectionOptions::default(),
            &SilentProgress,
            CancellationToken::new(),
        )
        .await
        .expect("inspection succeeds");

    let diff = SchemaDiff::between(&previous, &current);

    // Both captures see everything, so nothing is kept unchecked or newly readable.
    assert_eq!(diff.not_checked, []);
    assert_eq!(diff.now_available, []);
    assert!(!diff.access_changed);
    assert_eq!(
        diff.summary.tables,
        ChangeCounts {
            added: 1,
            removed: 0,
            changed: 2
        }
    );
    assert_eq!(
        diff.summary.views,
        ChangeCounts {
            added: 0,
            removed: 1,
            changed: 0
        }
    );
    assert_eq!(
        diff.summary.foreign_keys,
        ChangeCounts {
            added: 1,
            removed: 0,
            changed: 1
        }
    );

    let names: Vec<String> = diff
        .tables
        .iter()
        .map(|change| change.name().to_string())
        .collect();
    assert_eq!(names, ["dbo.Customers", "sales.Invoices", "sales.Orders"]);

    let TableChange::Changed {
        columns, indexes, ..
    } = &diff.tables[0]
    else {
        panic!(
            "dbo.Customers should be reported as changed: {:?}",
            diff.tables[0]
        );
    };
    assert!(matches!(
        &columns[0],
        ColumnChange::Changed { before, properties, .. }
            if before.name == "Name" && properties == &[ColumnProperty::DataType]
    ));
    assert!(matches!(&columns[1], ColumnChange::Added { column } if column.name == "PhoneNumber"));
    assert_eq!(indexes.as_slice(), []);

    assert!(matches!(
        &diff.tables[1],
        TableChange::Added {
            column_count: 4,
            ..
        }
    ));

    let TableChange::Changed {
        columns, indexes, ..
    } = &diff.tables[2]
    else {
        panic!(
            "sales.Orders should be reported as changed: {:?}",
            diff.tables[2]
        );
    };
    assert_eq!(columns.as_slice(), []);
    assert!(matches!(
        &indexes[0],
        IndexChange::Removed { index } if index.name == "IX_Orders_CustomerId"
    ));

    assert!(matches!(
        &diff.foreign_keys[0],
        ForeignKeyChange::Added { key } if key.name == "FK_Invoices_Orders"
    ));
    assert!(matches!(
        &diff.foreign_keys[1],
        ForeignKeyChange::Changed { after, properties, .. }
            if after.name == "FK_Orders_Customers"
                && after.on_delete == ReferentialAction::Cascade
                && properties == &[ForeignKeyProperty::OnDelete, ForeignKeyProperty::OnUpdate]
    ));

    let canvas = CanvasState {
        nodes: vec![placed("dbo", "Customers"), placed("sales", "RecentOrders")],
        ..CanvasState::default()
    };
    let retained = canvas.retaining_entities_of(&current);
    assert_eq!(retained.nodes.len(), 1);
    assert_eq!(
        retained.nodes[0].name,
        QualifiedName::new("dbo", "Customers")
    );
}

/// The part of `check_forms.json` the engine can confirm. The readings are for the rule
/// reader's own tests.
#[derive(Deserialize)]
struct CheckForms {
    table: FormsTable,
    setup: Vec<String>,
    columns: Vec<FormsColumn>,
    cases: Vec<FormsCase>,
}

#[derive(Deserialize)]
struct FormsTable {
    schema: String,
    name: String,
}

#[derive(Deserialize)]
struct FormsColumn {
    name: String,
    #[serde(rename = "type")]
    data_type: String,
    nullable: bool,
}

#[derive(Deserialize)]
struct FormsCase {
    name: String,
    written: String,
    stored: String,
    #[serde(default = "enabled_when_left_out")]
    enabled: bool,
    columns: Vec<String>,
}

fn enabled_when_left_out() -> bool {
    true
}

fn check_forms() -> CheckForms {
    serde_json::from_str(CHECK_FORMS).expect("check_forms.json is valid")
}

/// `name` as a bracketed identifier, the way SQL Server writes it in stored definitions.
fn bracketed(name: &str) -> String {
    format!("[{}]", name.replace(']', "]]"))
}

/// Creates the forms table from the golden file, one constraint per case, then the facts tables.
fn check_forms_script(forms: &CheckForms) -> String {
    let table = format!(
        "{}.{}",
        bracketed(&forms.table.schema),
        bracketed(&forms.table.name)
    );
    let columns = forms.columns.iter().map(|column| {
        let nullability = if column.nullable { "NULL" } else { "NOT NULL" };
        format!(
            "    {} {} {nullability}",
            bracketed(&column.name),
            column.data_type
        )
    });
    let constraints = forms.cases.iter().map(|case| {
        format!(
            "    CONSTRAINT {} CHECK ({})",
            bracketed(&case.name),
            case.written
        )
    });
    let definitions: Vec<String> = columns.chain(constraints).collect();

    let mut batches = vec![
        format!(
            "IF DB_ID('{CHECK_FORMS_DATABASE}') IS NOT NULL
BEGIN
    ALTER DATABASE {CHECK_FORMS_DATABASE} SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE {CHECK_FORMS_DATABASE};
END"
        ),
        format!("CREATE DATABASE {CHECK_FORMS_DATABASE};"),
        format!("USE {CHECK_FORMS_DATABASE};"),
    ];
    batches.extend(forms.setup.iter().cloned());
    batches.push(format!(
        "CREATE TABLE {table} (\n{}\n);",
        definitions.join(",\n")
    ));
    batches.extend(forms.cases.iter().filter(|case| !case.enabled).map(|case| {
        format!(
            "ALTER TABLE {table} NOCHECK CONSTRAINT {};",
            bracketed(&case.name)
        )
    }));
    batches.push(RULE_FACTS_SCRIPT.to_string());
    batches.join("\nGO\n")
}

async fn seed_check_forms(server: &TestServer) {
    ensure_seeded(
        server,
        CHECK_FORMS_DATABASE,
        &check_forms_script(&check_forms()),
    )
    .await;
}

async fn inspect_check_forms(server: &TestServer) -> SchemaSnapshot {
    seed_check_forms(server).await;
    inspector(settings(server, Some(CHECK_FORMS_DATABASE)))
        .inspect(
            &InspectionOptions::default(),
            &SilentProgress,
            CancellationToken::new(),
        )
        .await
        .expect("inspection succeeds")
}

/// The columns `stored` names, in order of first appearance.
fn referenced_columns(stored: &str, columns: &[FormsColumn]) -> Vec<String> {
    let mut found: Vec<(usize, &str)> = columns
        .iter()
        .filter_map(|column| {
            stored
                .find(&bracketed(&column.name))
                .map(|position| (position, column.name.as_str()))
        })
        .collect();
    found.sort_unstable();
    found
        .into_iter()
        .map(|(_, name)| name.to_string())
        .collect()
}

/// Runs one statement and returns the rows it affected, or the number of the server error.
async fn execute(client: &mut TestClient, statement: &str) -> Result<u64, u32> {
    match client.execute(statement, &[]).await {
        Ok(result) => Ok(result.total()),
        Err(error) => Err(error
            .code()
            .unwrap_or_else(|| panic!("{statement}: {error}"))),
    }
}

/// The first column of every row `query` returns, which must be text.
async fn text_rows(client: &mut TestClient, query: &str) -> Vec<String> {
    client
        .simple_query(query)
        .await
        .unwrap_or_else(|error| panic!("{query}: {error}"))
        .into_first_result()
        .await
        .unwrap_or_else(|error| panic!("{query}: {error}"))
        .iter()
        .map(|row| row.get::<&str, _>(0).unwrap_or("NULL").to_string())
        .collect()
}

#[tokio::test]
async fn check_constraints_are_stored_in_the_forms_the_rule_reader_reads() {
    let Some(server) = test_server() else { return };
    let forms = check_forms();
    let snapshot = inspect_check_forms(&server).await;
    let table = snapshot
        .table(&QualifiedName::new(&forms.table.schema, &forms.table.name))
        .expect("the forms table");

    // The reader's tests build their columns from the file, so the file must match the engine.
    let columns: Vec<(String, String, bool)> = table
        .columns
        .iter()
        .map(|column| {
            (
                column.name.clone(),
                column.data_type.declaration(),
                column.is_nullable,
            )
        })
        .collect();
    let expected_columns: Vec<(String, String, bool)> = forms
        .columns
        .iter()
        .map(|column| {
            (
                column.name.clone(),
                column.data_type.to_uppercase(),
                column.nullable,
            )
        })
        .collect();
    assert_eq!(columns, expected_columns);

    // Every disagreement is listed at once, so a new engine version is corrected in one pass.
    let mut disagreements = Vec::new();
    for case in &forms.cases {
        let Some(constraint) = table
            .check_constraints
            .iter()
            .find(|constraint| constraint.name == case.name)
        else {
            disagreements.push(format!("{}: not created", case.name));
            continue;
        };
        if constraint.expression != Definition::readable(case.stored.as_str()) {
            disagreements.push(format!(
                "{}: the file says {:?}, the engine stored {:?}",
                case.name, case.stored, constraint.expression
            ));
        }
        if constraint.is_enabled != Some(case.enabled) {
            disagreements.push(format!(
                "{}: the file says enabled {}, the engine says {:?}",
                case.name, case.enabled, constraint.is_enabled
            ));
        }
        let referenced = referenced_columns(&case.stored, &forms.columns);
        if referenced != case.columns {
            disagreements.push(format!(
                "{}: the file lists the columns {:?}, the stored text names {referenced:?}",
                case.name, case.columns
            ));
        }
    }
    assert!(
        disagreements.is_empty(),
        "check_forms.json disagrees with the engine:\n{}",
        disagreements.join("\n")
    );
    assert_eq!(table.check_constraints.len(), forms.cases.len());
}

#[tokio::test]
async fn check_engine_facts_behind_the_sentences() {
    let Some(server) = test_server() else { return };
    seed_check_forms(&server).await;
    let mut client = connect(&server, Some(CHECK_FORMS_DATABASE)).await;
    let insert = |id: u32, column: &str, value: &str| {
        format!("INSERT INTO facts.CheckedValues (ValueId, {column}) VALUES ({id}, {value})")
    };

    // A CHECK accepts a row whose expression is UNKNOWN, so a rule on a nullable column only
    // holds when the column has a value.
    assert_eq!(
        execute(
            &mut client,
            "INSERT INTO facts.CheckedValues (ValueId) VALUES (1)"
        )
        .await,
        Ok(1)
    );
    assert_eq!(
        execute(&mut client, &insert(2, "Rating", "9")).await,
        Err(CONSTRAINT_CONFLICT)
    );

    // A NULL in an IN list leaves every other value UNKNOWN, so any value passes. In NOT IN the
    // listed values are still refused. Neither is worded.
    assert_eq!(
        execute(&mut client, &insert(3, "Status", "'Z'")).await,
        Ok(1)
    );
    assert_eq!(
        execute(&mut client, &insert(4, "Currency", "'XXX'")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, &insert(5, "Currency", "'ABC'")).await,
        Ok(1)
    );

    // Trailing spaces are not compared for equality, so a value made of spaces is blank for
    // <> '' and LEN, and an nvarchar value with trailing spaces is equal to the one without.
    assert_eq!(
        execute(&mut client, &insert(6, "Code", "'   '")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, &insert(7, "Name", "'   '")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, &insert(18, "UnicodeLetter", "N'A  '")).await,
        Ok(1)
    );

    // LIKE '%-X' accepts a varchar value that ends with -X and spaces. When the column or the
    // pattern is Unicode, the spaces count and the same value is refused.
    assert_eq!(
        execute(&mut client, &insert(11, "Suffix", "'AB-X  '")).await,
        Ok(1)
    );
    assert_eq!(
        execute(&mut client, &insert(14, "UnicodeSuffix", "N'AB-X  '")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, &insert(15, "NationalSuffix", "'AB-X  '")).await,
        Err(CONSTRAINT_CONFLICT)
    );

    // NOT LIKE '%[^0-9]%' accepts an empty string: it has no character that is not a digit.
    // A trailing space is such a character, and char pads a shorter value with spaces, so on
    // char(5) only five digits pass.
    assert_eq!(
        execute(&mut client, &insert(12, "Digits", "''")).await,
        Ok(1)
    );
    assert_eq!(
        execute(&mut client, &insert(16, "Digits", "'12 '")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, &insert(17, "FixedDigits", "''")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, &insert(19, "FixedDigits", "'12'")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, &insert(20, "FixedDigits", "'12345'")).await,
        Ok(1)
    );

    // LIKE sees the spaces char and nchar pad a shorter value with. Outside Unicode, spaces at
    // the end of the value need not match, so a suffix and a plain pattern hold as on varchar,
    // but a _ can match one: 'A' passes LIKE 'A_' on char(5), not on varchar(5), and fails NOT
    // LIKE 'A_'. In Unicode, on nchar or on char against N'...', every space counts: a suffix
    // holds only for a value as long as the column, two letters refuse 'AB', and NOT LIKE N'A_'
    // accepts it. A prefix ends with %, which takes the padding either way.
    assert_eq!(
        execute(&mut client, &insert(21, "FixedSuffix", "'AB-X'")).await,
        Ok(1)
    );
    assert_eq!(
        execute(&mut client, &insert(22, "FixedUnicodeSuffix", "N'AB-X'")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(
            &mut client,
            &insert(23, "FixedUnicodeSuffix", "N'ABCDEFGH-X'")
        )
        .await,
        Ok(1)
    );
    assert_eq!(
        execute(&mut client, &insert(24, "FixedNationalSuffix", "'AB-X'")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, &insert(25, "FixedPrefix", "N'AB'")).await,
        Ok(1)
    );
    assert_eq!(
        execute(&mut client, &insert(26, "FixedLetters", "'AB'")).await,
        Ok(1)
    );
    assert_eq!(
        execute(&mut client, &insert(27, "FixedUnicodeLetters", "N'AB'")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, &insert(28, "FixedPair", "'A'")).await,
        Ok(1)
    );
    assert_eq!(
        execute(&mut client, &insert(29, "VariablePair", "'A'")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, &insert(30, "FixedNotPair", "'A'")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, &insert(31, "FixedUnicodeNotPair", "N'AB'")).await,
        Ok(1)
    );

    // Text comparisons follow the column's collation.
    assert_eq!(
        execute(&mut client, &insert(8, "Letter", "'a'")).await,
        Ok(1)
    );
    assert_eq!(
        execute(&mut client, &insert(9, "CaseSensitiveLetter", "'a'")).await,
        Err(CONSTRAINT_CONFLICT)
    );

    // A disabled CHECK is not enforced.
    assert_eq!(
        execute(&mut client, &insert(10, "Quantity", "-1")).await,
        Ok(1)
    );

    // On a datetime column, '2000-02-01' is read with the DATEFORMAT of the session that writes
    // the row, so the same CHECK refuses 15 January under mdy and accepts it under ydm.
    let mid_january = insert(13, "LoggedAt", "'20000115'");
    assert_eq!(
        execute(&mut client, &format!("SET DATEFORMAT mdy; {mid_january}")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, &format!("SET DATEFORMAT ydm; {mid_january}")).await,
        Ok(1)
    );
}

#[tokio::test]
async fn foreign_key_engine_facts_behind_the_sentences() {
    let Some(server) = test_server() else { return };
    let snapshot = inspect_check_forms(&server).await;

    // The sentences are built from what the inspector reports for these keys.
    let keys: Vec<String> = snapshot
        .foreign_keys
        .iter()
        .filter(|key| key.referencing_table.schema == "facts")
        .map(|key| {
            format!(
                "{} {:?}/{:?} {}",
                key.name,
                key.on_delete,
                key.on_update,
                if key.is_enabled {
                    "enabled"
                } else {
                    "disabled"
                }
            )
        })
        .collect();
    assert_eq!(
        keys,
        [
            "FK_CascadeChildren_Parents Cascade/Cascade enabled",
            "FK_DisabledChildren_Parents Cascade/NoAction disabled",
            "FK_DisabledUniqueChildren_Parents NoAction/NoAction enabled",
            "FK_FilteredChildren_Parents NoAction/NoAction enabled",
            "FK_NoActionChildren_Parents NoAction/NoAction enabled",
            "FK_NoDefaultChildren_Parents SetDefault/NoAction enabled",
            "FK_Nodes_Parent NoAction/NoAction enabled",
            "FK_OwnedChildren_Owners Cascade/NoAction enabled",
            "FK_OwnedChildren_Parents NoAction/NoAction enabled",
            "FK_PairChildren_Pairs NoAction/NoAction enabled",
            "FK_SetDefaultChildren_Parents SetDefault/NoAction enabled",
            "FK_SetNullChildren_Parents SetNull/SetNull enabled",
        ]
    );
    // The snapshot records neither index filters nor disabled indexes, so a filtered unique
    // index looks like any other unique index, and a unique constraint whose index is disabled
    // like one that holds (see the last facts below).
    let index_kind = |table: &str, name: &str| {
        snapshot
            .table(&QualifiedName::new("facts", table))
            .and_then(|table| table.indexes.iter().find(|index| index.name == name))
            .map(|index| index.kind)
    };
    assert_eq!(
        index_kind("FilteredChildren", "UX_FilteredChildren_Current"),
        Some(IndexKind::UniqueIndex)
    );
    assert_eq!(
        index_kind(
            "DisabledUniqueChildren",
            "UQ_DisabledUniqueChildren_ParentCode"
        ),
        Some(IndexKind::UniqueConstraint)
    );

    let mut client = connect(&server, Some(CHECK_FORMS_DATABASE)).await;
    let parents = "INSERT INTO facts.Parents (Code) \
        VALUES ('P0'), ('P1'), ('P2'), ('P3'), ('P4'), ('P5'), ('P6'), ('P7'), ('P8'), ('P9')";
    assert_eq!(execute(&mut client, parents).await, Ok(10));

    // NO ACTION: a parent row cannot be deleted or re-keyed while a child row points to it.
    execute(
        &mut client,
        "INSERT INTO facts.NoActionChildren VALUES (1, 'P1')",
    )
    .await
    .expect("a child row");
    assert_eq!(
        execute(&mut client, "DELETE FROM facts.Parents WHERE Code = 'P1'").await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(
            &mut client,
            "UPDATE facts.Parents SET Code = 'Q1' WHERE Code = 'P1'"
        )
        .await,
        Err(CONSTRAINT_CONFLICT)
    );
    // It is checked once the statement has run: two parent rows can swap their codes, since
    // every child row then points to a row again.
    assert_eq!(
        execute(
            &mut client,
            "UPDATE facts.Parents SET Code = CASE Code WHEN 'P1' THEN 'P9' ELSE 'P1' END \
             WHERE Code IN ('P1', 'P9')"
        )
        .await,
        Ok(2)
    );
    // And a child row that a cascade through another key deletes in the same statement does
    // not block the delete.
    execute(
        &mut client,
        "INSERT INTO facts.OwnedChildren VALUES (1, 'P8', 'P8')",
    )
    .await
    .expect("a child row");
    assert_eq!(
        execute(&mut client, "DELETE FROM facts.Parents WHERE Code = 'P8'").await,
        Ok(1)
    );
    assert_eq!(
        text_rows(
            &mut client,
            "SELECT CONCAT(ChildId, ' ', ParentCode) FROM facts.OwnedChildren"
        )
        .await,
        Vec::<String>::new()
    );

    // CASCADE: re-keying a parent row re-keys its children, and deleting it deletes them.
    execute(
        &mut client,
        "INSERT INTO facts.CascadeChildren VALUES (1, 'P2'), (2, 'P3')",
    )
    .await
    .expect("child rows");
    assert_eq!(
        execute(
            &mut client,
            "UPDATE facts.Parents SET Code = 'Q2' WHERE Code = 'P2'"
        )
        .await,
        Ok(1)
    );
    assert_eq!(
        execute(&mut client, "DELETE FROM facts.Parents WHERE Code = 'P3'").await,
        Ok(1)
    );
    assert_eq!(
        text_rows(
            &mut client,
            "SELECT CONCAT(ChildId, ' ', ParentCode) FROM facts.CascadeChildren ORDER BY ChildId"
        )
        .await,
        ["1 Q2"]
    );

    // SET NULL: deleting a parent row empties the column in its children.
    execute(
        &mut client,
        "INSERT INTO facts.SetNullChildren VALUES (1, 'P4')",
    )
    .await
    .expect("a child row");
    assert_eq!(
        execute(&mut client, "DELETE FROM facts.Parents WHERE Code = 'P4'").await,
        Ok(1)
    );
    assert_eq!(
        text_rows(
            &mut client,
            "SELECT ParentCode FROM facts.SetNullChildren WHERE ChildId = 1"
        )
        .await,
        ["NULL"]
    );

    // SET DEFAULT: the column takes its DEFAULT, or NULL when it has none, and a delete that
    // would leave the default pointing at no row is refused.
    execute(
        &mut client,
        "INSERT INTO facts.SetDefaultChildren VALUES (1, 'P5')",
    )
    .await
    .expect("a child row");
    assert_eq!(
        execute(&mut client, "DELETE FROM facts.Parents WHERE Code = 'P5'").await,
        Ok(1)
    );
    assert_eq!(
        text_rows(
            &mut client,
            "SELECT ParentCode FROM facts.SetDefaultChildren"
        )
        .await,
        ["P0"]
    );
    assert_eq!(
        execute(&mut client, "DELETE FROM facts.Parents WHERE Code = 'P0'").await,
        Err(CONSTRAINT_CONFLICT)
    );
    execute(
        &mut client,
        "INSERT INTO facts.NoDefaultChildren VALUES (1, 'P6')",
    )
    .await
    .expect("a child row");
    assert_eq!(
        execute(&mut client, "DELETE FROM facts.Parents WHERE Code = 'P6'").await,
        Ok(1)
    );
    assert_eq!(
        text_rows(
            &mut client,
            "SELECT ParentCode FROM facts.NoDefaultChildren"
        )
        .await,
        ["NULL"]
    );

    // An identity column cannot be updated, so ON UPDATE never runs for a key that references
    // one.
    assert_eq!(
        execute(
            &mut client,
            "UPDATE facts.Parents SET ParentId = ParentId + 100 WHERE Code = 'P0'"
        )
        .await,
        Err(IDENTITY_UPDATE)
    );

    // A child row with NULL in a single-column key needs no parent row.
    assert_eq!(
        execute(
            &mut client,
            "INSERT INTO facts.SetNullChildren VALUES (2, NULL)"
        )
        .await,
        Ok(1)
    );

    // A composite key is checked only when every column has a value.
    execute(&mut client, "INSERT INTO facts.Pairs VALUES (1, 1)")
        .await
        .expect("a parent row");
    assert_eq!(
        execute(
            &mut client,
            "INSERT INTO facts.PairChildren VALUES (1, 1, 1)"
        )
        .await,
        Ok(1)
    );
    assert_eq!(
        execute(
            &mut client,
            "INSERT INTO facts.PairChildren VALUES (2, 99, NULL)"
        )
        .await,
        Ok(1)
    );
    assert_eq!(
        execute(
            &mut client,
            "INSERT INTO facts.PairChildren VALUES (3, 99, 99)"
        )
        .await,
        Err(CONSTRAINT_CONFLICT)
    );

    // A disabled key checks nothing and cascades nothing.
    assert_eq!(
        execute(
            &mut client,
            "INSERT INTO facts.DisabledChildren VALUES (1, 'ZZ')"
        )
        .await,
        Ok(1)
    );
    execute(
        &mut client,
        "INSERT INTO facts.DisabledChildren VALUES (2, 'P7')",
    )
    .await
    .expect("a child row");
    assert_eq!(
        execute(&mut client, "DELETE FROM facts.Parents WHERE Code = 'P7'").await,
        Ok(1)
    );
    assert_eq!(
        text_rows(
            &mut client,
            "SELECT CONCAT(ChildId, ' ', ParentCode) FROM facts.DisabledChildren ORDER BY ChildId"
        )
        .await,
        ["1 ZZ", "2 P7"]
    );
    // Adding a key checks the rows already there, so the reader scripts a disabled key, whose
    // rows need not follow it, as added WITH NOCHECK and then disabled.
    execute(
        &mut client,
        "INSERT INTO facts.UncheckedChildren VALUES (1, 'ZZ')",
    )
    .await
    .expect("a row without a parent row");
    let scripted = |option: &str| {
        format!(
            "ALTER TABLE [facts].[UncheckedChildren]{option} \
             ADD CONSTRAINT [FK_UncheckedChildren_Parents]\n  \
             FOREIGN KEY ([ParentCode]) REFERENCES [facts].[Parents] ([Code]);"
        )
    };
    assert_eq!(
        execute(&mut client, &scripted("")).await,
        Err(CONSTRAINT_CONFLICT)
    );
    let disabled = format!(
        "{}\nALTER TABLE [facts].[UncheckedChildren] NOCHECK CONSTRAINT [FK_UncheckedChildren_Parents];",
        scripted(" WITH NOCHECK")
    );
    assert!(execute(&mut client, &disabled).await.is_ok());

    // A self-reference, checked once the statement has run: a row may point to itself, a row
    // that other rows still point to afterwards cannot be deleted or re-keyed, and one statement
    // can delete a row with the rows pointing to it, re-key a row that points to itself along
    // with its pointer, or swap two keys.
    execute(
        &mut client,
        "INSERT INTO facts.Nodes VALUES (1, NULL), (2, 2), (3, 1), (4, 4), (5, NULL), (6, NULL), \
         (7, 5)",
    )
    .await
    .expect("node rows");
    assert_eq!(
        execute(&mut client, "DELETE FROM facts.Nodes WHERE NodeId = 1").await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(&mut client, "DELETE FROM facts.Nodes WHERE NodeId = 2").await,
        Ok(1)
    );
    assert_eq!(
        execute(
            &mut client,
            "DELETE FROM facts.Nodes WHERE NodeId IN (1, 3)"
        )
        .await,
        Ok(2)
    );
    assert_eq!(
        execute(
            &mut client,
            "UPDATE facts.Nodes SET NodeId = 40 WHERE NodeId = 4"
        )
        .await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        execute(
            &mut client,
            "UPDATE facts.Nodes SET NodeId = 40, ParentNodeId = 40 WHERE NodeId = 4"
        )
        .await,
        Ok(1)
    );
    assert_eq!(
        execute(
            &mut client,
            "UPDATE facts.Nodes SET NodeId = 11 - NodeId WHERE NodeId IN (5, 6)"
        )
        .await,
        Ok(2)
    );
    assert_eq!(
        execute(
            &mut client,
            "UPDATE facts.Nodes SET NodeId = 50 WHERE NodeId = 5"
        )
        .await,
        Err(CONSTRAINT_CONFLICT)
    );
    assert_eq!(
        text_rows(
            &mut client,
            "SELECT CONCAT(NodeId, ' ', ParentNodeId) FROM facts.Nodes ORDER BY NodeId"
        )
        .await,
        ["5 ", "6 ", "7 5", "40 40"]
    );

    // A filtered unique index limits only the rows inside its filter, so it does not make a
    // parent row have at most one child row.
    assert_eq!(
        execute(
            &mut client,
            "INSERT INTO facts.FilteredChildren VALUES (1, 'P0', 0), (2, 'P0', 0)"
        )
        .await,
        Ok(2)
    );
    assert_eq!(
        execute(
            &mut client,
            "INSERT INTO facts.FilteredChildren VALUES (3, 'P0', 1), (4, 'P0', 1)"
        )
        .await,
        Err(DUPLICATE_KEY)
    );
    // Nor does a unique constraint whose index is disabled, which the snapshot still reports.
    assert_eq!(
        execute(
            &mut client,
            "INSERT INTO facts.DisabledUniqueChildren VALUES (1, 'P0'), (2, 'P0')"
        )
        .await,
        Ok(2)
    );
}
