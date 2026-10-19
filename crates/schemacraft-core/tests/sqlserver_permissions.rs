//! Integration tests that read one fixture database as logins with different rights, so every
//! access verdict, every hidden text and every refresh rule is checked against a real server.
//! `tests/common` says when they run.
//!
//! The logins are created by `fixtures/sqlserver/permission_logins.sql` with a password made up
//! for the run, and on SQL Server 2022 and later also by `permission_logins_2022.sql`, whose login
//! needs a permission earlier versions do not have. They live at server level, use the
//! `schemacraft_` prefix and are recreated on every run.

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

use schemacraft_core::diff::{CaptureChange, CodeCounts, SchemaDiff};
use schemacraft_core::inspectors::sqlserver::EncryptionMode;
use schemacraft_core::inspectors::{DatabaseDescription, InspectionOptions, SilentProgress};
use schemacraft_core::model::{
    AccessLevel, CaptureState, CarriedPart, CodeObjectRef, Completeness, Definition, NotReadReason,
    QualifiedName, SchemaSnapshot, SnapshotFact, UnknownFields,
};
use schemacraft_core::project::{
    CanvasState, NodeState, Point, Project, ProjectContent, SavedConnection,
    SavedSqlServerAuthentication, SavedSqlServerConnection, read_project,
};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use self::common::{
    TestServer, as_login, check_expected_major_version, connect, ensure_seeded, inspector,
    run_probe, server_version, settings, test_server,
};

const DATABASE: &str = "SchemaCraftPermissions";
const EMPTY_DATABASE: &str = "SchemaCraftPermissionsEmpty";
const PUBLIC_DENY_DATABASE: &str = "SchemaCraftPermissionsPublicDeny";
const DATABASE_SCRIPT: &str = include_str!("fixtures/sqlserver/permissions.sql");
const LOGINS_SCRIPT: &str = include_str!("fixtures/sqlserver/permission_logins.sql");
const LOGINS_2022_SCRIPT: &str = include_str!("fixtures/sqlserver/permission_logins_2022.sql");

const OWNER: &str = "schemacraft_owner";
const READER: &str = "schemacraft_reader";
const VIEW_DEFINITION: &str = "schemacraft_viewdef";
const READER_WITH_SALES_TEXTS: &str = "schemacraft_sales_vd";
const TWO_TABLES: &str = "schemacraft_two_tables";
const CONNECT_ONLY: &str = "schemacraft_connect";
const VIEW_DEFINITION_DENIED_AUDIT: &str = "schemacraft_vd_deny_audit";
const READER_DENIED_AUDIT: &str = "schemacraft_reader_deny_audit";
const READER_DENIED_COLUMN: &str = "schemacraft_reader_deny_column";
const READER_WITH_EXECUTE: &str = "schemacraft_reader_exec";
const SELECT_SALES: &str = "schemacraft_select_sales";
const VIEW_DEFINITION_DENIED_EXECUTE: &str = "schemacraft_vd_deny_exec";
const EXECUTE_ONLY: &str = "schemacraft_exec_only";
const MODULES_DENIED: &str = "schemacraft_deny_modules";
/// Only on SQL Server 2022 and later: `VIEW DEFINITION` with `VIEW SECURITY DEFINITION` denied.
const VIEW_DEFINITION_DENIED_SECURITY: &str = "schemacraft_vd_deny_vsd";

/// `ProductMajorVersion` of SQL Server 2022, which added `VIEW SECURITY DEFINITION` and made it
/// part of `VIEW DEFINITION`. Before it `HAS_PERMS_BY_NAME` answers `NULL` for the permission and
/// a `DENY` of it is a syntax error:
/// https://learn.microsoft.com/en-us/sql/relational-databases/security/permissions-database-engine
const VIEW_SECURITY_DEFINITION_SINCE: i32 = 16;

/// Password of every login of the run. It is random, so none is committed, and it mixes cases,
/// digits and a symbol in case a password policy applies after all.
static PASSWORD: LazyLock<String> = LazyLock::new(|| {
    let random = || RandomState::new().hash_one(std::process::id());
    format!("Sc!{:016x}{:016x}", random(), random())
});

/// Whether the server knows `VIEW SECURITY DEFINITION`.
async fn knows_view_security_definition(server: &TestServer) -> bool {
    server_version(server).await.major >= VIEW_SECURITY_DEFINITION_SINCE
}

