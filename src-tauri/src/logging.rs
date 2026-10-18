//! Process-wide logging based on `tracing`: the console, and the local diagnostic log (ADR-041).
//!
//! Two layers share one registry. The console layer writes what its filter lets through, as it
//! always did; `SCHEMACRAFT_LOG` sets that filter. The file layer writes only the typed events of
//! `schemacraft_core::diagnostics`, at info and above, whatever `SCHEMACRAFT_LOG` says, through a
//! formatter that writes the time, the level and the event's own fields and no span, so neither a
//! stray event elsewhere nor a future `#[instrument]` can put a name, a path or a password in the
//! file. The files are named by their UTC date, `schemacraft.2026-10-18.log`, and at most seven
//! files are kept, the panic file among them. A file is never renamed, so two running instances
//! append to the same day's file without breaking each other's rotation. Writes are blocking, so
//! the last line is on disk before `panic = "abort"` ends the process.

use std::env;
use std::error::Error;
use std::ffi::OsStr;
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::{self, Write as _};
use std::panic;
use std::path::{Component, Path, PathBuf};

use chrono::{DateTime, SecondsFormat, Utc};
use schemacraft_core::diagnostics;
use tracing::field::{Field, Visit};
use tracing::level_filters::LevelFilter;
use tracing::{Event, Level, Subscriber};
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields, MakeWriter};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer, filter};

/// Environment variable that overrides the console filter, e.g. `SCHEMACRAFT_LOG=debug`.
const LOG_FILTER_ENVIRONMENT_VARIABLE: &str = "SCHEMACRAFT_LOG";
/// Development builds trace the application's own crates on the console.
const DEBUG_CONSOLE_FILTER: &str = "info,schemacraft=debug";
/// Release builds have no console; the filter matters only when one is attached.
const RELEASE_CONSOLE_FILTER: &str = "info";
/// The per-user folder for local application data, where WebView2 keeps its data too.
const LOCAL_APP_DATA_ENVIRONMENT_VARIABLE: &str = "LOCALAPPDATA";
/// Folder of the log files inside the application's data folder, as in Tauri's `app_log_dir`.
const LOG_FOLDER_NAME: &str = "logs";
/// Daily files are named `<prefix>.<UTC date>.<suffix>`.
const LOG_FILE_PREFIX: &str = "schemacraft";
const LOG_FILE_SUFFIX: &str = "log";
/// Files the folder keeps at most, the panic file among them. Whenever the appender is built, at
/// every launch, and at each UTC midnight, tracing-appender removes the oldest files by creation
/// time until six remain, then opens today's file, so the folder holds six or seven.
const LOG_FILES_KEPT: usize = 7;
/// The file that receives the location of a panic, next to the daily files.
const PANIC_FILE_NAME: &str = "schemacraft-panic.log";

/// Installs the global subscriber and returns the folder of the diagnostic log. When the folder
/// cannot be created, or a subscriber was already installed, the console is the only output and
/// the result is `None`; the application goes on either way.
pub fn initialize(identifier: &str) -> Option<PathBuf> {
    let configured = env::var(LOG_FILTER_ENVIRONMENT_VARIABLE).ok();
    let console = tracing_subscriber::fmt::layer()
        .with_target(false)
        .with_filter(EnvFilter::new(console_directives(
            configured.as_deref(),
            cfg!(debug_assertions),
        )));

    let directory = log_directory(
        env::var_os(LOCAL_APP_DATA_ENVIRONMENT_VARIABLE).as_deref(),
        identifier,
    );
    let (file, failure) = match directory.as_deref().map(open_log_file) {
        Some(Ok(appender)) => (Some(appender), None),
        Some(Err(error)) => (None, Some(error)),
        None => (None, None),
    };
    let is_writing_file = file.is_some();

    let installed = tracing_subscriber::registry()
        .with(console)
        .with(file.map(file_layer))
        .try_init()
        .is_ok();
    if let Some(error) = failure {
        // The console only: the message names the folder, which holds the user's name.
        tracing::warn!(%error, "the diagnostic log is off: its folder could not be opened");
    }

    let directory = directory.filter(|_| installed && is_writing_file)?;
    install_panic_hook(directory.clone());
    Some(directory)
}

