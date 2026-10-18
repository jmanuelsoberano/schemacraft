//! Integration tests that read one fixture database as logins with different rights, so every
//! access verdict, every hidden text and every refresh rule is checked against a real server.
//! `tests/common` says when they run.
//!
//! The logins are created by `fixtures/sqlserver/permission_logins.sql` with a password made up
//! for the run. They live at server level, use the `schemacraft_` prefix and are recreated on
//! every run.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::print_stderr,
    clippy::too_many_lines
)]

mod common;

use std::collections::BTreeSet;
use std::hash::{BuildHasher, RandomState};
use std::sync::LazyLock;

use schemacraft_core::diff::SchemaDiff;
use schemacraft_core::inspectors::sqlserver::EncryptionMode;
use schemacraft_core::inspectors::{DatabaseDescription, InspectionOptions, SilentProgress};
use schemacraft_core::model::{
    AccessLevel, Completeness, Definition, QualifiedName, SchemaSnapshot, SnapshotFact,
    UnknownFields,
};
use schemacraft_core::project::{
    CanvasState, NodeState, Point, Project, ProjectContent, SavedConnection,
    SavedSqlServerAuthentication, SavedSqlServerConnection, read_project,
};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use self::common::{
    TestServer, as_login, ensure_seeded, inspector, run_probe, settings, test_server,
};

const DATABASE: &str = "SchemaCraftPermissions";
const EMPTY_DATABASE: &str = "SchemaCraftPermissionsEmpty";
const PUBLIC_DENY_DATABASE: &str = "SchemaCraftPermissionsPublicDeny";
const DATABASE_SCRIPT: &str = include_str!("fixtures/sqlserver/permissions.sql");
const LOGINS_SCRIPT: &str = include_str!("fixtures/sqlserver/permission_logins.sql");

const OWNER: &str = "schemacraft_owner";
const READER: &str = "schemacraft_reader";
const VIEW_DEFINITION: &str = "schemacraft_viewdef";
const READER_WITH_SALES_TEXTS: &str = "schemacraft_sales_vd";
const TWO_TABLES: &str = "schemacraft_two_tables";
const CONNECT_ONLY: &str = "schemacraft_connect";
const VIEW_DEFINITION_DENIED_AUDIT: &str = "schemacraft_vd_deny_audit";
const READER_DENIED_AUDIT: &str = "schemacraft_reader_deny_audit";
const READER_DENIED_COLUMN: &str = "schemacraft_reader_deny_column";

/// Password of every login of the run. It is random, so none is committed, and it mixes cases,
/// digits and a symbol in case a password policy applies after all.
static PASSWORD: LazyLock<String> = LazyLock::new(|| {
    let random = || RandomState::new().hash_one(std::process::id());
    format!("Sc!{:016x}{:016x}", random(), random())
});

/// Creates both databases and every login, once per run.
async fn seed(server: &TestServer) {
    let logins = LOGINS_SCRIPT.replace("$(PASSWORD)", &PASSWORD);
    let script = format!("{DATABASE_SCRIPT}\nGO\n{logins}");
    ensure_seeded(server, DATABASE, &script).await;
}

async fn describe(server: &TestServer, login: &str, database: &str) -> DatabaseDescription {
    seed(server).await;
    inspector(settings(
        &as_login(server, login, &PASSWORD),
        Some(database),
    ))
    .describe_database()
    .await
    .unwrap_or_else(|error| panic!("{login} describes {database}: {error}"))
}

async fn inspect_as(server: &TestServer, login: &str, database: &str) -> SchemaSnapshot {
    seed(server).await;
    inspector(settings(
        &as_login(server, login, &PASSWORD),
        Some(database),
    ))
    .inspect(
        &InspectionOptions::default(),
        &SilentProgress,
        CancellationToken::new(),
    )
    .await
    .unwrap_or_else(|error| panic!("{login} inspects {database}: {error}"))
}

fn names<'a>(names: impl IntoIterator<Item = &'a QualifiedName>) -> Vec<String> {
    names.into_iter().map(ToString::to_string).collect()
}

fn table_names(snapshot: &SchemaSnapshot) -> Vec<String> {
    names(snapshot.tables.iter().map(|table| &table.name))
}

