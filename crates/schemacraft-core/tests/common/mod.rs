//! Helpers shared by the SQL Server integration test binaries: where the test server is, how to
//! connect to it as any login, how to seed a fixture database once per run, and how to run the
//! capability probe and check what it may return.
//!
//! The tests run only when `SCHEMACRAFT_TEST_MSSQL_HOST`, `SCHEMACRAFT_TEST_MSSQL_PORT`,
//! `SCHEMACRAFT_TEST_MSSQL_USER` and `SCHEMACRAFT_TEST_MSSQL_PASSWORD` are set; otherwise every
//! test prints a notice and passes, unless `SCHEMACRAFT_TEST_REQUIRE_SERVER` is set to anything
//! but `0`, as CI does, which makes every one of them fail instead.
//! `SCHEMACRAFT_TEST_MSSQL_MAJOR` names the major version the server must report, 15 for SQL
//! Server 2019 and 16 for 2022, and is required when a server is. `scripts/dev-sqlserver.ps1`
//! starts a suitable container of either version and prints these variables.

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

/// Set by CI, so a job whose server variables went missing fails instead of passing without
/// having tested anything.
const REQUIRE_SERVER: &str = "SCHEMACRAFT_TEST_REQUIRE_SERVER";
/// The major version the server must report.
const EXPECTED_MAJOR_VERSION: &str = "SCHEMACRAFT_TEST_MSSQL_MAJOR";

fn variable(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

/// Whether the environment asks for a server: [`REQUIRE_SERVER`] set to anything but `0`.
fn server_is_required() -> bool {
    variable(REQUIRE_SERVER).is_some_and(|value| value != "0")
}

/// The server named by the environment, or `None` after printing why the test is skipped. Fails
/// the test instead when [`REQUIRE_SERVER`] asks for a server and any of the host, port, login,
/// password or major version is missing, and whenever the port is not a number.
pub fn test_server() -> Option<TestServer> {
    let Some(host) = variable("SCHEMACRAFT_TEST_MSSQL_HOST") else {
        assert!(
            !server_is_required(),
            "{REQUIRE_SERVER} is set, yet SCHEMACRAFT_TEST_MSSQL_HOST names no server"
        );
        eprintln!("skipping: SCHEMACRAFT_TEST_MSSQL_* variables are not set");
        return None;
    };
    let required = server_is_required();
    let port = if let Some(value) = variable("SCHEMACRAFT_TEST_MSSQL_PORT") {
        value
            .parse()
            .unwrap_or_else(|_| panic!("SCHEMACRAFT_TEST_MSSQL_PORT is not a port: {value}"))
    } else {
        assert!(
            !required,
            "{REQUIRE_SERVER} is set, yet SCHEMACRAFT_TEST_MSSQL_PORT names no port"
        );
        1433
    };
    let user = variable("SCHEMACRAFT_TEST_MSSQL_USER");
    assert!(
        !required || user.is_some(),
        "{REQUIRE_SERVER} is set, yet SCHEMACRAFT_TEST_MSSQL_USER names no login"
    );
    let password = variable("SCHEMACRAFT_TEST_MSSQL_PASSWORD");
    assert!(
        !required || password.is_some(),
        "{REQUIRE_SERVER} is set, yet SCHEMACRAFT_TEST_MSSQL_PASSWORD is not set"
    );
    if required {
        // Fails every server test, not only the version test, when the major version is missing.
        expected_major_version();
    }
    Some(TestServer {
        host,
        port,
        user: user.unwrap_or_else(|| "sa".to_string()),
        password: password.unwrap_or_default(),
    })
}

/// The major version [`EXPECTED_MAJOR_VERSION`] names, or `None` when it is not set. Fails the
/// test when it is not a number, or when it is missing although [`REQUIRE_SERVER`] asks for a
/// server, since a run that names no version could test the same server twice.
pub fn expected_major_version() -> Option<i32> {
    let Some(value) = variable(EXPECTED_MAJOR_VERSION) else {
        assert!(
            !server_is_required(),
            "{REQUIRE_SERVER} is set, yet {EXPECTED_MAJOR_VERSION} names no major version"
        );
        return None;
    };
    Some(
        value
            .parse()
            .unwrap_or_else(|_| panic!("{EXPECTED_MAJOR_VERSION} is not a number: {value}")),
    )
}

/// The version of the test server, as `SERVERPROPERTY` reports it.
#[derive(Debug, Clone)]
pub struct ServerVersion {
    /// `ProductMajorVersion`: 15 for SQL Server 2019, 16 for 2022.
    pub major: i32,
    /// `ProductVersion`, such as `16.0.4135.4`.
    pub product_version: String,
}

/// The version of the test server, read once per test binary, which talks to one server only:
/// https://learn.microsoft.com/en-us/sql/t-sql/functions/serverproperty-transact-sql
pub async fn server_version(server: &TestServer) -> ServerVersion {
    static VERSION: tokio::sync::OnceCell<ServerVersion> = tokio::sync::OnceCell::const_new();
    VERSION
        .get_or_init(|| async {
            let query = "SELECT CAST(SERVERPROPERTY('ProductMajorVersion') AS int),
                                CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128))";
            let mut client = connect(server, None).await;
            let row = client
                .simple_query(query)
                .await
                .unwrap_or_else(|error| panic!("{query}: {error}"))
                .into_row()
                .await
                .unwrap_or_else(|error| panic!("{query}: {error}"))
                .unwrap_or_else(|| panic!("{query} returned no row"));
            ServerVersion {
                major: row
                    .get::<i32, _>(0)
                    .unwrap_or_else(|| panic!("{query}: no major version")),
                product_version: row
                    .get::<&str, _>(1)
                    .unwrap_or_else(|| panic!("{query}: no product version"))
                    .to_string(),
            }
        })
        .await
        .clone()
}

/// Checks that the server is the major version [`EXPECTED_MAJOR_VERSION`] names, so a run meant
/// for one version cannot test another through a wrong port, and returns it.
pub async fn check_expected_major_version(server: &TestServer) -> ServerVersion {
    let version = server_version(server).await;
    match expected_major_version() {
        Some(expected) => assert_eq!(
            version.major, expected,
            "{}:{} runs SQL Server {}, not the major version {expected} that \
             {EXPECTED_MAJOR_VERSION} names",
            server.host, server.port, version.product_version
        ),
        None => eprintln!(
            "SQL Server {} on {}:{}; {EXPECTED_MAJOR_VERSION} would check its major version",
            version.product_version, server.host, server.port
        ),
    }
    version
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
