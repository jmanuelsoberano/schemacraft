//! Typed events for the local diagnostic log (ADR-041).
//!
//! This module is the only place that emits events on [`TARGET`], the one target the application
//! writes to its log file. Each event is a function whose parameters are integers, booleans,
//! durations, `&'static str` and closed classifications, so a name, a path, a connection detail,
//! SQL text or an error message has no way into the file: no parameter can carry one. A failure
//! is recorded through the [`ErrorSummary`] that every error enum of the core builds with
//! `log_summary()`: its kind, the SQL Server error number and the fixed name of the catalog query,
//! never its message.
//!
//! The core installs no subscriber. Without one, which is the case in tests and in the
//! capability probe, an event costs a check and nothing more.

use std::fmt;
use std::time::Duration;

use crate::model::{AccessLevel, CaptureState, NotReadReason};

/// The target of every diagnostic event, and the only one the log file accepts. The hyphen keeps
/// it apart from every module path, the target `tracing` gives an event that names none, so an
/// ordinary event can never carry it.
pub const TARGET: &str = "schemacraft-diagnostics";

/// The module path of every diagnostic event. The log file accepts an event only when it comes
/// from here as well as on [`TARGET`], so an event elsewhere that names the target, by mistake or
/// through a copy of the constant, still stays out of the file with whatever fields it records.
pub const MODULE: &str = module_path!();

/// A classification with a fixed set of values that a diagnostic event may record, such as an
/// error kind or an export format. Its `Debug` form names the value and nothing else, so only
/// fieldless enums, and enums whose variants hold nothing but such enums, implement it.
pub trait ClosedKind: fmt::Debug + Copy {}

impl ClosedKind for AccessLevel {}

/// Whether a capture read a family of code facts, as the log records it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeCapture {
    /// Permission to read this optional catalog was denied.
    PermissionDenied,
    /// The family was read.
    Read,
    /// The inspection options left it out.
    OptionOff,
    /// A query that reads it failed; the inspection went on without it.
    QueryFailed,
    /// A query that reads it ran out of time; the inspection went on without it.
    TimedOut,
    /// A state this version does not know.
    Unknown,
}

impl ClosedKind for CodeCapture {}

impl From<&CaptureState> for CodeCapture {
    fn from(state: &CaptureState) -> Self {
        match state {
            CaptureState::Read => Self::Read,
            CaptureState::NotRead { reason } => match reason {
                NotReadReason::PermissionDenied => Self::PermissionDenied,
                NotReadReason::OptionOff => Self::OptionOff,
                NotReadReason::QueryFailed => Self::QueryFailed,
                NotReadReason::TimedOut => Self::TimedOut,
                NotReadReason::Unknown => Self::Unknown,
            },
            CaptureState::Unknown => Self::Unknown,
        }
    }
}

/// A family of code facts an inspection reads in a stage of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeFamily {
    /// Procedures, functions and triggers, with their parameters and events.
    Objects,
    /// The texts of views, procedures, functions and triggers.
    Definitions,
}

impl ClosedKind for CodeFamily {}

/// What the log may say about a failure: its kind, the SQL Server error number when the server
/// sent one, and the catalog query that failed. The message, which names servers, logins,
/// databases, objects and files, stays out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ErrorSummary<K> {
    /// Which failure it was.
    pub kind: K,
    /// The number of the SQL Server error behind it, such as 18456 for a rejected login.
    pub error_number: Option<u32>,
    /// The fixed name of the catalog query that failed, such as `columns`.
    pub query: Option<&'static str>,
}

impl<K> ErrorSummary<K> {
    /// A summary that carries the kind alone.
    pub const fn of(kind: K) -> Self {
        Self {
            kind,
            error_number: None,
            query: None,
        }
    }
}

/// A version made of numbers only, such as the WebView2 runtime's `141.0.3537.71`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionNumber(Vec<u32>);

impl VersionNumber {
    /// Most parts a version may have; Windows versions have four.
    const MAX_PARTS: usize = 4;