/// Every `CHECK` and `DEFAULT` text of the snapshot, by table and constraint or column.
fn texts(snapshot: &SchemaSnapshot) -> Vec<(String, Definition)> {
    snapshot
        .tables
        .iter()
        .flat_map(|table| {
            let checks = table.check_constraints.iter().map(|constraint| {
                (
                    format!("{}.{}", table.name, constraint.name),
                    constraint.expression.clone(),
                )
            });
            let defaults = table.columns.iter().filter_map(|column| {
                column
                    .default_expression
                    .clone()
                    .map(|default| (format!("{}.{}", table.name, column.name), default))
            });
            checks.chain(defaults).collect::<Vec<_>>()
        })
        .collect()
}

fn not_checked(diff: &SchemaDiff) -> BTreeSet<(String, SnapshotFact)> {
    diff.not_checked
        .iter()
        .map(|carried| (carried.object.to_string(), carried.fact.clone()))
        .collect()
}

/// A project holding `snapshot`, with every table placed.
fn project_with(snapshot: SchemaSnapshot) -> ProjectContent {
    let nodes = snapshot
        .tables
        .iter()
        .enumerate()
        .map(|(position, table)| NodeState {
            name: table.name.clone(),
            position: Point {
                x: 40.0 * f64::from(u32::try_from(position).unwrap()),
                y: 80.0,
            },
            is_collapsed: false,
            is_hidden: false,
            unknown: UnknownFields::new(),
        })
        .collect();
    ProjectContent {
        connection: SavedConnection::SqlServer(SavedSqlServerConnection {
            host: "localhost".to_string(),
            instance: None,
            port: Some(1433),
            database: Some(DATABASE.to_string()),
            authentication: SavedSqlServerAuthentication::SqlLogin {
                username: OWNER.to_string(),
            },
            encryption: EncryptionMode::Mandatory,
            trust_server_certificate: true,
        }),
        inspection: InspectionOptions::default(),
        snapshot,
        canvas: CanvasState {
            nodes,
            ..CanvasState::default()
        },
        unknown: UnknownFields::new(),
    }
}

/// The project SchemaCraft 1.0 would have saved from what `snapshot` read, opened by this
/// version: 1.0 wrote format 1 without an access profile, an empty text for a `CHECK` it could
/// not read, no default whose text it could not read, no default bound with `sp_bindefault`
/// (it read `sys.default_constraints` only) and no key to a table the login could not see.
fn saved_by_1_0_and_reopened(snapshot: &SchemaSnapshot) -> SchemaSnapshot {
    let project = Project::new(
        project_with(snapshot.clone()),
        snapshot.extracted_at,
        "SchemaCraft 1.0.0",
    );
    let mut document = serde_json::to_value(&project).unwrap();
    let root = document.as_object_mut().unwrap();
    root.insert("formatVersion".to_string(), json!(1));
    root.remove("minReaderVersion");
    let saved = root.get_mut("snapshot").unwrap().as_object_mut().unwrap();
    for key in ["access", "foreignKeysToInvisibleTables", "carriedOver"] {
        saved.remove(key);
    }
    for table in saved["tables"].as_array_mut().unwrap() {
        let is_legacy = table["name"] == json!({ "schema": "dbo", "name": "Legacy" });
        for column in table["columns"].as_array_mut().unwrap() {
            let is_bound = is_legacy && column["name"] == "Amount";
            column["defaultExpression"] = match column["defaultExpression"]["text"].as_str() {
                Some(text) if !is_bound => json!(text),
                _ => Value::Null,
            };
        }
        for constraint in table["checkConstraints"].as_array_mut().unwrap() {
            let text = constraint["expression"]["text"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            constraint["expression"] = json!(text);
            constraint.as_object_mut().unwrap().remove("isEnabled");
        }
    }

    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("saved-by-1.0.scraft");
    std::fs::write(&path, serde_json::to_vec_pretty(&document).unwrap()).unwrap();
    let opened = read_project(&path).unwrap();
    assert!(!opened.is_read_only);
    opened.project.content.snapshot
}

/// What the connection dialog is expected to predict for one login.
struct Expected {
    login: &'static str,
    level: AccessLevel,
    objects: Completeness,
    definitions: Completeness,
    schemas: &'static [&'static str],
}