/// Creates the databases and every login the server's version can have, once per run.
async fn seed(server: &TestServer) {
    let mut logins = LOGINS_SCRIPT.to_string();
    if knows_view_security_definition(server).await {
        logins = format!("{logins}\nGO\n{LOGINS_2022_SCRIPT}");
    }
    let script = format!(
        "{DATABASE_SCRIPT}\nGO\n{}",
        logins.replace("$(PASSWORD)", &PASSWORD)
    );
    ensure_seeded(server, DATABASE, &script).await;
}

/// The one integer `query` returns in the fixture database, run with the login of `identity`.
async fn integer(identity: &TestServer, query: &str) -> Option<i32> {
    let mut client = connect(identity, Some(DATABASE)).await;
    client
        .simple_query(query)
        .await
        .unwrap_or_else(|error| panic!("{} runs {query}: {error}", identity.user))
        .into_row()
        .await
        .unwrap_or_else(|error| panic!("{} runs {query}: {error}", identity.user))
        .unwrap_or_else(|| panic!("{} runs {query}: no row", identity.user))
        .get::<i32, _>(0)
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

/// Removes from a saved snapshot what SchemaCraft 1.2 records and earlier versions did not: the
/// state of indexes and primary keys, and whether `CHECK` constraints and foreign keys are
/// trusted.
fn without_index_and_constraint_state(snapshot: &mut serde_json::Map<String, Value>) {
    for table in snapshot["tables"].as_array_mut().unwrap() {
        if let Some(key) = table["primaryKey"].as_object_mut() {
            key.remove("isEnabled");
        }
        for index in table["indexes"].as_array_mut().unwrap() {
            let index = index.as_object_mut().unwrap();
            for key in ["includedColumns", "isFiltered", "isEnabled"] {
                index.remove(key);
            }
        }
        for constraint in table["checkConstraints"].as_array_mut().unwrap() {
            constraint.as_object_mut().unwrap().remove("isTrusted");
        }
    }
    for list in ["foreignKeys", "foreignKeysToInvisibleTables"] {
        for key in snapshot
            .get_mut(list)
            .and_then(Value::as_array_mut)
            .into_iter()
            .flatten()
        {
            key.as_object_mut().unwrap().remove("isTrusted");
        }
    }
}

/// Removes every new code fact from the historical representation. The version-2 reader wrote
/// none of them, even when a current capture was used to construct the fixture.
fn without_code(document: &mut serde_json::Map<String, Value>) {
    let snapshot = document
        .get_mut("snapshot")
        .unwrap()
        .as_object_mut()
        .unwrap();
    snapshot.remove("programmability");
    if let Some(access) = snapshot.get_mut("access").and_then(Value::as_object_mut) {
        for (section, keys) in [
            ("coverage", vec!["programmability", "moduleDefinitions"]),
            (
                "counts",
                vec![
                    "moduleDefinitions",
                    "moduleDefinitionsNotVisible",
                    "moduleDefinitionsEncrypted",
                ],
            ),
            (
                "scope",
                vec!["includeProgrammability", "includeModuleDefinitions"],
            ),
            ("probe", vec!["executeDenials"]),
        ] {
            if let Some(fields) = access.get_mut(section).and_then(Value::as_object_mut) {
                for key in keys {
                    fields.remove(key);
                }
            }
        }
        if let Some(schemas) = access
            .get_mut("probe")
            .and_then(|probe| probe.get_mut("schemas"))
            .and_then(Value::as_array_mut)
        {
            for schema in schemas {
                let schema = schema.as_object_mut().unwrap();
                schema.remove("hasVisibleProgrammability");
                schema.remove("isExecuteDenied");
            }
        }
    }
    for key in ["includeProgrammability", "includeModuleDefinitions"] {
        document
            .get_mut("inspection")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove(key);
    }
}

fn first_capture_changes(snapshot: &SchemaSnapshot, state_count: usize) -> Vec<CaptureChange> {
    let code = snapshot.programmability.as_ref().unwrap();
    vec![
        CaptureChange::IndexAndConstraintStateRecorded { count: state_count },
        CaptureChange::ProgrammabilityRecorded {
            counts: CodeCounts::of(code),
        },
        CaptureChange::ModuleDefinitionsRecorded {
            count: code
                .module_definitions()
                .filter_map(Definition::text)
                .count(),
        },
    ]
}

/// Writes `document` to a file and opens it as this version opens a project.
fn reopened(document: &Value) -> SchemaSnapshot {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("saved-earlier.scraft");
    std::fs::write(&path, serde_json::to_vec_pretty(document).unwrap()).unwrap();
    let opened = read_project(&path).unwrap();
    assert!(!opened.is_read_only);
    opened.project.content.snapshot
}

/// The project SchemaCraft 1.1 would have saved from what `snapshot` read, opened by this
/// version: format 2, without the state of indexes, keys and constraints.
fn saved_by_1_1_and_reopened(snapshot: &SchemaSnapshot) -> SchemaSnapshot {
    let project = Project::new(
        project_with(snapshot.clone()),
        snapshot.extracted_at,
        "SchemaCraft 1.1.0",
    );
    let mut document = serde_json::to_value(&project).unwrap();
    let root = document.as_object_mut().unwrap();
    root.insert("formatVersion".to_string(), json!(2));
    without_code(root);
    without_index_and_constraint_state(root.get_mut("snapshot").unwrap().as_object_mut().unwrap());
    reopened(&document)
}

/// The project SchemaCraft 1.0 would have saved from what `snapshot` read, opened by this
/// version: 1.0 wrote format 1 without an access profile, an empty text for a `CHECK` it could
/// not read, no default whose text it could not read, no default bound with `sp_bindefault`
/// (it read `sys.default_constraints` only), no key to a table the login could not see, and
/// no state of an index, a key or a constraint but whether a key was enabled.
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
    without_code(root);
    let saved = root.get_mut("snapshot").unwrap().as_object_mut().unwrap();
    without_index_and_constraint_state(saved);
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
    reopened(&document)
}