    /// Reads a dotted version of one to four numbers; anything else is no version.
    pub fn parse(text: &str) -> Option<Self> {
        let parts = text
            .trim()
            .split('.')
            .map(|part| part.parse::<u32>().ok())
            .collect::<Option<Vec<_>>>()?;
        (!parts.is_empty() && parts.len() <= Self::MAX_PARTS).then_some(Self(parts))
    }
}

impl fmt::Display for VersionNumber {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (position, part) in self.0.iter().enumerate() {
            if position > 0 {
                formatter.write_str(".")?;
            }
            write!(formatter, "{part}")?;
        }
        Ok(())
    }
}

/// Why the application stopped before its window opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupFailure {
    /// The WebView2 runtime is not installed.
    WebView2Missing,
    /// Tauri could not build or run the application.
    CouldNotStart,
}

/// What an inspection read and how long each stage took.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InspectionCompleted {
    /// Tables in the snapshot.
    pub tables: usize,
    /// Views in the snapshot.
    pub views: usize,
    /// Foreign keys between visible tables.
    pub foreign_keys: usize,
    /// Foreign keys to tables the login cannot see.
    pub foreign_keys_to_invisible_tables: usize,
    /// The access verdict, when the access probe ran.
    pub access: Option<AccessLevel>,
    /// Whether the procedures, functions and triggers were read.
    pub code: CodeCapture,
    /// Whether the texts of the modules were read.
    pub code_texts: CodeCapture,
    /// Procedures and functions in the snapshot.
    pub routines: usize,
    /// DML triggers in the snapshot.
    pub triggers: usize,
    /// Views whose code is in the snapshot.
    pub view_modules: usize,
    /// Module texts the login could read.
    pub module_texts: usize,
    /// Module texts the login could not see.
    pub module_texts_not_visible: usize,
    /// Encrypted module texts, which the catalog returns to no login.
    pub module_texts_encrypted: usize,
    /// Opening the sessions and identifying the server.
    pub connecting: Duration,
    /// The access probe, the catalog queries and the code stages, which run together.
    pub reading: Duration,
    /// The code stages within `reading`: the procedures, functions and triggers, then their texts.
    pub reading_code: Duration,
    /// Building the snapshot from the rows.
    pub assembling: Duration,
    /// The whole inspection.
    pub total: Duration,
}

/// The application started, with the version of the WebView2 runtime it found.
pub fn app_started(version: &'static str, webview2: Option<&VersionNumber>) {
    tracing::info!(
        target: TARGET,
        version,
        webview2 = webview2.map(tracing::field::display),
        "application started"
    );
}

/// The application stopped before its window opened.
pub fn startup_failed(failure: StartupFailure) {
    tracing::error!(target: TARGET, failure = ?failure, "startup failed");
}

/// An inspection finished: the counts it read and the time of each stage.
pub fn inspection_completed(inspection: &InspectionCompleted) {
    tracing::info!(
        target: TARGET,
        tables = inspection.tables,
        views = inspection.views,
        foreign_keys = inspection.foreign_keys,
        foreign_keys_to_invisible_tables = inspection.foreign_keys_to_invisible_tables,
        access = inspection.access.map(tracing::field::debug),
        code = ?inspection.code,
        code_texts = ?inspection.code_texts,
        routines = inspection.routines,
        triggers = inspection.triggers,
        view_modules = inspection.view_modules,
        module_texts = inspection.module_texts,
        module_texts_not_visible = inspection.module_texts_not_visible,
        module_texts_encrypted = inspection.module_texts_encrypted,
        connecting_ms = milliseconds(inspection.connecting),
        reading_ms = milliseconds(inspection.reading),
        code_ms = milliseconds(inspection.reading_code),
        assembling_ms = milliseconds(inspection.assembling),
        elapsed_ms = milliseconds(inspection.total),
        "inspection completed"
    );
}