#[tokio::test]
async fn describe_database_classifies_every_login() {
    use AccessLevel::{Full, NothingVisible, Partial};
    use Completeness::{Complete, NotAvailable};

    let Some(server) = test_server() else { return };
    let every_schema: &[&str] = &["audit", "dbo", "sales"];
    let expectations = [
        Expected {
            login: OWNER,
            level: Full,
            objects: Complete,
            definitions: Complete,
            schemas: every_schema,
        },
        Expected {
            login: READER,
            level: Partial,
            objects: Complete,
            definitions: NotAvailable,
            schemas: every_schema,
        },
        Expected {
            login: VIEW_DEFINITION,
            level: Full,
            objects: Complete,
            definitions: Complete,
            schemas: every_schema,
        },
        Expected {
            login: READER_WITH_SALES_TEXTS,
            level: Partial,
            objects: Complete,
            definitions: Completeness::Partial,
            schemas: every_schema,
        },
        Expected {
            login: TWO_TABLES,
            level: Partial,
            objects: Completeness::Partial,
            definitions: NotAvailable,
            schemas: &["sales"],
        },
        Expected {
            login: CONNECT_ONLY,
            level: NothingVisible,
            objects: NotAvailable,
            definitions: NotAvailable,
            schemas: &[],
        },
        Expected {
            login: VIEW_DEFINITION_DENIED_AUDIT,
            level: Partial,
            objects: Completeness::Partial,
            definitions: Complete,
            schemas: &["dbo", "sales"],
        },
        Expected {
            login: READER_DENIED_AUDIT,
            level: Partial,
            objects: Completeness::Partial,
            definitions: NotAvailable,
            schemas: &["dbo", "sales"],
        },
    ];

    for expected in expectations {
        let description = describe(&server, expected.login, DATABASE).await;
        let access = &description.access;
        assert_eq!(
            (
                access.level,
                access.coverage.objects,
                access.coverage.definitions
            ),
            (expected.level, expected.objects, expected.definitions),
            "{}: {access:?}",
            expected.login
        );
        assert_eq!(description.schemas, expected.schemas, "{}", expected.login);
        assert_eq!(
            access.probe.database_user.as_deref(),
            Some(expected.login),
            "{}",
            expected.login
        );
    }
}

#[tokio::test]
async fn a_schema_denial_is_counted_even_where_select_is_granted() {
    let Some(server) = test_server() else { return };

    for login in [VIEW_DEFINITION_DENIED_AUDIT, READER_DENIED_AUDIT] {
        let probe = describe(&server, login, DATABASE).await.access.probe;
        assert_eq!(probe.explicit_denials, Some(1), "{login}: {probe:?}");
        let audit = probe
            .schemas
            .iter()
            .find(|schema| schema.name == "audit")
            .unwrap_or_else(|| panic!("{login} lists audit: {probe:?}"));
        assert!(audit.is_denied, "{login}: {audit:?}");
        assert!(!audit.has_visible_objects, "{login}: {audit:?}");
    }

    // db_datareader still holds SELECT on the schema it can no longer see.
    let reader = describe(&server, READER_DENIED_AUDIT, DATABASE).await;
    assert!(
        reader
            .access
            .probe
            .schemas
            .iter()
            .any(|schema| schema.name == "audit" && schema.can_read_data)
    );
}

#[tokio::test]
async fn a_denial_to_public_never_reaches_dbo() {
    let Some(server) = test_server() else { return };
    seed(&server).await;

    // The server administrator enters every database as dbo, which no DENY applies to.
    let administrator = inspector(settings(&server, Some(PUBLIC_DENY_DATABASE)));
    let description = administrator
        .describe_database()
        .await
        .unwrap_or_else(|error| {
            panic!("{} describes {PUBLIC_DENY_DATABASE}: {error}", server.user)
        });
    let access = &description.access;
    assert_eq!(access.probe.database_user.as_deref(), Some("dbo"));
    assert_eq!(access.probe.explicit_denials, Some(0), "{access:?}");
    assert!(
        access.probe.schemas.iter().all(|schema| !schema.is_denied),
        "{access:?}"
    );
    assert_eq!(access.level, AccessLevel::Full, "{access:?}");
    assert_eq!(description.schemas, ["dbo", "hr"]);

    // Its capture vouches for every schema, so a table dropped later is reported as removed.
    let snapshot = administrator
        .inspect(
            &InspectionOptions::default(),
            &SilentProgress,
            CancellationToken::new(),
        )
        .await
        .unwrap_or_else(|error| panic!("{} inspects {PUBLIC_DENY_DATABASE}: {error}", server.user));
    assert_eq!(
        table_names(&snapshot),
        ["dbo.Departments", "dbo.Payroll", "hr.Salaries"]
    );
    for schema in ["dbo", "hr"] {
        assert!(
            snapshot.vouches_for_absence_of(&QualifiedName::new(schema, "Dropped")),
            "{schema}"
        );
    }

    // The same denials reach a db_datareader member through public.
    let reader = describe(&server, READER, PUBLIC_DENY_DATABASE).await.access;
    assert_eq!(reader.probe.explicit_denials, Some(2), "{reader:?}");
    assert!(
        reader
            .probe
            .schemas
            .iter()
            .any(|schema| schema.name == "hr" && schema.is_denied),
        "{reader:?}"
    );
    assert_eq!(
        (reader.level, reader.coverage.objects),
        (AccessLevel::Partial, Completeness::Partial)
    );
}