/// The console filter: the value of `SCHEMACRAFT_LOG` when it is a valid filter, otherwise the
/// default of the build. Pure, so it is tested without changing the environment.
fn console_directives(configured: Option<&str>, is_debug_build: bool) -> &str {
    match configured.map(str::trim) {
        Some(value) if !value.is_empty() && EnvFilter::try_new(value).is_ok() => value,
        _ if is_debug_build => DEBUG_CONSOLE_FILTER,
        _ => RELEASE_CONSOLE_FILTER,
    }
}

/// `<local application data>\<identifier>\logs`, the folder Tauri's `app_log_dir` names on
/// Windows. `None` without an absolute data folder or with an identifier that is not one plain
/// folder name. Pure, so it is tested without changing the environment.
fn log_directory(local_app_data: Option<&OsStr>, identifier: &str) -> Option<PathBuf> {
    let base = Path::new(local_app_data?);
    let mut components = Path::new(identifier).components();
    let is_folder_name = matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(_)), None)
    );
    (base.is_absolute() && is_folder_name).then(|| base.join(identifier).join(LOG_FOLDER_NAME))
}

/// Whether an event goes to the log file: the diagnostic events, emitted by
/// `schemacraft_core::diagnostics` on its target, at info and above, and nothing else, whatever
/// the console filter says.
fn is_written_to_file(target: &str, module: Option<&str>, level: Level) -> bool {
    target == diagnostics::TARGET && module == Some(diagnostics::MODULE) && level <= Level::INFO
}

/// Creates the folder and opens today's file in it.
fn open_log_file(directory: &Path) -> Result<RollingFileAppender, Box<dyn Error + Send + Sync>> {
    fs::create_dir_all(directory)?;
    Ok(RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix(LOG_FILE_PREFIX)
        .filename_suffix(LOG_FILE_SUFFIX)
        .max_log_files(LOG_FILES_KEPT)
        .build(directory)?)
}

/// The layer that writes the diagnostic events to `writer`, one line each.
fn file_layer<S, W>(writer: W) -> impl Layer<S>
where
    S: Subscriber + for<'span> LookupSpan<'span>,
    W: for<'writer> MakeWriter<'writer> + Send + Sync + 'static,
{
    tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .event_format(DiagnosticFormat)
        .with_writer(writer)
        .with_filter(
            filter::filter_fn(|metadata| {
                is_written_to_file(metadata.target(), metadata.module_path(), *metadata.level())
            })
            .with_max_level_hint(LevelFilter::INFO),
        )
}

/// Writes one line per event: the UTC time, the level and the event's own fields, `message`
/// first. Unlike the default formatter it writes no span, no target and no thread, so a span
/// opened anywhere, such as by a future `#[instrument]` that records every argument, adds
/// nothing to the file.
struct DiagnosticFormat;

impl<S, N> FormatEvent<S, N> for DiagnosticFormat
where
    S: Subscriber + for<'span> LookupSpan<'span>,
    N: for<'writer> FormatFields<'writer> + 'static,
{
    fn format_event(
        &self,
        _context: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        write_line(&mut writer, Utc::now(), event)
    }
}

fn write_line(writer: &mut impl fmt::Write, at: DateTime<Utc>, event: &Event<'_>) -> fmt::Result {
    write!(
        writer,
        "{} {}",
        at.to_rfc3339_opts(SecondsFormat::Millis, true),
        event.metadata().level()
    )?;
    let mut fields = FieldWriter {
        writer: &mut *writer,
        result: Ok(()),
    };
    event.record(&mut fields);
    fields.result?;
    writeln!(writer)
}

/// Writes the fields of an event as ` name=value`, and its message as plain text.
struct FieldWriter<'a, W> {
    writer: &'a mut W,
    result: fmt::Result,
}