/// A catalog query finished, by its fixed name.
pub fn catalog_query(query: &'static str, rows: usize, elapsed: Duration) {
    tracing::info!(
        target: TARGET,
        query,
        rows,
        elapsed_ms = milliseconds(elapsed),
        "catalog query"
    );
}

/// Optional dependency outcome and counts only; identifiers and source cannot enter this event.
pub fn dependencies_captured(capture: CodeCapture, sources: usize, references: usize) {
    tracing::info!(target: TARGET, capture = ?capture, sources, references, "dependencies captured");
}

/// A family of code facts could not be read, by the summary of the error; the inspection went on
/// without it.
pub fn code_not_read(family: CodeFamily, failure: &ErrorSummary<impl ClosedKind>) {
    tracing::warn!(
        target: TARGET,
        family = ?family,
        kind = ?failure.kind,
        sql_error = failure.error_number,
        query = failure.query,
        "code not read"
    );
}

/// A project file was read.
pub fn project_opened(format_version: u32, is_read_only: bool, bytes: usize, elapsed: Duration) {
    tracing::info!(
        target: TARGET,
        format_version,
        is_read_only,
        kb = kilobytes(bytes),
        elapsed_ms = milliseconds(elapsed),
        "project opened"
    );
}

/// A project file was written.
pub fn project_saved(format_version: u32, bytes: usize, elapsed: Duration) {
    tracing::info!(
        target: TARGET,
        format_version,
        kb = kilobytes(bytes),
        elapsed_ms = milliseconds(elapsed),
        "project saved"
    );
}

/// An export file was written.
pub fn export_written(format: impl ClosedKind, bytes: usize, elapsed: Duration) {
    tracing::info!(
        target: TARGET,
        format = ?format,
        kb = kilobytes(bytes),
        elapsed_ms = milliseconds(elapsed),
        "export written"
    );
}

/// A command failed, by its fixed name and the summary of its error.
pub fn command_failed(command: &'static str, failure: &ErrorSummary<impl ClosedKind>) {
    tracing::warn!(
        target: TARGET,
        command,
        kind = ?failure.kind,
        sql_error = failure.error_number,
        query = failure.query,
        "command failed"
    );
}