#[tokio::test]
async fn a_column_denial_hides_no_object() {
    let Some(server) = test_server() else { return };

    let description = describe(&server, READER_DENIED_COLUMN, DATABASE).await;
    assert_eq!(description.access.probe.explicit_denials, Some(0));
    assert_eq!(description.access.coverage.objects, Completeness::Complete);

    let snapshot = inspect_as(&server, READER_DENIED_COLUMN, DATABASE).await;
    let customers = snapshot
        .table(&QualifiedName::new("dbo", "Customers"))
        .expect("customers is visible");
    assert!(customers.column("Name").is_some(), "{customers:?}");
    assert_eq!(
        table_names(&snapshot),
        table_names(&inspect_as(&server, OWNER, DATABASE).await)
    );
}

#[tokio::test]
async fn a_reader_never_sees_a_hidden_text_as_an_empty_one() {
    let Some(server) = test_server() else { return };

    let reader = inspect_as(&server, READER, DATABASE).await;
    let owner = inspect_as(&server, OWNER, DATABASE).await;

    let checks = |snapshot: &SchemaSnapshot| -> Vec<Definition> {
        snapshot
            .tables
            .iter()
            .flat_map(|table| table.check_constraints.iter())
            .map(|constraint| constraint.expression.clone())
            .collect()
    };
    assert_eq!(checks(&reader), vec![Definition::NotVisible; 5]);
    assert!(checks(&owner).iter().all(|text| text.text().is_some()));
    assert_eq!(checks(&owner).len(), 5);

    let defaults_of = |snapshot: &SchemaSnapshot| -> Vec<(String, Definition)> {
        texts(snapshot)
            .into_iter()
            .filter(|(name, _)| !name.contains(".CK_"))
            .collect()
    };
    assert_eq!(
        defaults_of(&reader),
        [
            (
                "audit.ChangeLog.ChangedAt".to_string(),
                Definition::NotVisible
            ),
            (
                "dbo.Customers.CreatedAt".to_string(),
                Definition::NotVisible
            ),
            ("dbo.Legacy.Amount".to_string(), Definition::readable("0")),
            ("sales.Orders.Status".to_string(), Definition::NotVisible),
        ]
    );
    assert_eq!(
        defaults_of(&owner),
        [
            (
                "audit.ChangeLog.ChangedAt".to_string(),
                Definition::readable("(sysutcdatetime())")
            ),
            (
                "dbo.Customers.CreatedAt".to_string(),
                Definition::readable("(sysutcdatetime())")
            ),
            ("dbo.Legacy.Amount".to_string(), Definition::readable("0")),
            (
                "sales.Orders.Status".to_string(),
                Definition::readable("('N')")
            ),
        ]
    );

    for (name, text) in texts(&reader).into_iter().chain(texts(&owner)) {
        assert_ne!(text, Definition::readable(""), "{name}");
    }

    let access = reader.access.as_ref().unwrap();
    assert_eq!(access.counts.definitions, 9);
    assert_eq!(access.counts.definitions_not_visible, 8);
    // The bound default is readable, so the texts are partial rather than not available.
    assert_eq!(access.coverage.definitions, Completeness::Partial);
    assert_eq!(access.coverage.objects, Completeness::Complete);
}