/// How many indexes, primary keys, `CHECK` constraints and foreign keys `snapshot` holds: the
/// objects whose state a capture records.
fn objects_with_state(snapshot: &SchemaSnapshot) -> usize {
    let in_tables: usize = snapshot
        .tables
        .iter()
        .map(|table| {
            usize::from(table.primary_key.is_some())
                + table.indexes.len()
                + table.check_constraints.len()
        })
        .sum();
    in_tables + snapshot.foreign_keys.len() + snapshot.foreign_keys_to_invisible_tables.len()
}

#[tokio::test]
async fn connects_to_the_expected_major_version() {
    let Some(server) = test_server() else { return };
    let version = check_expected_major_version(&server).await;

    // The login that needs SQL Server 2022 exists exactly where the version has its permission.
    seed(&server).await;
    let persona = format!(
        "SELECT COUNT(*) FROM sys.database_principals \
         WHERE name = N'{VIEW_DEFINITION_DENIED_SECURITY}'"
    );
    assert_eq!(
        integer(&server, &persona).await,
        Some(i32::from(version.major >= VIEW_SECURITY_DEFINITION_SINCE)),
        "SQL Server {}",
        version.product_version
    );
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
async fn denials_are_unknown_only_where_view_security_definition_hides_them() {
    use AccessLevel::Partial;
    use Completeness::Complete;

    let Some(server) = test_server() else { return };
    seed(&server).await;
    let login = |name: &str| as_login(&server, name, &PASSWORD);
    let view_security_definition =
        "SELECT HAS_PERMS_BY_NAME(NULL, 'DATABASE', 'VIEW SECURITY DEFINITION')";

    if !knows_view_security_definition(&server).await {
        // The permission does not exist: HAS_PERMS_BY_NAME answers NULL for every login, the
        // administrator included, and the logins with VIEW DEFINITION still count their
        // denials, the one that hides audit included.
        for identity in [
            server.clone(),
            login(OWNER),
            login(VIEW_DEFINITION),
            login(READER),
        ] {
            assert_eq!(
                integer(&identity, view_security_definition).await,
                None,
                "{}",
                identity.user
            );
        }
        for (name, denials) in [(VIEW_DEFINITION, 0), (VIEW_DEFINITION_DENIED_AUDIT, 1)] {
            let probe = describe(&server, name, DATABASE).await.access.probe;
            assert_eq!(probe.explicit_denials, Some(denials), "{name}: {probe:?}");
        }
        return;
    }

    // VIEW DEFINITION includes the permission, and every login gets an answer.
    for (identity, expected) in [
        (server.clone(), 1),
        (login(OWNER), 1),
        (login(VIEW_DEFINITION), 1),
        (login(READER), 0),
        (login(VIEW_DEFINITION_DENIED_SECURITY), 0),
    ] {
        assert_eq!(
            integer(&identity, view_security_definition).await,
            Some(expected),
            "{}",
            identity.user
        );
    }

    // Denied it, a login sees no denial at all, not even its own, which the administrator sees.
    let denials = "SELECT COUNT(*) FROM sys.database_permissions WHERE state = 'D'";
    assert_eq!(
        integer(&login(VIEW_DEFINITION_DENIED_SECURITY), denials).await,
        Some(0)
    );
    let its_denials = format!(
        "{denials} \
         AND grantee_principal_id = DATABASE_PRINCIPAL_ID(N'{VIEW_DEFINITION_DENIED_SECURITY}')"
    );
    assert_eq!(integer(&server, &its_denials).await, Some(1));

    // So its denials are unknown and the level partial, as for the denialsUnknown persona of
    // src/features/access/testFixtures.ts, whose one cause is denials the login cannot see. The
    // users of the database are hidden from it too, its own included. USER_NAME() still gives
    // its identity, so the access report can generate a GRANT for the correct database user.
    let description = describe(&server, VIEW_DEFINITION_DENIED_SECURITY, DATABASE).await;
    assert_eq!(description.schemas, ["audit", "dbo", "sales"]);
    let access = description.access;
    assert_eq!(access.probe.explicit_denials, None, "{access:?}");
    assert!(access.probe.can_read_definitions, "{access:?}");
    assert!(!access.probe.can_read_data, "{access:?}");
    assert_eq!(
        access.probe.database_user.as_deref(),
        Some(VIEW_DEFINITION_DENIED_SECURITY),
        "{access:?}"
    );
    let schemas: Vec<(&str, bool, bool, bool, bool)> = access
        .probe
        .schemas
        .iter()
        .map(|schema| {
            (
                schema.name.as_str(),
                schema.can_read_definitions,
                schema.can_read_data,
                schema.is_denied,
                schema.has_visible_objects,
            )
        })
        .collect();
    assert_eq!(
        schemas,
        [
            ("audit", true, false, false, true),
            ("dbo", true, false, false, true),
            ("sales", true, false, false, true),
        ]
    );
    assert_eq!(
        (
            access.level,
            access.coverage.objects,
            access.coverage.definitions
        ),
        (Partial, Completeness::Partial, Complete)
    );

    // Its capture reads every object and every text, yet vouches for no absence, so a table
    // dropped later is kept as not checked rather than reported as removed.
    let snapshot = inspect_as(&server, VIEW_DEFINITION_DENIED_SECURITY, DATABASE).await;
    let owner = inspect_as(&server, OWNER, DATABASE).await;
    assert_eq!(table_names(&snapshot), table_names(&owner));
    assert_eq!(texts(&snapshot), texts(&owner));
    for schema in ["audit", "dbo", "sales"] {
        let dropped = QualifiedName::new(schema, "Dropped");
        assert!(!snapshot.vouches_for_absence_of(&dropped), "{schema}");
        assert!(owner.vouches_for_absence_of(&dropped), "{schema}");
    }
    let captured = snapshot.access.as_ref().unwrap();
    assert_eq!(captured.probe.explicit_denials, None);
    assert_eq!(
        (
            captured.level,
            captured.coverage.objects,
            captured.coverage.definitions
        ),
        (Partial, Completeness::Partial, Complete)
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
        // The keys to invisible tables 1.0 dropped are now available, not newly recorded.
        assert_eq!(
            diff.capture_changes,
            first_capture_changes(&fresh, objects_with_state(&upgraded)),
            "{login}"
        );

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
async fn a_1_1_project_refreshed_with_the_same_login_records_the_state_without_changes() {
    let Some(server) = test_server() else { return };

    for login in [OWNER, READER, TWO_TABLES] {
        let read = inspect_as(&server, login, DATABASE).await;
        let upgraded = saved_by_1_1_and_reopened(&read);
        assert!(
            upgraded
                .tables
                .iter()
                .flat_map(|table| &table.indexes)
                .all(|index| index.is_enabled.is_none()),
            "{login}"
        );

        let fresh = inspect_as(&server, login, DATABASE).await;
        let diff = SchemaDiff::between(&upgraded, &fresh);

        // Nothing changed and nothing was recorded on one side only as a change: one line says
        // that the state is recorded now, and the review offers to update the project.
        assert!(diff.is_empty(), "{login}: {diff:?}");
        assert!(!diff.has_object_changes(), "{login}");
        assert_eq!(diff.summary.total(), 0, "{login}");
        assert_eq!(diff.not_checked, [], "{login}");
        assert_eq!(diff.now_available, [], "{login}");
        assert!(!diff.access_changed, "{login}");
        assert_eq!(
            diff.capture_changes,
            first_capture_changes(&fresh, objects_with_state(&fresh)),
            "{login}"
        );
        assert!(!diff.is_up_to_date(), "{login}");

        let refreshed = project_with(upgraded).with_refreshed_snapshot(fresh.clone());
        assert_eq!(refreshed.snapshot, fresh, "{login}");
        assert!(
            SchemaDiff::between(&refreshed.snapshot, &fresh).is_up_to_date(),
            "{login}"
        );
    }

    // The owner's capture: six keys, five CHECKs, two indexes and four foreign keys.
    let owner = inspect_as(&server, OWNER, DATABASE).await;
    assert_eq!(objects_with_state(&owner), 17);
}

#[tokio::test]
async fn every_login_that_sees_a_table_reads_the_state_of_its_indexes_and_constraints() {
    let Some(server) = test_server() else { return };

    // The state lives in catalog columns VIEW DEFINITION does not guard, so a reader reads it as
    // the owner does, while the texts it cannot read stay not visible.
    for login in [OWNER, READER, TWO_TABLES] {
        let snapshot = inspect_as(&server, login, DATABASE).await;
        let index = |table: &str, name: &str| {
            snapshot
                .table(&QualifiedName::new("sales", table))
                .and_then(|table| table.indexes.iter().find(|index| index.name == name))
                .map(|index| {
                    (
                        index.included_columns.clone(),
                        index.is_filtered,
                        index.is_enabled,
                    )
                })
        };
        assert_eq!(
            index("Orders", "IX_Orders_Open"),
            Some((Some(vec![]), Some(true), Some(true))),
            "{login}"
        );
        assert_eq!(
            index("OrderLines", "IX_OrderLines_Product"),
            Some((Some(vec!["Quantity".to_string()]), Some(false), Some(false))),
            "{login}"
        );
        for table in &snapshot.tables {
            assert_eq!(
                table.primary_key.as_ref().and_then(|key| key.is_enabled),
                Some(true),
                "{login}: {}",
                table.name
            );
            for constraint in &table.check_constraints {
                let expected = Some(constraint.name != "CK_Products_Price");
                assert_eq!(
                    constraint.is_trusted, expected,
                    "{login}: {}",
                    constraint.name
                );
                assert_eq!(constraint.is_enabled, Some(true), "{login}");
            }
        }
        assert!(
            snapshot
                .foreign_keys
                .iter()
                .all(|key| key.is_trusted == Some(true)),
            "{login}"
        );
        assert!(
            snapshot
                .foreign_keys_to_invisible_tables
                .iter()
                .all(|key| key.is_trusted == Some(true)),
            "{login}"
        );
    }
    let reader = inspect_as(&server, READER, DATABASE).await;
    let price = reader
        .table(&QualifiedName::new("dbo", "Products"))
        .map(|table| table.check_constraints[0].clone())
        .expect("the reader sees dbo.Products");
    assert_eq!(price.expression, Definition::NotVisible);
    assert_eq!(price.is_trusted, Some(false));
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
    /// `access.view_security_definition` on SQL Server 2022 and later; earlier versions do not
    /// know the permission and the probe reports -1 for every login.
    view_security_definition: i64,
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
    let knows_permission = knows_view_security_definition(&server).await;
    let login = |name: &str| as_login(&server, name, &PASSWORD);
    let mut expectations = vec![
        // The server administrator, who enters as dbo, and the database owner see everything:
        // three procedures, one of them encrypted, a scalar and an inline function and the
        // triggers on sales.Orders and on the view sales.OrderSummary.
        ProbeExpected {
            identity: server.clone(),
            view_definition: 1,
            view_security_definition: 1,
            code_objects: [3, 1, 1, 2],
            readable: 7,
            not_visible: 0,
        },
        ProbeExpected {
            identity: login(OWNER),
            view_definition: 1,
            view_security_definition: 1,
            code_objects: [3, 1, 1, 2],
            readable: 7,
            not_visible: 0,
        },
        // db_datareader hides procedures and scalar functions and keeps the view, the inline
        // function and the triggers visible without their texts, as the 1.1 spike recorded.
        ProbeExpected {
            identity: login(READER),
            view_definition: 0,
            view_security_definition: 0,
            code_objects: [0, 0, 1, 2],
            readable: 0,
            not_visible: 4,
        },
        ProbeExpected {
            identity: login(VIEW_DEFINITION),
            view_definition: 1,
            view_security_definition: 1,
            code_objects: [3, 1, 1, 2],
            readable: 7,
            not_visible: 0,
        },
        // VIEW DEFINITION on sales shows its procedures and every text there; dbo's procedure
        // and function stay hidden.
        ProbeExpected {
            identity: login(READER_WITH_SALES_TEXTS),
            view_definition: 0,
            view_security_definition: 0,
            code_objects: [2, 0, 1, 2],
            readable: 5,
            not_visible: 0,
        },
        ProbeExpected {
            identity: login(CONNECT_ONLY),
            view_definition: 0,
            view_security_definition: 0,
            code_objects: [0, 0, 0, 0],
            readable: 0,
            not_visible: 0,
        },
    ];
    // Every object and text, with the permission that shows its denials denied.
    if knows_permission {
        expectations.push(ProbeExpected {
            identity: login(VIEW_DEFINITION_DENIED_SECURITY),
            view_definition: 1,
            view_security_definition: 0,
            code_objects: [3, 1, 1, 2],
            readable: 7,
            not_visible: 0,
        });
    }

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
        assert_eq!(
            probe.value("access", "view_security_definition"),
            if knows_permission {
                expected.view_security_definition
            } else {
                -1
            },
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

#[tokio::test]
async fn code_visibility_follows_engine_permissions_without_changing_the_access_level() {
    let Some(server) = test_server() else { return };
    let owner = inspect_as(&server, OWNER, DATABASE).await;
    let owner_code = owner.programmability.as_ref().unwrap();
    assert_eq!(
        CodeCounts::of(owner_code),
        CodeCounts {
            procedures: 3,
            functions: 2,
            triggers: 2,
            views: 1
        }
    );
    let all_routines = [
        "dbo.fn_Tax",
        "dbo.usp_Maintenance",
        "sales.fn_OrdersOf",
        "sales.usp_PlaceOrder",
        "sales.usp_Secret",
    ];
    for (login, expected, coverage, readable, encrypted) in [
        (OWNER, all_routines.as_slice(), Completeness::Complete, 7, 1),
        (
            VIEW_DEFINITION,
            all_routines.as_slice(),
            Completeness::Complete,
            7,
            1,
        ),
        (
            READER,
            &["sales.fn_OrdersOf"][..],
            Completeness::Partial,
            0,
            0,
        ),
        (
            READER_WITH_SALES_TEXTS,
            &[
                "sales.fn_OrdersOf",
                "sales.usp_PlaceOrder",
                "sales.usp_Secret",
            ][..],
            Completeness::Partial,
            5,
            1,
        ),
        (
            READER_WITH_EXECUTE,
            &[
                "sales.fn_OrdersOf",
                "sales.usp_PlaceOrder",
                "sales.usp_Secret",
            ][..],
            Completeness::Partial,
            0,
            1,
        ),
        (
            SELECT_SALES,
            &["sales.fn_OrdersOf"][..],
            Completeness::Partial,
            0,
            0,
        ),
    ] {
        let snapshot = inspect_as(&server, login, DATABASE).await;
        let code = snapshot.programmability.as_ref().unwrap();
        assert_eq!(
            names(code.routines.iter().map(|routine| &routine.name)),
            expected,
            "{login}"
        );
        assert_eq!(code.triggers.len(), 2, "{login}");
        assert_eq!(code.views.len(), 1, "{login}");
        assert_eq!(
            code.module_definitions()
                .filter_map(Definition::text)
                .count(),
            readable,
            "{login}"
        );
        let access = snapshot.access.as_ref().unwrap();
        assert_eq!(
            access.coverage.programmability,
            Some(coverage),
            "{login}: {access:?}"
        );
        assert_eq!(
            access.counts.module_definitions_encrypted, encrypted,
            "{login}"
        );
        let without_code = inspector(settings(
            &as_login(&server, login, &PASSWORD),
            Some(DATABASE),
        ))
        .inspect(
            &InspectionOptions {
                include_programmability: false,
                ..InspectionOptions::default()
            },
            &SilentProgress,
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(
            access.level,
            without_code.access.as_ref().unwrap().level,
            "{login}: code never changes the level"
        );
    }
    let executor = describe(&server, EXECUTE_ONLY, DATABASE).await;
    assert_eq!(executor.access.level, AccessLevel::NothingVisible);
    assert!(executor.schemas.is_empty() && executor.programmability_only_schemas.is_empty());
    let captured = inspect_as(&server, EXECUTE_ONLY, DATABASE).await;
    assert!(captured.tables.is_empty() && captured.views.is_empty());
    assert_eq!(
        captured.access.as_ref().unwrap().level,
        AccessLevel::NothingVisible
    );
}

#[tokio::test]
async fn execute_denied_with_view_definition_does_not_hide_code_on_either_engine() {
    let Some(server) = test_server() else { return };
    let owner = inspect_as(&server, OWNER, DATABASE).await;
    let denied = inspect_as(&server, VIEW_DEFINITION_DENIED_EXECUTE, DATABASE).await;
    let profile = denied.access.as_ref().unwrap();
    assert_eq!(profile.probe.execute_denials, Some(1));
    assert_eq!(profile.probe.explicit_denials, Some(0));
    assert_eq!(profile.level, AccessLevel::Full);
    assert_eq!(
        profile.coverage.programmability,
        Some(Completeness::Complete)
    );
    assert_eq!(
        profile.coverage.module_definitions,
        Some(Completeness::Complete)
    );
    assert_eq!(denied.programmability, owner.programmability);
    assert!(SchemaDiff::between(&owner, &denied).is_up_to_date());
    let identity = as_login(&server, VIEW_DEFINITION_DENIED_EXECUTE, &PASSWORD);
    assert_eq!(
        integer(
            &identity,
            "SELECT HAS_PERMS_BY_NAME('sales.usp_PlaceOrder', 'OBJECT', 'EXECUTE')"
        )
        .await,
        Some(0)
    );
    assert_eq!(integer(&identity, "SELECT COUNT(*) FROM sys.objects WHERE name = N'usp_PlaceOrder' AND schema_id = SCHEMA_ID(N'sales')").await, Some(1));
}

#[tokio::test]
async fn a_failed_module_query_keeps_tables_read_and_saved_code_unchecked() {
    let Some(server) = test_server() else { return };
    let owner = inspect_as(&server, OWNER, DATABASE).await;
    let denied = inspect_as(&server, MODULES_DENIED, DATABASE).await;
    assert_eq!(denied.tables, owner.tables);
    assert_eq!(denied.views, owner.views);
    let captured = denied.programmability.as_ref().unwrap();
    assert_eq!(captured.capture.objects, CaptureState::Read);
    assert_eq!(
        captured.capture.definitions,
        CaptureState::NotRead {
            reason: NotReadReason::QueryFailed
        }
    );
    assert_eq!(
        CodeCounts::of(captured),
        CodeCounts::of(owner.programmability.as_ref().unwrap())
    );
    let diff = SchemaDiff::between(&owner, &denied);
    assert!(diff.is_empty(), "{diff:?}");
    assert_eq!(diff.capture_changes, []);
    assert_ne!(diff.code.not_checked, []);
    assert!(diff.code.not_checked.iter().any(|carried| carried.object
        == CodeObjectRef::Routine {
            name: QualifiedName::new("sales", "usp_PlaceOrder")
        }
        && carried.part == CarriedPart::Definition));
    let kept = denied.with_unchecked_facts_from(&owner);
    let kept_code = kept.programmability.as_ref().unwrap();
    let old_code = owner.programmability.as_ref().unwrap();
    assert_eq!(kept_code.views, old_code.views);
    assert_eq!(kept_code.triggers, old_code.triggers);
    assert_eq!(kept_code.routines, old_code.routines);
    assert!(
        kept_code
            .carried_over
            .iter()
            .all(|carried| carried.read_at == owner.extracted_at)
    );
    assert_eq!(kept.clone().with_unchecked_facts_from(&owner), kept);
}
