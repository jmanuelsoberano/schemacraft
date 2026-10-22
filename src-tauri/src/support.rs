//! Local, bounded diagnostic reports and fixed support destinations. No project or connection
//! state is read, and no report is uploaded (ADR-046).

use std::fmt::Write as _;
use std::fs::{self, File, Metadata};
use std::io::{self, Read, Seek, SeekFrom, Write as _};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use schemacraft_core::diagnostics::ClosedKind;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The logger retains at most seven files, including its panic log (ADR-041).
const MAX_LOG_FILES: usize = 7;
/// Keep the recent end of a large file, with a visible truncation notice.
const MAX_LOG_BYTES: u64 = 256 * 1024;
/// The combined UTF-8 report is bounded independently of the caller.
const MAX_REPORT_BYTES: usize = 2 * 1024 * 1024;
const REPOSITORY_URL: &str = "https://github.com/jmanuelsoberano/schemacraft";

/// An in-memory report for local review and export; never a remote issue body.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ipc/")]
pub struct DiagnosticReport {
    /// The exact text shown in the preview and saved on request.
    pub text: String,
    /// Successfully included diagnostic files.
    pub log_count: usize,
    /// Included files whose older lines were omitted by the size bound.
    pub truncated_log_count: usize,
    /// Selected files that could not be read as UTF-8 text.
    pub unavailable_log_count: usize,
}

/// The only web destinations this feature can open. No caller-supplied URL or report text.
#[derive(Debug, Clone, Copy, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ipc/")]
pub enum SupportPage {
    /// A public issue form with only the application version prefilled.
    BugReport,
    /// Instructions for reporting vulnerabilities privately.
    SecurityPolicy,
}

impl SupportPage {
    /// Fixed HTTPS destination; only the build's semantic version enters the query.
    pub fn url(self) -> String {
        match self {
            Self::BugReport => format!(
                "{REPOSITORY_URL}/issues/new?template=bug_report.yml&app_version={}",
                env!("CARGO_PKG_VERSION")
            ),
            Self::SecurityPolicy => format!("{REPOSITORY_URL}/security/policy"),
        }
    }
}

/// Classifications shown as actionable support guidance, never raw OS messages in logs.
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "ipc/")]
pub enum SupportErrorKind {
    /// The diagnostic directory could not be enumerated.
    ReadFailed,
    /// A local report could not be written.
    WriteFailed,
    /// The chosen destination is not an absolute text-file path.
    InvalidDestination,
    /// The supplied report exceeds the export bound.
    ReportTooLarge,
    /// The browser could not open the chosen fixed support destination.
    PageOpenFailed,
}

impl ClosedKind for SupportErrorKind {}

/// Technical report failures stay in the host: this feature has no database/domain operation.
#[derive(Debug)]
pub struct SupportError {
    /// Classification translated by the frontend.
    pub kind: SupportErrorKind,
}

impl From<SupportErrorKind> for SupportError {
    fn from(kind: SupportErrorKind) -> Self {
        Self { kind }
    }
}