#[tokio::test]
async fn foreign_keys_to_invisible_tables_are_kept() {
    let Some(server) = test_server() else { return };

    let snapshot = inspect_as(&server, TWO_TABLES, DATABASE).await;

    assert_eq!(table_names(&snapshot), ["sales.OrderLines", "sales.Orders"]);
    assert_eq!(snapshot.views, []);
    let edges: Vec<&str> = snapshot
        .foreign_keys
        .iter()
        .map(|key| key.name.as_str())
        .collect();
    assert_eq!(edges, ["FK_OrderLines_Orders"]);
    let invisible: Vec<(String, &str, Vec<String>)> = snapshot
        .foreign_keys_to_invisible_tables
        .iter()
        .map(|key| {
            (
                key.referencing_table.to_string(),
                key.name.as_str(),
                key.columns.clone(),
            )
        })
        .collect();
    assert_eq!(
        invisible,
        [
            (
                "sales.OrderLines".to_string(),
                "FK_OrderLines_Products",
                vec!["ProductId".to_string()]
            ),
            (
                "sales.Orders".to_string(),
                "FK_Orders_Customers",
                vec!["CustomerId".to_string()]
            ),
        ]
    );
    let orders = QualifiedName::new("sales", "Orders");
    assert!(snapshot.is_foreign_key_column(&orders, "CustomerId"));

    let access = snapshot.access.as_ref().unwrap();
    assert_eq!(access.level, AccessLevel::Partial);
    assert_eq!(access.coverage.objects, Completeness::Partial);
    assert_eq!(access.counts.foreign_keys_to_invisible_tables, 2);
}

#[tokio::test]
async fn refresh_with_a_weaker_login_removes_nothing() {
    let Some(server) = test_server() else { return };
    let owner = inspect_as(&server, OWNER, DATABASE).await;
    let change_log = "audit.ChangeLog".to_string();
    let change_log_key = SnapshotFact::ForeignKey {
        name: "FK_ChangeLog_Orders".to_string(),
    };

    for login in [
        READER,
        READER_WITH_SALES_TEXTS,
        TWO_TABLES,
        VIEW_DEFINITION_DENIED_AUDIT,
        READER_DENIED_AUDIT,
    ] {
        let weaker = inspect_as(&server, login, DATABASE).await;
        let diff = SchemaDiff::between(&owner, &weaker);

        assert!(diff.is_empty(), "{login}: {diff:?}");
        assert_eq!(diff.summary.total(), 0, "{login}");
        assert!(diff.access_changed, "{login}");
        assert!(!diff.is_up_to_date(), "{login}");

        let refreshed = project_with(owner.clone()).with_refreshed_snapshot(weaker.clone());
        assert_eq!(refreshed.snapshot.tables, owner.tables, "{login}");
        assert_eq!(refreshed.snapshot.views, owner.views, "{login}");
        assert_eq!(
            refreshed.snapshot.foreign_keys, owner.foreign_keys,
            "{login}"
        );
        assert_eq!(
            refreshed.canvas.nodes.len(),
            owner.tables.len(),
            "{login} keeps every placed table"
        );
        assert_eq!(refreshed.snapshot.carried_over, diff.not_checked, "{login}");
        assert_eq!(refreshed.snapshot.access, weaker.access, "{login}");
    }

    for login in [VIEW_DEFINITION_DENIED_AUDIT, READER_DENIED_AUDIT] {
        let diff = SchemaDiff::between(&owner, &inspect_as(&server, login, DATABASE).await);
        let facts = not_checked(&diff);
        assert!(
            facts.contains(&(change_log.clone(), SnapshotFact::Table)),
            "{login}: {facts:?}"
        );
        assert!(
            facts.contains(&(change_log.clone(), change_log_key.clone())),
            "{login}: {facts:?}"
        );
    }

    let reader = SchemaDiff::between(&owner, &inspect_as(&server, READER, DATABASE).await);
    let hidden_texts: Vec<String> = reader
        .not_checked
        .iter()
        .map(|carried| match &carried.fact {
            SnapshotFact::CheckConstraint { name } => format!("{}.{name}", carried.object),
            SnapshotFact::ColumnDefault { column } => format!("{}.{column}", carried.object),
            other => panic!("the reader sees every object, yet {other:?} was kept"),
        })
        .collect();
    assert_eq!(
        hidden_texts,
        [
            "audit.ChangeLog.ChangedAt",
            "audit.ChangeLog.CK_ChangeLog_Action",
            "dbo.Customers.CreatedAt",
            "dbo.Customers.CK_Customers_Name",
            "dbo.Products.CK_Products_Price",
            "sales.OrderLines.CK_OrderLines_Quantity",
            "sales.Orders.Status",
            "sales.Orders.CK_Orders_Status",
        ]
    );
}