fn milliseconds(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

/// Whole kilobytes, rounded up, so a small file is never 0.
fn kilobytes(bytes: usize) -> u64 {
    u64::try_from(bytes.div_ceil(1024)).unwrap_or(u64::MAX)
}

/// Records the events emitted while a closure runs, for the tests of the event functions and of
/// the summaries the error enums build.
#[cfg(test)]
pub(crate) mod capture {
    use std::fmt;
    use std::sync::{Arc, Mutex, PoisonError};

    use tracing::field::{Field, Visit};
    use tracing::{Event, Level, Subscriber};
    use tracing_subscriber::Layer;
    use tracing_subscriber::layer::{Context, SubscriberExt};

    /// One event as it was emitted: its target, its level and its fields in order, `message`
    /// included, each as the text a formatter would write.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) struct CapturedEvent {
        pub target: String,
        pub level: Level,
        pub fields: Vec<(String, String)>,
    }

    impl CapturedEvent {
        /// The names of the fields, `message` included.
        pub fn field_names(&self) -> Vec<&str> {
            self.fields.iter().map(|(name, _)| name.as_str()).collect()
        }

        /// The value of one field, if it was recorded.
        pub fn field(&self, name: &str) -> Option<&str> {
            self.fields
                .iter()
                .find(|(field, _)| field == name)
                .map(|(_, value)| value.as_str())
        }

        /// The whole event as one line of text.
        pub fn text(&self) -> String {
            let fields: Vec<String> = self
                .fields
                .iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect();
            format!("{} {} {}", self.target, self.level, fields.join(" "))
        }
    }

    struct Recorder(Arc<Mutex<Vec<CapturedEvent>>>);

    impl<S: Subscriber> Layer<S> for Recorder {
        fn on_event(&self, event: &Event<'_>, _context: Context<'_, S>) {
            let mut fields = Fields(Vec::new());
            event.record(&mut fields);
            self.0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push(CapturedEvent {
                    target: event.metadata().target().to_string(),
                    level: *event.metadata().level(),
                    fields: fields.0,
                });
        }
    }

    struct Fields(Vec<(String, String)>);

    impl Visit for Fields {
        fn record_str(&mut self, field: &Field, value: &str) {
            self.0.push((field.name().to_string(), value.to_string()));
        }

        fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
            self.0
                .push((field.name().to_string(), format!("{value:?}")));
        }
    }

    /// The events `work` emits on this thread.
    pub(crate) fn events_of(work: impl FnOnce()) -> Vec<CapturedEvent> {
        let events = Arc::new(Mutex::new(Vec::new()));
        let subscriber = tracing_subscriber::registry().with(Recorder(Arc::clone(&events)));
        tracing::subscriber::with_default(subscriber, work);
        events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )]

    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use tracing::Level;

    use super::capture::{CapturedEvent, events_of};
    use super::{
        CodeCapture, CodeFamily, ErrorSummary, InspectionCompleted, StartupFailure, TARGET,
        VersionNumber, app_started, catalog_query, code_not_read, command_failed, export_written,
        inspection_completed, project_opened, project_saved, startup_failed,
    };
    use crate::credentials::CredentialError;
    use crate::export::{ExportError, ExportFormat};
    use crate::inspectors::InspectorErrorKind;
    use crate::model::AccessLevel;
    use crate::preferences::PreferencesError;
    use crate::project::{ProjectError, ProjectErrorKind};

    fn only_event(work: impl FnOnce()) -> CapturedEvent {
        let mut events = events_of(work);
        assert_eq!(events.len(), 1, "{events:?}");
        let event = events.remove(0);
        assert_eq!(event.target, TARGET);
        event
    }

    #[test]
    fn each_event_records_only_its_declared_fields() {
        let webview2 = VersionNumber::parse("141.0.3537.71");
        let started = only_event(|| app_started("1.2.0", webview2.as_ref()));
        assert_eq!(started.field_names(), ["message", "version", "webview2"]);
        assert_eq!(started.field("webview2"), Some("141.0.3537.71"));
        assert_eq!(started.level, Level::INFO);

        let failed = only_event(|| startup_failed(StartupFailure::WebView2Missing));
        assert_eq!(failed.field_names(), ["message", "failure"]);
        assert_eq!(failed.field("failure"), Some("WebView2Missing"));
        assert_eq!(failed.level, Level::ERROR);

        let query = only_event(|| catalog_query("columns", 418, Duration::from_millis(31)));
        assert_eq!(
            query.field_names(),
            ["message", "query", "rows", "elapsed_ms"]
        );
        assert_eq!(query.field("query"), Some("columns"));

        let opened = only_event(|| project_opened(2, true, 1025, Duration::from_millis(8)));
        assert_eq!(
            opened.field_names(),
            [
                "message",
                "format_version",
                "is_read_only",
                "kb",
                "elapsed_ms"
            ]
        );
        assert_eq!(opened.field("kb"), Some("2"));

        let saved = only_event(|| project_saved(2, 10, Duration::from_millis(3)));
        assert_eq!(
            saved.field_names(),
            ["message", "format_version", "kb", "elapsed_ms"]
        );
        assert_eq!(saved.field("kb"), Some("1"));

        let export = only_event(|| export_written(ExportFormat::Pdf, 0, Duration::ZERO));
        assert_eq!(
            export.field_names(),
            ["message", "format", "kb", "elapsed_ms"]
        );
        assert_eq!(export.field("format"), Some("Pdf"));
        assert_eq!(export.field("kb"), Some("0"));

        let failure = ErrorSummary {
            kind: InspectorErrorKind::QueryFailed,
            error_number: Some(229),
            query: Some("check constraints"),
        };
        let command = only_event(|| command_failed("inspect_database", &failure));
        assert_eq!(
            command.field_names(),
            ["message", "command", "kind", "sql_error", "query"]
        );
        assert_eq!(command.field("kind"), Some("QueryFailed"));
        assert_eq!(command.field("sql_error"), Some("229"));
        assert_eq!(command.level, Level::WARN);
    }

    #[test]
    fn inspection_events_record_only_their_declared_fields() {
        let inspection = only_event(|| {
            inspection_completed(&InspectionCompleted {
                tables: 12,
                views: 3,
                foreign_keys: 9,
                foreign_keys_to_invisible_tables: 1,
                access: Some(AccessLevel::Partial),
                code: CodeCapture::Read,
                code_texts: CodeCapture::QueryFailed,
                routines: 14,
                triggers: 5,
                view_modules: 3,
                module_texts: 0,
                module_texts_not_visible: 0,
                module_texts_encrypted: 2,
                connecting: Duration::from_millis(40),
                reading: Duration::from_millis(250),
                reading_code: Duration::from_millis(120),
                assembling: Duration::from_millis(5),
                total: Duration::from_millis(296),
            });
        });
        assert_eq!(
            inspection.field_names(),
            [
                "message",
                "tables",
                "views",
                "foreign_keys",
                "foreign_keys_to_invisible_tables",
                "access",
                "code",
                "code_texts",
                "routines",
                "triggers",
                "view_modules",
                "module_texts",
                "module_texts_not_visible",
                "module_texts_encrypted",
                "connecting_ms",
                "reading_ms",
                "code_ms",
                "assembling_ms",
                "elapsed_ms"
            ]
        );
        assert_eq!(inspection.field("access"), Some("Partial"));
        assert_eq!(inspection.field("code"), Some("Read"));
        assert_eq!(inspection.field("code_texts"), Some("QueryFailed"));
        assert_eq!(inspection.field("reading_ms"), Some("250"));
        assert_eq!(inspection.field("code_ms"), Some("120"));

        let code = only_event(|| {
            code_not_read(
                CodeFamily::Definitions,
                &ErrorSummary {
                    kind: InspectorErrorKind::QueryFailed,
                    error_number: Some(229),
                    query: Some("module definitions"),
                },
            );
        });
        assert_eq!(
            code.field_names(),
            ["message", "family", "kind", "sql_error", "query"]
        );
        assert_eq!(code.field("family"), Some("Definitions"));
        assert_eq!(code.field("query"), Some("module definitions"));
        assert_eq!(code.level, Level::WARN);
    }

    #[test]
    fn fields_without_a_value_are_left_out() {
        let started = only_event(|| app_started("1.2.0", None));
        assert_eq!(started.field_names(), ["message", "version"]);

        let command = only_event(|| {
            command_failed(
                "cancel_inspection",
                &ErrorSummary::of(InspectorErrorKind::Cancelled),
            );
        });
        assert_eq!(command.field_names(), ["message", "command", "kind"]);
    }

    #[test]
    fn the_other_errors_log_their_kind_and_nothing_else() {
        let path = r"C:\Users\sentinel\shop.scraft".to_string();
        let details = "sentinel_login on sentinel-server".to_string();
        let logged = [
            format!(
                "{:?}",
                ProjectError::NotAProject {
                    path: path.clone(),
                    details: details.clone(),
                }
                .log_summary()
            ),
            format!(
                "{:?}",
                PreferencesError::Corrupt {
                    path: path.clone(),
                    details: details.clone(),
                }
                .log_summary()
            ),
            format!(
                "{:?}",
                ExportError::Write {
                    path: path.clone(),
                    details: details.clone(),
                }
                .log_summary()
            ),
            format!(
                "{:?}",
                CredentialError::StoreFailed { details }.log_summary()
            ),
        ];
        for summary in logged {
            assert!(!summary.contains("sentinel"), "{summary}");
        }
        assert_eq!(
            ProjectError::NotFound { path }.log_summary(),
            ErrorSummary::of(ProjectErrorKind::NotFound)
        );
    }

    #[test]
    fn a_code_capture_is_logged_by_its_state_alone() {
        use crate::model::{CaptureState, NotReadReason};

        let states = [
            (CaptureState::Read, CodeCapture::Read),
            (
                CaptureState::NotRead {
                    reason: NotReadReason::OptionOff,
                },
                CodeCapture::OptionOff,
            ),
            (
                CaptureState::NotRead {
                    reason: NotReadReason::QueryFailed,
                },
                CodeCapture::QueryFailed,
            ),
            (
                CaptureState::NotRead {
                    reason: NotReadReason::TimedOut,
                },
                CodeCapture::TimedOut,
            ),
            (
                CaptureState::NotRead {
                    reason: NotReadReason::Unknown,
                },
                CodeCapture::Unknown,
            ),
            (CaptureState::Unknown, CodeCapture::Unknown),
        ];
        for (state, logged) in states {
            assert_eq!(CodeCapture::from(&state), logged, "{state:?}");
        }
    }

    #[test]
    fn versions_are_numbers_only() {
        assert_eq!(
            VersionNumber::parse(" 141.0.3537.71 ").map(|version| version.to_string()),
            Some("141.0.3537.71".to_string())
        );
        assert_eq!(
            VersionNumber::parse("16").map(|version| version.to_string()),
            Some("16".to_string())
        );
        for text in ["", "141.0.3537.71.2", "141.0 beta", "1..2", "-1", "a.b"] {
            assert_eq!(VersionNumber::parse(text), None, "{text:?}");
        }
    }

    /// The Rust sources of the workspace, generated and build output left out.
    fn rust_sources(directory: &Path, found: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                if path.file_name().is_some_and(|name| name != "target") {
                    rust_sources(&path, found);
                }
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                found.push(path);
            }
        }
    }

    /// Whether `line` passes a diagnostics target to a `tracing` macro, as `target: TARGET` or
    /// through a path ending in it.
    fn names_the_target_in_a_macro(line: &str) -> bool {
        line.match_indices("target:").any(|(position, label)| {
            let argument: String = line[position + label.len()..]
                .trim_start()
                .chars()
                .take_while(|character| character.is_alphanumeric() || "_:".contains(*character))
                .collect();
            argument.ends_with("TARGET")
        })
    }

    #[test]
    fn only_this_module_emits_on_the_diagnostics_target() {
        let workspace = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut sources = Vec::new();
        rust_sources(&workspace.join("crates"), &mut sources);
        rust_sources(&workspace.join("src-tauri/src"), &mut sources);
        assert!(sources.len() > 50, "found only {} sources", sources.len());
        let this_module =
            fs::canonicalize(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/diagnostics.rs"))
                .unwrap();

        let mut offenders = Vec::new();
        for path in sources {
            if fs::canonicalize(&path).unwrap() == this_module {
                continue;
            }
            let text = fs::read_to_string(&path).unwrap();
            for (number, line) in text.lines().enumerate() {
                // `TARGET as ` is an import of the constant under another name.
                if line.contains(TARGET)
                    || line.contains("TARGET as ")
                    || names_the_target_in_a_macro(line)
                {
                    offenders.push(format!("{}:{}: {line}", path.display(), number + 1));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "events on the diagnostics target belong in diagnostics.rs:\n{}",
            offenders.join("\n")
        );
    }

    #[test]
    fn the_target_check_sees_constants_and_ignores_parameters() {
        assert!(names_the_target_in_a_macro(
            "tracing::info!(target: TARGET, rows, \"x\");"
        ));
        assert!(names_the_target_in_a_macro(
            "info!(target:schemacraft_core::diagnostics::TARGET, \"x\")"
        ));
        assert!(!names_the_target_in_a_macro(
            "fn is_written_to_file(target: &str, level: Level) -> bool {"
        ));
        assert!(!names_the_target_in_a_macro(
            "tracing::debug!(target: \"other\", \"x\")"
        ));
    }
}