/// Reads only recognized, regular files directly inside the known diagnostic directory.
pub fn read_report(
    directory: Option<&Path>,
    webview_version: Option<&str>,
    at: DateTime<Utc>,
) -> Result<DiagnosticReport, SupportError> {
    let runtime = webview_version
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 64
                && value.chars().all(|c| c.is_ascii_digit() || c == '.')
        })
        .unwrap_or("unavailable");
    let mut report = DiagnosticReport {
        text: format!(
            "SchemaCraft diagnostic report\n\
             Report format: 1\n\
             Generated (UTC): {}\n\
             SchemaCraft: {}\n\
             Build: {}\n\
             Operating system: {}\n\
             Architecture: {}\n\
             WebView2: {runtime}\n\n\
             Review this file before sharing it. Nothing is uploaded automatically.\n\
             Projects, preferences and stored credentials are not collected.\n\
             At most seven diagnostic files are included, with up to 256 KiB from each.\n",
            at.to_rfc3339_opts(SecondsFormat::Secs, true),
            env!("CARGO_PKG_VERSION"),
            if cfg!(debug_assertions) {
                "development"
            } else {
                "release"
            },
            std::env::consts::OS,
            std::env::consts::ARCH,
        ),
        log_count: 0,
        truncated_log_count: 0,
        unavailable_log_count: 0,
    };
    let files = directory.map(log_files).transpose()?.unwrap_or_default();
    for (_, name, path) in files {
        // `name` has passed the strict logger-name allowlist; it contains no user path.
        let _ = write!(report.text, "\n--- {name} ---\n");
        if let Ok((text, truncated)) = read_log_tail(&path) {
            report.log_count += 1;
            if truncated {
                report.truncated_log_count += 1;
                report
                    .text
                    .push_str("[Older lines omitted; recent complete lines follow.]\n");
            }
            report.text.push_str(&text);
            if !text.ends_with('\n') {
                report.text.push('\n');
            }
        } else {
            report.unavailable_log_count += 1;
            report
                .text
                .push_str("[File unavailable or not UTF-8 text; no contents included.]\n");
        }
    }
    if report.log_count == 0 {
        report
            .text
            .push_str("\nNo diagnostic log contents were available.\n");
    }
    Ok(report)
}

fn recognized_log_name(name: &str) -> bool {
    name == "schemacraft-panic.log"
        || name
            .strip_prefix("schemacraft.")
            .and_then(|value| value.strip_suffix(".log"))
            .is_some_and(|date| {
                date.len() == 10
                    && NaiveDate::parse_from_str(date, "%Y-%m-%d")
                        .is_ok_and(|parsed| parsed.format("%Y-%m-%d").to_string() == date)
            })
}

fn regular_log_file(metadata: &Metadata) -> bool {
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Windows reparse points can redirect a read outside the diagnostic directory.
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    true
}

fn log_files(directory: &Path) -> Result<Vec<(SystemTime, String, PathBuf)>, SupportError> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(SupportErrorKind::ReadFailed.into()),
    };
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !recognized_log_name(&name) {
            continue;
        }
        let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if regular_log_file(&metadata) {
            files.push((
                metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                name,
                entry.path(),
            ));
        }
    }
    files.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1)));
    files.truncate(MAX_LOG_FILES);
    Ok(files)
}

fn read_log_tail(path: &Path) -> io::Result<(String, bool)> {
    if !regular_log_file(&fs::symlink_metadata(path)?) {
        return Err(io::Error::other("not a regular diagnostic file"));
    }
    let mut file = File::open(path)?;
    let metadata = file.metadata()?;
    if !regular_log_file(&metadata) {
        return Err(io::Error::other("not a regular diagnostic file"));
    }
    let start = metadata.len().saturating_sub(MAX_LOG_BYTES);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.take(MAX_LOG_BYTES).read_to_end(&mut bytes)?;
    let offset = if start == 0 {
        0
    } else {
        bytes
            .iter()
            .position(|value| *value == b'\n')
            .map_or(bytes.len(), |index| index + 1)
    };
    let text = std::str::from_utf8(bytes.get(offset..).unwrap_or_default())
        .map_err(|_| io::Error::other("not UTF-8 diagnostic text"))?
        .to_owned();
    Ok((text, start > 0))
}

/// Atomically saves exactly the reviewed text; it does not collect new files while saving.
pub fn write_report(path: &Path, text: &str) -> Result<(), SupportError> {
    if !path.is_absolute()
        || !path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("txt"))
    {
        return Err(SupportErrorKind::InvalidDestination.into());
    }
    if text.len() > MAX_REPORT_BYTES {
        return Err(SupportErrorKind::ReportTooLarge.into());
    }
    let parent = path.parent().ok_or(SupportErrorKind::InvalidDestination)?;
    let save = || -> io::Result<()> {
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        temporary.write_all(text.as_bytes())?;
        temporary.as_file().sync_all()?;
        temporary.persist(path).map_err(|error| error.error)?;
        Ok(())
    };
    save().map_err(|_| SupportErrorKind::WriteFailed.into())
}

#[cfg(test)]
mod tests;