impl<W: fmt::Write> FieldWriter<'_, W> {
    fn write(&mut self, text: fmt::Arguments<'_>) {
        if self.result.is_ok() {
            self.result = self.writer.write_fmt(text);
        }
    }
}

impl<W: fmt::Write> Visit for FieldWriter<'_, W> {
    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.write(format_args!(" {value}"));
        } else {
            self.write(format_args!(" {}={value:?}", field.name()));
        }
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        if field.name() == "message" {
            self.write(format_args!(" {value:?}"));
        } else {
            self.write(format_args!(" {}={value:?}", field.name()));
        }
    }
}

/// Appends the location of every panic to `schemacraft-panic.log` in `directory`, then hands the
/// panic to the hook that was there, before `panic = "abort"` ends the process. It writes through
/// `std::fs`, never through the logger, whose lock the panicking thread may hold, and it writes
/// the file and the line only: the message can quote anything the code had at hand.
fn install_panic_hook(directory: PathBuf) {
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|location| (location.file(), location.line()));
        // A failed write cannot be reported while the process is going down.
        let _ = append(
            &directory.join(PANIC_FILE_NAME),
            &panic_line(Utc::now(), location),
        );
        previous(info);
    }));
}

fn append(path: &Path, line: &str) -> io::Result<()> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?
        .write_all(line.as_bytes())
}

/// One line of the panic file: the time, the version and where the panic happened.
fn panic_line(at: DateTime<Utc>, location: Option<(&str, u32)>) -> String {
    let at = at.to_rfc3339_opts(SecondsFormat::Millis, true);
    let version = env!("CARGO_PKG_VERSION");
    match location {
        Some((file, line)) => format!(
            "{at} panic version={version} at={}:{line}\n",
            source_path(file)
        ),
        None => format!("{at} panic version={version} at=unknown\n"),
    }
}

