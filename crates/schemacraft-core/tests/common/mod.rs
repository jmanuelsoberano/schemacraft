//! Helpers shared by the SQL Server integration test binaries: where the test server is, how to
//! connect to it as any login, how to seed a fixture database once per run, and how to run the
//! capability probe and check what it may return.
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
use tiberius::{Client, ColumnType};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

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

/// A raw connection to the test server.
pub type TestClient = Client<Compat<TcpStream>>;

/// A raw client logged in with the login of `server`, landing in `database` when one is given,
/// for statements the inspector never runs.
pub async fn connect(server: &TestServer, database: Option<&str>) -> TestClient {
    let config = settings(server, database)
        .to_tiberius_config()
        .expect("settings are valid");
    let tcp = TcpStream::connect(config.get_addr())
        .await
        .expect("TCP connection to the test server");
    tcp.set_nodelay(true).expect("nodelay");
    Client::connect(config, tcp.compat_write())
        .await
        .expect("login to the test server")
}

/// Runs `script` batch by batch with the login of `server`, failing the test on any error.
pub async fn run_script(server: &TestServer, script: &str) {
    let mut client = connect(server, None).await;
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

/// The capability probe that the README asks a database owner to run by hand.
pub const PROBE_SCRIPT: &str = include_str!("../../probes/capability-probe.sql");

/// Every `(section, metric)` pair the capability probe may return, in its order. A pair is a pair
/// of labels written in the script, so a change that would return anything else, a name above
/// all, fails the tests until it is added here, where a review sees it. Every section but `probe`
/// can report the number of an error instead of its metrics.
pub const PROBE_METRICS: &[(&str, &str)] = &[
    ("probe", "version"),
    ("probe", "scan_text"),
    ("server", "product_major_version"),
    ("server", "product_minor_version"),
    ("server", "product_build"),
    ("server", "product_update_level"),
    ("server", "engine_edition"),
    ("server", "compatibility_level"),
    ("server", "case_insensitive"),
    ("server", "accent_insensitive"),
    ("server", "clr_enabled"),
    ("server", "error_number"),
    ("access", "view_definition"),
    ("access", "select"),
    ("access", "view_security_definition"),
    ("access", "db_owner"),
    ("access", "denials"),
    ("access", "execute_denials"),
    ("access", "schemas"),
    ("access", "schemas_with_view_definition"),
    ("access", "schemas_with_select"),
    ("access", "schemas_denied"),
    ("access", "code_only_schemas"),
    ("access", "expression_dependencies_select"),
    ("access", "error_number"),
    ("objects", "U"),
    ("objects", "V"),
    ("objects", "P"),
    ("objects", "PC"),
    ("objects", "FN"),
    ("objects", "FS"),
    ("objects", "IF"),
    ("objects", "TF"),
    ("objects", "FT"),
    ("objects", "AF"),
    ("objects", "TR"),
    ("objects", "TA"),
    ("objects", "SN"),
    ("objects", "SO"),
    ("objects", "TT"),
    ("objects", "other"),
    ("objects", "ddl_triggers"),
    ("objects", "memory_optimized_tables"),
    ("objects", "partitioned_tables"),
    ("objects", "error_number"),
    ("modules", "V.modules"),
    ("modules", "V.readable"),
    ("modules", "V.encrypted"),
    ("modules", "V.not_visible"),
    ("modules", "V.bytes_total"),
    ("modules", "V.bytes_max"),
    ("modules", "V.over_128kb"),
    ("modules", "V.over_256kb"),
    ("modules", "V.with_cr"),
    ("modules", "V.with_trailing_space"),
    ("modules", "P.modules"),
    ("modules", "P.readable"),
    ("modules", "P.encrypted"),
    ("modules", "P.not_visible"),
    ("modules", "P.bytes_total"),
    ("modules", "P.bytes_max"),
    ("modules", "P.over_128kb"),
    ("modules", "P.over_256kb"),
    ("modules", "P.with_cr"),
    ("modules", "P.with_trailing_space"),
    ("modules", "FN.modules"),
    ("modules", "FN.readable"),
    ("modules", "FN.encrypted"),
    ("modules", "FN.not_visible"),
    ("modules", "FN.bytes_total"),
    ("modules", "FN.bytes_max"),
    ("modules", "FN.over_128kb"),
    ("modules", "FN.over_256kb"),
    ("modules", "FN.with_cr"),
    ("modules", "FN.with_trailing_space"),
    ("modules", "IF.modules"),
    ("modules", "IF.readable"),
    ("modules", "IF.encrypted"),
    ("modules", "IF.not_visible"),
    ("modules", "IF.bytes_total"),
    ("modules", "IF.bytes_max"),
    ("modules", "IF.over_128kb"),
    ("modules", "IF.over_256kb"),
    ("modules", "IF.with_cr"),
    ("modules", "IF.with_trailing_space"),
    ("modules", "TF.modules"),
    ("modules", "TF.readable"),
    ("modules", "TF.encrypted"),
    ("modules", "TF.not_visible"),
    ("modules", "TF.bytes_total"),
    ("modules", "TF.bytes_max"),
    ("modules", "TF.over_128kb"),
    ("modules", "TF.over_256kb"),
    ("modules", "TF.with_cr"),
    ("modules", "TF.with_trailing_space"),
    ("modules", "TR.modules"),
    ("modules", "TR.readable"),
    ("modules", "TR.encrypted"),
    ("modules", "TR.not_visible"),
    ("modules", "TR.bytes_total"),
    ("modules", "TR.bytes_max"),
    ("modules", "TR.over_128kb"),
    ("modules", "TR.over_256kb"),
    ("modules", "TR.with_cr"),
    ("modules", "TR.with_trailing_space"),
    ("modules", "error_number"),
    ("text", "modules_scanned"),
    ("text", "password_words"),
    ("text", "password_assignments"),
    ("text", "openrowset_or_opendatasource"),
    ("text", "sp_addlinkedsrvlogin"),
    ("text", "sp_executesql"),
    ("text", "exec_string"),
    ("text", "elapsed_ms"),
    ("text", "error_number"),
    ("triggers", "dml_on_tables"),
    ("triggers", "dml_on_views"),
    ("triggers", "instead_of"),
    ("triggers", "disabled"),
    ("triggers", "not_for_replication"),
    ("triggers", "clr"),
    ("triggers", "objects_with_first"),
    ("triggers", "objects_with_last"),
    ("triggers", "objects_with_triggers"),
    ("triggers", "max_per_object"),
    ("triggers", "objects_mixing_states"),
    ("triggers", "tables_with_several_after_per_event"),
    ("triggers", "error_number"),
    ("views", "with_check_option"),
    ("views", "indexed"),
    ("views", "error_number"),
    ("routines", "parameters"),
    ("routines", "max_parameters_per_routine"),
    ("routines", "output_parameters"),
    ("routines", "readonly_parameters"),
    ("routines", "user_type_parameters"),
    ("routines", "scalar_returns"),
    ("routines", "table_function_columns"),
    ("routines", "max_routines_per_schema"),
    ("routines", "error_number"),
    ("indexes", "heap"),
    ("indexes", "clustered"),
    ("indexes", "nonclustered"),
    ("indexes", "xml"),
    ("indexes", "spatial"),
    ("indexes", "clustered_columnstore"),
    ("indexes", "nonclustered_columnstore"),
    ("indexes", "nonclustered_hash"),
    ("indexes", "json"),
    ("indexes", "disabled"),
    ("indexes", "disabled_clustered_primary_keys"),
    ("indexes", "disabled_nonclustered_primary_keys"),
    ("indexes", "disabled_unique_constraints"),
    ("indexes", "disabled_unique_indexes"),
    ("indexes", "filtered"),
    ("indexes", "filtered_unique"),
    ("indexes", "with_included_columns"),
    ("indexes", "with_implicit_partition_column"),
    ("indexes", "unique_on_foreign_key_disabled_or_filtered"),
    ("indexes", "error_number"),
    ("constraints", "checks"),
    ("constraints", "checks_disabled"),
    ("constraints", "checks_untrusted"),
    ("constraints", "checks_not_for_replication"),
    ("constraints", "foreign_keys"),
    ("constraints", "foreign_keys_disabled"),
    ("constraints", "foreign_keys_untrusted"),
    ("constraints", "foreign_keys_not_for_replication"),
    ("constraints", "error_number"),
    ("columns", "computed"),
    ("columns", "computed_persisted"),
    ("columns", "error_number"),
    ("properties", "ms_description_tables"),
    ("properties", "ms_description_views"),
    ("properties", "ms_description_columns"),
    ("properties", "other_properties"),
    ("properties", "other_property_names"),
    ("properties", "error_number"),
    ("timings", "code_objects_ms"),
    ("timings", "triggers_ms"),
    ("timings", "parameters_ms"),
    ("timings", "module_texts_ms"),
    ("timings", "probe_ms"),
    ("timings", "error_number"),
];

/// What one run of the capability probe returned.
#[derive(Debug)]
pub struct ProbeOutput {
    /// `(section, metric, value)` rows in the order the probe returned them.
    pub rows: Vec<(String, String, i64)>,
}

impl ProbeOutput {
    /// The value of one metric; fails the test when the probe did not return it.
    pub fn value(&self, section: &str, metric: &str) -> i64 {
        self.rows
            .iter()
            .find(|(found_section, found_metric, _)| {
                found_section == section && found_metric == metric
            })
            .map_or_else(
                || panic!("the probe returned no {section}.{metric}: {:?}", self.rows),
                |(_, _, value)| *value,
            )
    }

    /// The sum of one measure over the module kinds, such as every `<kind>.readable`.
    pub fn modules_total(&self, measure: &str) -> i64 {
        let suffix = format!(".{measure}");
        self.rows
            .iter()
            .filter(|(section, metric, _)| section == "modules" && metric.ends_with(&suffix))
            .map(|(_, _, value)| value)
            .sum()
    }

    /// The sections whose `CATCH` ran, with the number of the error each one reported.
    pub fn errors(&self) -> Vec<(String, i64)> {
        self.rows
            .iter()
            .filter(|(_, metric, _)| metric == "error_number")
            .map(|(section, _, value)| (section.clone(), *value))
            .collect()
    }
}

/// Runs the capability probe as one batch with the login of `server` in `database`, as SSMS
/// sends it, and checks its output contract: one result set with the columns
/// `section` and `metric` (nvarchar) and `value` (bigint, never NULL), every pair in
/// [`PROBE_METRICS`] and none twice, and every listed metric present unless its section reported
/// an error. Whether a section failed is left to the caller.
pub async fn run_probe(server: &TestServer, database: &str) -> ProbeOutput {
    run_probe_script(server, database, PROBE_SCRIPT).await
}

/// [`run_probe`] with an edited copy of the script, such as one with the text scan turned off.
pub async fn run_probe_script(server: &TestServer, database: &str, script: &str) -> ProbeOutput {
    let run = format!("the probe as {} on {database}", server.user);
    let mut client = connect(server, Some(database)).await;
    let result_sets = client
        .simple_query(script)
        .await
        .unwrap_or_else(|error| panic!("{run}: {error}"))
        .into_results()
        .await
        .unwrap_or_else(|error| panic!("{run}: {error}"));
    assert_eq!(result_sets.len(), 1, "{run} returns one result set");
    let rows = &result_sets[0];
    let first = rows
        .first()
        .unwrap_or_else(|| panic!("{run} returned no row"));
    let columns: Vec<(&str, ColumnType)> = first
        .columns()
        .iter()
        .map(|column| (column.name(), column.column_type()))
        .collect();
    assert_eq!(
        columns,
        [
            ("section", ColumnType::NVarchar),
            ("metric", ColumnType::NVarchar),
            ("value", ColumnType::Int8),
        ],
        "{run}"
    );

    let output = ProbeOutput {
        rows: rows
            .iter()
            .map(|row| {
                let text = |index: usize| {
                    row.get::<&str, _>(index)
                        .unwrap_or_else(|| panic!("{run}: a NULL label"))
                        .to_string()
                };
                let value = row
                    .try_get::<i64, _>(2)
                    .unwrap_or_else(|error| panic!("{run}: {error}"))
                    .unwrap_or_else(|| panic!("{run}: a NULL value"));
                (text(0), text(1), value)
            })
            .collect(),
    };

    let unexpected: Vec<String> = output
        .rows
        .iter()
        .filter(|(section, metric, _)| {
            !PROBE_METRICS.contains(&(section.as_str(), metric.as_str()))
        })
        .map(|(section, metric, _)| format!("{section}.{metric}"))
        .collect();
    assert_eq!(
        unexpected,
        Vec::<String>::new(),
        "{run} returned pairs outside PROBE_METRICS"
    );

    let mut seen = HashSet::new();
    for (section, metric, _) in &output.rows {
        assert!(
            seen.insert((section.as_str(), metric.as_str())),
            "{run} returned {section}.{metric} twice"
        );
    }

    let failed: HashSet<String> = output
        .errors()
        .into_iter()
        .map(|(section, _)| section)
        .collect();
    let skipped_text = output.value("probe", "scan_text") == 0;
    let missing: Vec<String> = PROBE_METRICS
        .iter()
        .filter(|&&(section, metric)| {
            let left_out = failed.contains(section) || (skipped_text && section == "text");
            metric != "error_number" && !left_out && !seen.contains(&(section, metric))
        })
        .map(|(section, metric)| format!("{section}.{metric}"))
        .collect();
    assert_eq!(
        missing,
        Vec::<String>::new(),
        "{run} left out metrics of PROBE_METRICS"
    );
    output
}
