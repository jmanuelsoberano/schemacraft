//! Helpers shared by the SQL Server integration test binaries: where the test server is, how to
//! connect to it as any login, and how to seed a fixture database once per run.
//!
//! The tests run only when `SCHEMACRAFT_TEST_MSSQL_HOST`, `SCHEMACRAFT_TEST_MSSQL_PORT`,
//! `SCHEMACRAFT_TEST_MSSQL_USER` and `SCHEMACRAFT_TEST_MSSQL_PASSWORD` are set; otherwise every
//! test prints a notice and passes. `scripts/dev-sqlserver.ps1` starts a suitable container.

// Each test binary uses its own subset of the helpers.
#![allow(dead_code)]

use std::collections::HashSet;
use std::sync::LazyLock;

use schemacraft_core::inspectors::sqlserver::{
    EncryptionMode, PasswordSource, SqlServerAuthentication, SqlServerConnectionSettings,
};
use schemacraft_core::inspectors::{ConnectionSettings, DatabaseInspector, create_inspector};
use secrecy::SecretString;
use tiberius::Client;
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;

/// A SQL Server instance and the login the tests use on it.
#[derive(Debug, Clone)]
pub struct TestServer {
    /// Host name or address.
    pub host: String,
    /// TCP port.
    pub port: u16,
    /// Login name.
    pub user: String,
    /// Login password.
    pub password: String,
}

/// The server named by the environment, or `None` after printing why the test is skipped.
pub fn test_server() -> Option<TestServer> {
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

/// The same server reached with another login.
pub fn as_login(server: &TestServer, login: &str, password: &str) -> TestServer {
    TestServer {
        user: login.to_string(),
        password: password.to_string(),
        ..server.clone()
    }
}

/// Connection settings for `server`, landing in `database` when one is given.
pub fn settings(server: &TestServer, database: Option<&str>) -> SqlServerConnectionSettings {
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

/// An inspector for `settings`.
pub fn inspector(settings: SqlServerConnectionSettings) -> Box<dyn DatabaseInspector> {
    create_inspector(ConnectionSettings::SqlServer(settings)).expect("settings are valid")
}

/// Splits a script on `GO` separators, the way sqlcmd does.
pub fn batches(script: &str) -> Vec<String> {
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

/// Runs `script` batch by batch with the login of `server`, failing the test on any error.
pub async fn run_script(server: &TestServer, script: &str) {
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

/// Runs `script` once per test run for `database`, before the first test that needs it.
pub async fn ensure_seeded(server: &TestServer, database: &'static str, script: &str) {
    let mut seeded = SEEDED.lock().await;
    if !seeded.contains(database) {
        run_script(server, script).await;
        seeded.insert(database);
    }
}