/// The source path of a panic location without the folders of the machine that built the
/// executable. The workspace's own files have relative paths, which are kept. Dependencies are
/// compiled from Cargo's home and the standard library from the toolchain, under absolute paths
/// that name a user; they keep the part from the crate's folder on, and any other absolute path
/// keeps its file name.
fn source_path(file: &str) -> String {
    let segments: Vec<&str> = file
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty())
        .collect();
    let is_absolute = file.starts_with(['/', '\\']) || file.get(1..2) == Some(":");
    if !is_absolute {
        return segments.join("/");
    }
    let after = |marker: [&str; 2], skipped: usize| {
        segments
            .windows(2)
            .rposition(|pair| pair == marker)
            .map(|position| position + 2 + skipped)
    };
    // .../registry/src/<index>/<crate>/..., .../git/checkouts/<repository>/<revision>/...,
    // /rustc/<commit>/library/...
    let start = after(["registry", "src"], 1)
        .or_else(|| after(["git", "checkouts"], 2))
        .or_else(|| (segments.first() == Some(&"rustc")).then_some(2));
    match start
        .and_then(|start| segments.get(start..))
        .filter(|rest| !rest.is_empty())
    {
        Some(rest) => rest.join("/"),
        None => segments.last().copied().unwrap_or_default().to_string(),
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

    use std::ffi::OsStr;
    use std::io;
    use std::panic;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex, PoisonError};
    use std::time::Duration;

    use chrono::{TimeZone, Utc};
    use schemacraft_core::diagnostics;
    use tracing::Level;
    use tracing_subscriber::layer::SubscriberExt;

    use super::{
        DEBUG_CONSOLE_FILTER, DiagnosticFormat, PANIC_FILE_NAME, RELEASE_CONSOLE_FILTER,
        console_directives, file_layer, install_panic_hook, is_written_to_file, log_directory,
        panic_line, source_path,
    };

    /// A writer that keeps what it is given, for the layers under test.
    #[derive(Clone, Default)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);

    impl Buffer {
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

    impl io::Write for Buffer {
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

    /// What the file layer writes while `work` runs on this thread.
    fn file_text(work: impl FnOnce()) -> String {
        let buffer = Buffer::default();
        let writer = buffer.clone();
        let subscriber = tracing_subscriber::registry().with(file_layer(move || writer.clone()));
        tracing::subscriber::with_default(subscriber, work);
        buffer.text()
    }

    #[test]
    fn the_log_folder_is_the_identifier_folder_under_local_app_data() {
        let local_app_data = std::env::temp_dir();
        assert_eq!(
            log_directory(
                Some(local_app_data.as_os_str()),
                "com.jmanuelsoberano.schemacraft"
            ),
            Some(
                local_app_data
                    .join("com.jmanuelsoberano.schemacraft")
                    .join("logs")
            )
        );
    }

    #[test]
    fn there_is_no_log_folder_without_an_absolute_base_or_a_plain_identifier() {
        let local_app_data = std::env::temp_dir();
        let base = Some(local_app_data.as_os_str());
        assert_eq!(log_directory(None, "com.jmanuelsoberano.schemacraft"), None);
        assert_eq!(
            log_directory(Some(OsStr::new("relative")), "com.example"),
            None
        );
        for identifier in ["", "..", "a/b", "a\\b"] {
            assert_eq!(log_directory(base, identifier), None, "{identifier:?}");
        }
        let unusual: PathBuf = log_directory(base, "com.example").unwrap();
        assert!(unusual.ends_with(Path::new("com.example").join("logs")));
    }

    #[test]
    fn the_console_filter_follows_the_variable_when_it_is_valid() {
        assert_eq!(console_directives(Some("warn"), true), "warn");
        assert_eq!(console_directives(Some(" debug "), false), "debug");
        assert_eq!(console_directives(None, true), DEBUG_CONSOLE_FILTER);
        assert_eq!(console_directives(None, false), RELEASE_CONSOLE_FILTER);
        assert_eq!(console_directives(Some(""), false), RELEASE_CONSOLE_FILTER);
        assert_eq!(
            console_directives(Some("schemacraft=[unclosed"), true),
            DEBUG_CONSOLE_FILTER
        );
    }

    #[test]
    fn only_diagnostic_events_at_info_and_above_reach_the_file() {
        let (target, module) = (diagnostics::TARGET, Some(diagnostics::MODULE));
        assert!(is_written_to_file(target, module, Level::INFO));
        assert!(is_written_to_file(target, module, Level::WARN));
        assert!(is_written_to_file(target, module, Level::ERROR));
        assert!(!is_written_to_file(target, module, Level::DEBUG));
        assert!(!is_written_to_file("schemacraft", module, Level::ERROR));
        assert!(!is_written_to_file(
            "schemacraft_core::inspectors",
            module,
            Level::INFO
        ));
        assert!(!is_written_to_file(
            &format!("{target}_extra"),
            module,
            Level::INFO
        ));
        // The default target of a crate-root `diagnostics` module of this binary.
        assert!(!is_written_to_file(
            "schemacraft::diagnostics",
            Some("schemacraft::diagnostics"),
            Level::INFO
        ));
        // The target named from another module, or by a bridged record that has no module.
        assert!(!is_written_to_file(
            target,
            Some("schemacraft::commands"),
            Level::INFO
        ));
        assert!(!is_written_to_file(target, None, Level::INFO));
    }

    #[test]
    fn the_file_holds_the_diagnostic_events_and_nothing_else() {
        let text = file_text(|| {
            tracing::info!(path = r"C:\Users\sentinel\shop.scraft", "project opened");
            tracing::error!(database = "SentinelDatabase", "inspection failed");
            diagnostics::catalog_query("columns", 418, Duration::from_millis(31));
        });
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 1, "{text}");
        let (time, rest) = lines[0].split_once(' ').unwrap();
        assert!(chrono::DateTime::parse_from_rfc3339(time).is_ok(), "{time}");
        assert_eq!(
            rest,
            r#"INFO catalog query query="columns" rows=418 elapsed_ms=31"#
        );
        assert!(!text.contains("sentinel") && !text.contains("Sentinel"));
    }

    /// A diagnostic event inside two spans whose fields hold sentinels, as `#[instrument]` would
    /// record a function's arguments.
    fn event_inside_spans() {
        let request = tracing::info_span!("open_project", path = "sentinel-path");
        let _request = request.enter();
        let connect = tracing::error_span!("connect", login = "sentinel_login");
        let _connect = connect.enter();
        diagnostics::project_opened(2, false, 2048, Duration::from_millis(9));
    }

    /// What `format` writes for [`event_inside_spans`], with no filter in the way, so the spans
    /// reach the formatter.
    fn formatted<F>(format: F) -> String
    where
        F: tracing_subscriber::fmt::FormatEvent<
                tracing_subscriber::Registry,
                tracing_subscriber::fmt::format::DefaultFields,
            > + Send
            + Sync
            + 'static,
    {
        let buffer = Buffer::default();
        let writer = buffer.clone();
        let layer = tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .event_format(format)
            .with_writer(move || writer.clone());
        tracing::subscriber::with_default(
            tracing_subscriber::registry().with(layer),
            event_inside_spans,
        );
        buffer.text()
    }

    #[test]
    fn the_file_format_writes_no_span_context() {
        let text = formatted(DiagnosticFormat);
        assert!(
            text.contains(" INFO project opened format_version=2 is_read_only=false kb=2"),
            "{text}"
        );
        for leak in ["open_project", "connect", "sentinel", "{", "}"] {
            assert!(!text.contains(leak), "{leak:?} in {text}");
        }

        // The default format writes them, so the spans do reach the formatter.
        let default = formatted(tracing_subscriber::fmt::format::Format::default());
        assert!(default.contains("sentinel-path"), "{default}");
        assert!(default.contains("sentinel_login"), "{default}");

        // Behind the file filter as well.
        assert!(!file_text(event_inside_spans).contains("sentinel"));
    }

    #[test]
    fn a_panic_line_names_the_place_and_never_the_message() {
        let at = Utc.with_ymd_and_hms(2026, 10, 18, 21, 4, 5).unwrap();
        let line = panic_line(at, Some(("src-tauri/src/main.rs", 42)));
        assert_eq!(
            line,
            format!(
                "2026-10-18T21:04:05.000Z panic version={} at=src-tauri/src/main.rs:42\n",
                env!("CARGO_PKG_VERSION")
            )
        );
        assert!(panic_line(at, None).ends_with(" at=unknown\n"));
    }

    #[test]
    fn source_paths_lose_the_folders_of_the_build_machine() {
        assert_eq!(
            source_path(r"crates\schemacraft-core\src\fs.rs"),
            "crates/schemacraft-core/src/fs.rs"
        );
        assert_eq!(
            source_path("src-tauri/src/main.rs"),
            "src-tauri/src/main.rs"
        );
        assert_eq!(
            source_path(
                r"C:\Users\builder\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\tiberius-0.13.0\src\row.rs"
            ),
            "tiberius-0.13.0/src/row.rs"
        );
        assert_eq!(
            source_path("/home/runner/.cargo/git/checkouts/repo-1a2b/0f9e8d7/src/lib.rs"),
            "src/lib.rs"
        );
        assert_eq!(
            source_path("/rustc/90b35a6239c3d8bd/library/core/src/option.rs"),
            "library/core/src/option.rs"
        );
        assert_eq!(source_path(r"D:\builder\elsewhere\file.rs"), "file.rs");
    }

    #[test]
    fn a_panic_appends_its_location_to_the_panic_file() {
        let directory = tempfile::tempdir().unwrap();
        install_panic_hook(directory.path().to_path_buf());
        let result = panic::catch_unwind(|| panic!("sentinel message with a secret"));
        // Restores the default hook, so other tests keep theirs.
        drop(panic::take_hook());
        assert!(result.is_err());

        let text = std::fs::read_to_string(directory.path().join(PANIC_FILE_NAME)).unwrap();
        assert!(
            text.lines()
                .any(|line| line.contains(" panic version=") && line.contains("logging.rs:")),
            "{text}"
        );
        assert!(
            !text.contains("sentinel") && !text.contains("secret"),
            "{text}"
        );
    }
}
