//! Integration tests against a real SQL Server instance.
//!
//! They run only when `SCHEMACRAFT_TEST_MSSQL_HOST`, `SCHEMACRAFT_TEST_MSSQL_PORT`,
//! `SCHEMACRAFT_TEST_MSSQL_USER` and `SCHEMACRAFT_TEST_MSSQL_PASSWORD` are set; otherwise every
//! test prints a notice and passes. `scripts/dev-sqlserver.ps1` starts a suitable container.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::print_stderr,
    clippy::too_many_lines
)]

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use schemacraft_core::diff::{
    ChangeCounts, ColumnChange, ColumnProperty, ForeignKeyChange, ForeignKeyProperty, IndexChange,
    SchemaDiff, TableChange,
};
use schemacraft_core::inspectors::sqlserver::{
    EncryptionMode, PasswordSource, SqlServerAuthentication, SqlServerConnectionSettings,
};
use schemacraft_core::inspectors::{
    ConnectionSettings, DatabaseInspector, InspectionOptions, InspectionProgress, InspectionStage,
    InspectorError, InspectorErrorKind, ProgressReporter, SilentProgress, create_inspector,
};
use schemacraft_core::model::{IndexKind, QualifiedName, ReferentialAction, SchemaSnapshot};
use schemacraft_core::project::{CanvasState, NodeState, Point};
use secrecy::SecretString;
use tiberius::Client;
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;
use tokio_util::sync::CancellationToken;

const FIXTURE_DATABASE: &str = "SchemaCraftFixture";
const STRESS_DATABASE: &str = "SchemaCraftStress";
const FIXTURE_SCRIPT: &str = include_str!("fixtures/sqlserver/fixture.sql");
const STRESS_SCRIPT: &str = include_str!("fixtures/sqlserver/stress_200_tables.sql");
const CHANGED_DATABASE: &str = "SchemaCraftFixtureChanged";
const CHANGES_SCRIPT: &str = include_str!("fixtures/sqlserver/changes.sql");

/// Budget for inspecting 200 tables; the product target is 3 seconds on a local network.
const STRESS_BUDGET: Duration = Duration::from_secs(5);

struct TestServer {
    host: String,
    port: u16,
    user: String,
    password: String,
}

fn test_server() -> Option<TestServer> {
    let read = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
    let Some(host) = read("SCHEMACRAFT_TEST_MSSQL_HOST") else {
        eprintln!("skipping: SCHEMACRAFT_TEST_MSSQL_* variables are not set");
        return None;
    };
    Some(TestServer {
        host,
        port: read("SCHEMACRAFT_TEST_MSSQL_PORT")
            .and_then(|port| port.parse().ok())
            .unwrap_or(1433),
        user: read("SCHEMACRAFT_TEST_MSSQL_USER").unwrap_or_else(|| "sa".to_string()),
        password: read("SCHEMACRAFT_TEST_MSSQL_PASSWORD").unwrap_or_default(),
    })
}

fn settings(server: &TestServer, database: Option<&str>) -> SqlServerConnectionSettings {
    SqlServerConnectionSettings {
        host: server.host.clone(),
        instance: None,
        port: Some(server.port),
        database: database.map(str::to_string),
        authentication: SqlServerAuthentication::SqlLogin {
            username: server.user.clone(),
            password: PasswordSource::Provided {
                value: SecretString::from(server.password.clone()),
            },
        },
        encryption: EncryptionMode::Mandatory,
        // The container presents a self-signed certificate.
        trust_server_certificate: true,
        connect_timeout_seconds: 10,
    }
}

fn inspector(settings: SqlServerConnectionSettings) -> Box<dyn DatabaseInspector> {
    create_inspector(ConnectionSettings::SqlServer(settings)).expect("settings are valid")
}

/// Splits a script on `GO` separators, the way sqlcmd does.
fn batches(script: &str) -> Vec<String> {
    let mut batches = Vec::new();
    let mut current = String::new();
    for line in script.lines() {
        if line.trim().eq_ignore_ascii_case("GO") {
            if !current.trim().is_empty() {
                batches.push(std::mem::take(&mut current));
            }
            current.clear();
        } else {
            current.push_str(line);
            current.push('\n');
        }
    }
    if !current.trim().is_empty() {
        batches.push(current);
    }
    batches
}

async fn run_script(server: &TestServer, script: &str) {
    let config = settings(server, None)
        .to_tiberius_config()
        .expect("settings are valid");
    let tcp = TcpStream::connect(config.get_addr())
        .await
        .expect("TCP connection to the test server");
    tcp.set_nodelay(true).expect("nodelay");
    let mut client = Client::connect(config, tcp.compat_write())
        .await
        .expect("login to the test server");

    for batch in batches(script) {
        client
            .simple_query(batch.as_str())
            .await
            .unwrap_or_else(|error| panic!("batch failed: {error}\n{batch}"))
            .into_results()
            .await
            .unwrap_or_else(|error| panic!("batch failed: {error}\n{batch}"));
    }
}

/// Seeds each fixture database once per test run. The lock is held while the script runs, so
/// tests that need the same database wait for it instead of connecting while it is recreated.
static SEEDED: LazyLock<tokio::sync::Mutex<HashSet<&'static str>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(HashSet::new()));

async fn ensure_seeded(server: &TestServer, database: &'static str, script: &str) {
    let mut seeded = SEEDED.lock().await;
    if !seeded.contains(database) {
        run_script(server, script).await;
        seeded.insert(database);
    }
}

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

    let schemas = inspector(settings(&server, Some(FIXTURE_DATABASE)))
        .list_schemas()
        .await
        .expect("schemas");
    // `staging` is empty and `db_datareader` is owned by dbo in the fixture; neither is offered.
    assert_eq!(schemas, ["dbo", "hr", "sales"]);
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
        customers.columns[4].default_expression.as_deref(),
        Some("(sysutcdatetime())")
    );
    assert_eq!(
        customers.columns[5].default_expression.as_deref(),
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
            .as_deref(),
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
    assert_eq!(lines.check_constraints[0].expression, "([Quantity]>(0))");
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