#[tokio::test]
async fn refresh_with_a_stronger_login_changes_nothing() {
    let Some(server) = test_server() else { return };
    let owner = inspect_as(&server, OWNER, DATABASE).await;
    let reader = inspect_as(&server, READER, DATABASE).await;

    let diff = SchemaDiff::between(&reader, &owner);
    assert!(diff.is_empty(), "{diff:?}");
    assert_eq!(diff.not_checked, []);
    assert_eq!(diff.now_available.len(), 8, "{:?}", diff.now_available);
    assert!(diff.access_changed);

    // After a weak refresh, a full one clears what was kept and finds nothing new.
    let kept = reader.with_unchecked_facts_from(&owner);
    let diff = SchemaDiff::between(&kept, &owner);
    assert!(diff.is_empty(), "{diff:?}");
    assert_eq!(diff.not_checked, []);
    assert_eq!(diff.now_available, []);
    assert!(diff.access_changed);

    // Another login that sees everything has nothing to report at all.
    let view_definition = inspect_as(&server, VIEW_DEFINITION, DATABASE).await;
    assert!(SchemaDiff::between(&owner, &view_definition).is_up_to_date());
}

#[tokio::test]
async fn a_1_0_project_refreshed_with_the_same_login_changes_nothing() {
    let Some(server) = test_server() else { return };

    for login in [OWNER, READER, TWO_TABLES] {
        let read = inspect_as(&server, login, DATABASE).await;
        let upgraded = saved_by_1_0_and_reopened(&read);
        assert_eq!(upgraded.access, None, "{login}");

        let fresh = inspect_as(&server, login, DATABASE).await;
        let diff = SchemaDiff::between(&upgraded, &fresh);

        assert!(diff.is_empty(), "{login}: {diff:?}");
        assert_eq!(diff.summary.total(), 0, "{login}");
        assert_eq!(diff.not_checked, [], "{login}");
        assert!(diff.access_changed, "{login}");

        // Applying the review records exactly what this login reads.
        let refreshed = project_with(upgraded).with_refreshed_snapshot(fresh.clone());
        assert_eq!(refreshed.snapshot, fresh, "{login}");
    }

    // What 1.0 could not hold is listed as now available: the bound default, and the keys to
    // tables the login cannot see.
    let owner = inspect_as(&server, OWNER, DATABASE).await;
    let diff = SchemaDiff::between(&saved_by_1_0_and_reopened(&owner), &owner);
    assert!(diff.now_available.iter().any(|available| {
        available.object == QualifiedName::new("dbo", "Legacy")
            && available.fact
                == SnapshotFact::ColumnDefault {
                    column: "Amount".to_string(),
                }
    }));
    let two_tables = inspect_as(&server, TWO_TABLES, DATABASE).await;
    let diff = SchemaDiff::between(&saved_by_1_0_and_reopened(&two_tables), &two_tables);
    let keys: Vec<&SnapshotFact> = diff
        .now_available
        .iter()
        .map(|available| &available.fact)
        .filter(|fact| matches!(fact, SnapshotFact::ForeignKey { .. }))
        .collect();
    assert_eq!(keys.len(), 2, "{diff:?}");
}

#[tokio::test]
async fn nothing_visible_is_reported_as_such() {
    let Some(server) = test_server() else { return };

    let description = describe(&server, CONNECT_ONLY, DATABASE).await;
    assert_eq!(description.access.level, AccessLevel::NothingVisible);
    assert_eq!(description.access.probe.explicit_denials, Some(0));
    assert!(!description.access.probe.sees_objects);

    let snapshot = inspect_as(&server, CONNECT_ONLY, DATABASE).await;
    assert_eq!(snapshot.tables, []);
    assert_eq!(snapshot.views, []);
    assert_eq!(
        snapshot.access.as_ref().map(|profile| profile.level),
        Some(AccessLevel::NothingVisible)
    );
}

