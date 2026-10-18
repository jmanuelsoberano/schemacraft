//! The diagnostic log against a real server (ADR-041). What an inspection, a rejected login, an
//! unavailable database and a denied catalog query put on the diagnostics target holds counts,
//! timings, kinds and error numbers only: no name of the fixture, no login, no host, no password
//! and no database. `tests/common` says when the tests run.
//!
//! They read `SchemaCraftPermissions` as `sa` and as the `db_datareader` login of
//! `permission_logins.sql`, and as a login of `diagnostics_logins.sql` that may not read
//! `sys.check_constraints`. A failure is recorded as the host records it, through
//! `command_failed` with the error's `log_summary`. Every test captures what its own thread
//! emits on the target, at every level and in the default format, which is more than the log
//! file writes, so the tests run in parallel without sharing a capture. The capture filter hides
//! the spans of every other target, so no span context is captured;
//! `the_file_format_writes_no_span_context` in `src-tauri/src/logging.rs` keeps it out of the
//! file.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::print_stderr
)]

mod common;

use std::collections::BTreeSet;
use std::hash::{BuildHasher, RandomState};
use std::io;
use std::sync::{Arc, LazyLock, Mutex, PoisonError};

use schemacraft_core::diagnostics;
use schemacraft_core::inspectors::{
    InspectionOptions, InspectorError, InspectorErrorKind, SilentProgress,
};
use schemacraft_core::model::SchemaSnapshot;
use serde_json::Value;
use tokio_util::sync::CancellationToken;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::{Layer, filter};

use self::common::{
    TestServer, as_login, check_expected_major_version, ensure_seeded, inspector, settings,
    test_server,
};

const DATABASE: &str = "SchemaCraftPermissions";
const EMPTY_DATABASE: &str = "SchemaCraftPermissionsEmpty";
const DATABASE_SCRIPT: &str = include_str!("fixtures/sqlserver/permissions.sql");
const LOGINS_SCRIPT: &str = include_str!("fixtures/sqlserver/permission_logins.sql");
const DIAGNOSTICS_LOGINS_SCRIPT: &str = include_str!("fixtures/sqlserver/diagnostics_logins.sql");

/// Every table and view, no text.
const READER: &str = "schemacraft_reader";
/// No user in the empty database, so it cannot open it.
const CONNECT_ONLY: &str = "schemacraft_connect";
/// A reader that may not read `sys.check_constraints`.
const NO_CHECKS: &str = "schemacraft_no_checks";

/// Fragments of the server's messages for the failures below, which name the login, the
/// database and the catalog view.
const MESSAGE_FRAGMENTS: &[&str] = &[
    "Login failed",
    "Cannot open database",
    "permission was denied",
    "mssqlsystemresource",
    "check_constraints",
];

/// Password of the logins of the run, made up as `sqlserver_permissions.rs` makes up its own.
static PASSWORD: LazyLock<String> = LazyLock::new(|| {
    let random = || RandomState::new().hash_one(std::process::id());
    format!("Sc!{:016x}{:016x}", random(), random())
});

/// Creates the databases and the logins, once per run.
async fn seed(server: &TestServer) {
    let script = format!("{DATABASE_SCRIPT}\nGO\n{LOGINS_SCRIPT}\nGO\n{DIAGNOSTICS_LOGINS_SCRIPT}")
        .replace("$(PASSWORD)", &PASSWORD);
    ensure_seeded(server, DATABASE, &script).await;
}

async fn inspect_as(
    identity: &TestServer,
    database: &str,
) -> Result<SchemaSnapshot, InspectorError> {
    inspector(settings(identity, Some(database)))
        .inspect(
            &InspectionOptions::default(),
            &SilentProgress,
            CancellationToken::new(),
        )
        .await
}

/// A writer that keeps what the capture layer writes.
#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl Capture {
    fn text(&self) -> String {
        String::from_utf8(
            self.0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone(),
        )
        .unwrap()
    }
}

impl io::Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Starts capturing every event on the diagnostics target that this thread emits, at every
/// level, with the default format. Its filter also hides the spans of every other target, so no
/// span context is captured. The capture lasts as long as the guard; `#[tokio::test]` polls
/// everything on the test's thread.
fn capture() -> (Capture, tracing::subscriber::DefaultGuard) {
    let capture = Capture::default();
    let writer = capture.clone();
    let layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .with_filter(filter::filter_fn(|metadata| {
            metadata.target() == diagnostics::TARGET
        }));
    let guard = tracing::subscriber::set_default(tracing_subscriber::registry().with(layer));
    (capture, guard)
}