#[tokio::test]
async fn an_empty_database_is_neutral() {
    let Some(server) = test_server() else { return };
    seed(&server).await;

    // The fixture's db_owner and the server administrator who seeded it.
    for identity in [as_login(&server, OWNER, &PASSWORD), server.clone()] {
        let login = identity.user.clone();
        let description = inspector(settings(&identity, Some(EMPTY_DATABASE)))
            .describe_database()
            .await
            .unwrap_or_else(|error| panic!("{login} describes the empty database: {error}"));
        assert_eq!(description.schemas, Vec::<String>::new(), "{login}");
        assert_eq!(description.access.level, AccessLevel::Empty, "{login}");
        assert_eq!(
            description.access.coverage.objects,
            Completeness::Complete,
            "{login}"
        );
    }

    let snapshot = inspect_as(&server, OWNER, EMPTY_DATABASE).await;
    assert_eq!(snapshot.tables, []);
    assert_eq!(
        snapshot.access.as_ref().map(|profile| profile.level),
        Some(AccessLevel::Empty)
    );

    // Without VIEW DEFINITION a login cannot tell an empty database from a hidden one.
    let reader = describe(&server, READER, EMPTY_DATABASE).await;
    assert_eq!(reader.access.level, AccessLevel::NothingVisible);
}

/// What the capability probe must count in the fixture for one login.
struct ProbeExpected {
    identity: TestServer,
    /// `access.view_definition`.
    view_definition: i64,
    /// `objects.P`, `objects.FN`, `objects.IF` and `objects.TR`.
    code_objects: [i64; 4],
    /// Readable module texts over every kind.
    readable: i64,
    /// Module texts of visible modules that the login cannot read.
    not_visible: i64,
}

#[tokio::test]
async fn the_capability_probe_returns_counts_only_for_every_login() {
    let Some(server) = test_server() else { return };
    seed(&server).await;
    let login = |name: &str| as_login(&server, name, &PASSWORD);
    let expectations = [
        // The server administrator, who enters as dbo, and the database owner see everything:
        // three procedures, one of them encrypted, a scalar and an inline function and the
        // triggers on sales.Orders and on the view sales.OrderSummary.
        ProbeExpected {
            identity: server.clone(),
            view_definition: 1,
            code_objects: [3, 1, 1, 2],
            readable: 7,
            not_visible: 0,
        },
        ProbeExpected {
            identity: login(OWNER),
            view_definition: 1,
            code_objects: [3, 1, 1, 2],
            readable: 7,
            not_visible: 0,
        },
        // db_datareader hides procedures and scalar functions and keeps the view, the inline
        // function and the triggers visible without their texts, as the 1.1 spike recorded.
        ProbeExpected {
            identity: login(READER),
            view_definition: 0,
            code_objects: [0, 0, 1, 2],
            readable: 0,
            not_visible: 4,
        },
        ProbeExpected {
            identity: login(VIEW_DEFINITION),
            view_definition: 1,
            code_objects: [3, 1, 1, 2],
            readable: 7,
            not_visible: 0,
        },
        // VIEW DEFINITION on sales shows its procedures and every text there; dbo's procedure
        // and function stay hidden.
        ProbeExpected {
            identity: login(READER_WITH_SALES_TEXTS),
            view_definition: 0,
            code_objects: [2, 0, 1, 2],
            readable: 5,
            not_visible: 0,
        },
        ProbeExpected {
            identity: login(CONNECT_ONLY),
            view_definition: 0,
            code_objects: [0, 0, 0, 0],
            readable: 0,
            not_visible: 0,
        },
    ];

    for expected in expectations {
        let user = expected.identity.user.clone();
        let probe = run_probe(&expected.identity, DATABASE).await;
        assert_eq!(probe.errors(), [], "{user}");
        let code_objects = ["P", "FN", "IF", "TR"].map(|kind| probe.value("objects", kind));
        assert_eq!(
            (
                probe.value("access", "view_definition"),
                code_objects,
                probe.modules_total("readable"),
                probe.modules_total("not_visible"),
            ),
            (
                expected.view_definition,
                expected.code_objects,
                expected.readable,
                expected.not_visible,
            ),
            "{user}: {:?}",
            probe.rows
        );
        assert_eq!(
            probe.value("text", "modules_scanned"),
            expected.readable,
            "{user}"
        );
        // The encrypted procedure is told apart from a hidden one wherever it is visible.
        assert_eq!(
            probe.value("modules", "P.encrypted"),
            i64::from(expected.code_objects[0] > 0),
            "{user}"
        );
        // The legacy bound default dbo.LegacyZero is visible to every login, CONNECT only
        // included.
        assert_eq!(probe.value("objects", "other"), 1, "{user}");
    }
}