/// The identifiers and texts of a snapshot: schema, object, column, key, index and constraint
/// names, the database and its user, and every readable expression.
fn snapshot_names(snapshot: &SchemaSnapshot) -> BTreeSet<String> {
    const KEYS: &[&str] = &[
        "schema",
        "name",
        "columns",
        "referencingColumn",
        "referencedColumn",
        "databaseName",
        "databaseUser",
        "text",
    ];
    fn walk(value: &Value, key: Option<&str>, found: &mut BTreeSet<String>) {
        match value {
            Value::String(text) if key.is_some_and(|key| KEYS.contains(&key)) => {
                found.insert(text.clone());
            }
            Value::Array(items) => items.iter().for_each(|item| walk(item, key, found)),
            Value::Object(fields) => fields
                .iter()
                .for_each(|(name, item)| walk(item, Some(name), found)),
            _ => {}
        }
    }
    let mut found = BTreeSet::new();
    walk(&serde_json::to_value(snapshot).unwrap(), None, &mut found);
    found
}

/// Everything the log must never hold: the names and texts of the fixture as `sa` reads it, the
/// server's own name, the logins, the host, the passwords, the databases and the fragments of
/// the server's messages.
async fn forbidden(server: &TestServer) -> BTreeSet<String> {
    static SA_SNAPSHOT: tokio::sync::OnceCell<(SchemaSnapshot, String)> =
        tokio::sync::OnceCell::const_new();
    let (snapshot, server_name) = SA_SNAPSHOT
        .get_or_init(|| async {
            seed(server).await;
            let snapshot = inspect_as(server, DATABASE).await.unwrap();
            let information = inspector(settings(server, None))
                .test_connection()
                .await
                .unwrap();
            (snapshot, information.server_name)
        })
        .await;

    let mut words = snapshot_names(snapshot);
    assert!(
        words.contains("Customers") && words.contains("CK_Orders_Status"),
        "the fixture was not read: {words:?}"
    );
    words.extend(
        [
            server_name.as_str(),
            server.host.as_str(),
            server.user.as_str(),
            server.password.as_str(),
            PASSWORD.as_str(),
            READER,
            CONNECT_ONLY,
            NO_CHECKS,
            DATABASE,
            EMPTY_DATABASE,
        ]
        .map(str::to_string),
    );
    words.extend(
        MESSAGE_FRAGMENTS
            .iter()
            .map(|fragment| (*fragment).to_string()),
    );
    // A text without a letter, such as the bound default `0`, names nothing, and it would match
    // every count.
    words.retain(|word| word.chars().any(char::is_alphabetic));
    words
}

/// The forbidden words the captured text holds. An identifier counts as a whole word, ignoring
/// case, so a table called `Orders` does not trip on `orders_count`; anything else, a password,
/// an expression or a message, counts wherever it appears.
fn leaks(text: &str, forbidden: &BTreeSet<String>) -> Vec<String> {
    let lower = text.to_lowercase();
    let words: BTreeSet<&str> = lower
        .split(|character: char| !(character.is_alphanumeric() || character == '_'))
        .filter(|word| !word.is_empty())
        .collect();
    forbidden
        .iter()
        .filter(|candidate| {
            let candidate = candidate.to_lowercase();
            if candidate
                .chars()
                .all(|character| character.is_alphanumeric() || character == '_')
            {
                words.contains(candidate.as_str())
            } else {
                lower.contains(&candidate)
            }
        })
        .cloned()
        .collect()
}

fn assert_no_leak(text: &str, forbidden: &BTreeSet<String>) {
    assert!(!text.trim().is_empty(), "nothing was captured");
    let leaks = leaks(text, forbidden);
    assert!(leaks.is_empty(), "the log holds {leaks:?}:\n{text}");
}

/// The lines of `text` that come from the event whose message is `message`.
fn lines_of<'a>(text: &'a str, message: &str) -> Vec<&'a str> {
    let needle = format!("{}: {message}", diagnostics::TARGET);
    text.lines().filter(|line| line.contains(&needle)).collect()
}

#[tokio::test]
async fn connects_to_the_expected_major_version() {
    let Some(server) = test_server() else { return };
    check_expected_major_version(&server).await;
}

#[tokio::test]
async fn an_inspection_as_sa_logs_counts_and_timings_only() {
    let Some(server) = test_server() else { return };
    let forbidden = forbidden(&server).await;

    let (capture, guard) = capture();
    let snapshot = inspect_as(&server, DATABASE).await.unwrap();
    drop(guard);
    let text = capture.text();
    eprintln!("{text}");

    assert_no_leak(&text, &forbidden);
    let completed = lines_of(&text, "inspection completed");
    assert_eq!(completed.len(), 1, "{text}");
    assert!(
        completed[0].contains(&format!(" tables={} ", snapshot.tables.len())),
        "{text}"
    );
    assert!(completed[0].contains(" access=Full "), "{text}");
    let queries = lines_of(&text, "catalog query");
    for query in [
        "access probe",
        "objects",
        "columns",
        "indexes",
        "check constraints",
    ] {
        assert!(
            queries
                .iter()
                .any(|line| line.contains(&format!("query=\"{query}\""))),
            "no line for {query}:\n{text}"
        );
    }
}

#[tokio::test]
async fn an_inspection_as_a_reader_logs_counts_and_timings_only() {
    let Some(server) = test_server() else { return };
    let forbidden = forbidden(&server).await;

    let (capture, guard) = capture();
    let snapshot = inspect_as(&as_login(&server, READER, &PASSWORD), DATABASE)
        .await
        .unwrap();
    drop(guard);
    let text = capture.text();
    eprintln!("{text}");

    assert_no_leak(&text, &forbidden);
    let completed = lines_of(&text, "inspection completed");
    assert_eq!(completed.len(), 1, "{text}");
    assert!(
        completed[0].contains(&format!(" tables={} ", snapshot.tables.len())),
        "{text}"
    );
    assert!(completed[0].contains(" access=Partial "), "{text}");
}

/// Runs a failing inspection as `identity`, records its failure as the host would, and returns
/// what was captured with the error.
async fn failed_inspection(identity: &TestServer, database: &str) -> (String, InspectorError) {
    let (capture, guard) = capture();
    let error = inspect_as(identity, database).await.unwrap_err();
    diagnostics::command_failed("inspect_database", &error.log_summary());
    drop(guard);
    let text = capture.text();
    eprintln!("{text}");
    (text, error)
}

#[tokio::test]
async fn a_wrong_password_logs_its_kind_and_number_only() {
    let Some(server) = test_server() else { return };
    let forbidden = forbidden(&server).await;
    let wrong = as_login(&server, READER, "Sc!definitely-not-the-password");

    let (text, error) = failed_inspection(&wrong, DATABASE).await;

    assert_eq!(error.kind(), InspectorErrorKind::AuthenticationFailed);
    // The error itself names the login, which is why it never reaches the log.
    assert!(error.to_string().contains(READER), "{error}");
    let mut forbidden = forbidden;
    forbidden.insert("definitely-not-the-password".to_string());
    assert_no_leak(&text, &forbidden);
    let failed = lines_of(&text, "command failed");
    assert_eq!(failed.len(), 1, "{text}");
    assert!(failed[0].contains("kind=AuthenticationFailed"), "{text}");
    assert!(failed[0].contains("sql_error=18456"), "{text}");
}

#[tokio::test]
async fn an_unavailable_database_logs_its_kind_and_number_only() {
    let Some(server) = test_server() else { return };
    let forbidden = forbidden(&server).await;

    let (text, error) =
        failed_inspection(&as_login(&server, CONNECT_ONLY, &PASSWORD), EMPTY_DATABASE).await;

    assert_eq!(error.kind(), InspectorErrorKind::DatabaseUnavailable);
    assert!(error.to_string().contains(EMPTY_DATABASE), "{error}");
    assert_no_leak(&text, &forbidden);
    let failed = lines_of(&text, "command failed");
    assert_eq!(failed.len(), 1, "{text}");
    assert!(failed[0].contains("kind=DatabaseUnavailable"), "{text}");
    assert!(failed[0].contains("sql_error=4060"), "{text}");
}

#[tokio::test]
async fn a_denied_catalog_query_logs_its_kind_number_and_query_only() {
    let Some(server) = test_server() else { return };
    let forbidden = forbidden(&server).await;

    let (text, error) = failed_inspection(&as_login(&server, NO_CHECKS, &PASSWORD), DATABASE).await;

    assert_eq!(error.kind(), InspectorErrorKind::QueryFailed);
    assert!(error.to_string().contains("check_constraints"), "{error}");
    assert_no_leak(&text, &forbidden);
    let failed = lines_of(&text, "command failed");
    assert_eq!(failed.len(), 1, "{text}");
    assert!(failed[0].contains("kind=QueryFailed"), "{text}");
    assert!(failed[0].contains("sql_error=229"), "{text}");
    assert!(failed[0].contains(r#"query="check constraints""#), "{text}");
}

#[test]
fn a_leak_is_found_as_a_whole_word_or_anywhere_for_other_text() {
    let forbidden: BTreeSet<String> = ["Orders", "Sc!secret", "(len([Name])>(0))"]
        .map(str::to_string)
        .into();
    assert_eq!(
        leaks("rows=3 orders_count=2", &forbidden),
        Vec::<String>::new()
    );
    assert_eq!(leaks("table=ORDERS", &forbidden), ["Orders"]);
    assert_eq!(leaks("x=prefixSc!secretsuffix", &forbidden), ["Sc!secret"]);
    assert_eq!(
        leaks("expr=(len([Name])>(0))", &forbidden),
        ["(len([Name])>(0))"]
    );
}
