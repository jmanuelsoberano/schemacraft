#![allow(clippy::expect_used, clippy::unwrap_used, clippy::indexing_slicing)]

use super::*;

fn report(directory: Option<&Path>) -> DiagnosticReport {
    read_report(directory, Some("154.0.1.2"), Utc::now()).unwrap()
}

#[test]
fn includes_only_recognized_files_without_reading_preferences_projects_or_subdirectories() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(
        directory.path().join("schemacraft.2026-10-22.log"),
        "INFO tables=6\n",
    )
    .unwrap();
    fs::write(
        directory.path().join("schemacraft-panic.log"),
        "panic at=src/main.rs:2\n",
    )
    .unwrap();
    for name in [
        "preferences.json",
        "private.scraft",
        "schemacraft.debug.log",
        "other.log",
        "schemacraft.2026-02-31.log",
    ] {
        fs::write(directory.path().join(name), "PRIVATE_SERVER_PASSWORD_SQL").unwrap();
    }
    fs::create_dir(directory.path().join("schemacraft.2026-10-21.log")).unwrap();
    fs::write(
        directory
            .path()
            .join("schemacraft.2026-10-21.log/nested.log"),
        "PRIVATE_NESTED",
    )
    .unwrap();

    let result = report(Some(directory.path()));
    assert_eq!(result.log_count, 2);
    assert!(result.text.contains("INFO tables=6"));
    assert!(result.text.contains("panic at=src/main.rs:2"));
    assert!(result.text.contains("WebView2: 154.0.1.2"));
    assert!(!result.text.contains("PRIVATE_"));
    assert!(
        !result
            .text
            .contains(&directory.path().display().to_string())
    );
    assert!(!result.text.contains("preferences.json"));
    assert!(!result.text.contains("private.scraft"));
}

#[test]
fn the_report_has_at_most_seven_files_even_if_more_are_present() {
    let directory = tempfile::tempdir().unwrap();
    for day in 1..=12 {
        fs::write(
            directory
                .path()
                .join(format!("schemacraft.2026-10-{day:02}.log")),
            "INFO rows=1\n",
        )
        .unwrap();
    }
    let result = report(Some(directory.path()));
    assert_eq!(result.log_count, 7);
    assert_eq!(result.text.matches("--- schemacraft.").count(), 7);
}

#[test]
fn missing_logs_still_produce_a_useful_report_without_environment_identifiers() {
    let directory = tempfile::tempdir().unwrap();
    for source in [None, Some(directory.path().join("missing"))] {
        let result = read_report(source.as_deref(), Some("PRIVATE_MACHINE"), Utc::now()).unwrap();
        assert_eq!(result.log_count, 0);
        assert!(
            result
                .text
                .contains("No diagnostic log contents were available.")
        );
        assert!(result.text.contains("WebView2: unavailable"));
        assert!(!result.text.contains("PRIVATE_MACHINE"));
    }
}

#[test]
fn an_unreadable_directory_is_distinct_from_no_logs() {
    let file = tempfile::NamedTempFile::new().unwrap();
    assert!(matches!(
        read_report(Some(file.path()), None, Utc::now()),
        Err(SupportError {
            kind: SupportErrorKind::ReadFailed
        })
    ));
}

#[test]
fn a_large_log_keeps_recent_complete_lines_with_a_truncation_notice() {
    let directory = tempfile::tempdir().unwrap();
    let mut log = "OLD_FIRST_LINE\n".repeat(30_000);
    log.push_str("LATEST_FAILURE kind=queryFailed\n");
    fs::write(directory.path().join("schemacraft.2026-10-22.log"), log).unwrap();
    let result = report(Some(directory.path()));
    assert_eq!(result.truncated_log_count, 1);
    assert!(result.text.contains("Older lines omitted"));
    assert!(result.text.contains("LATEST_FAILURE kind=queryFailed"));
    assert!(result.text.len() < usize::try_from(MAX_LOG_BYTES).unwrap() + 2048);
}

#[test]
fn binary_files_are_omitted_without_exposing_their_bytes_or_failing_the_report() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(
        directory.path().join("schemacraft.2026-10-22.log"),
        [0xff, 0xfe],
    )
    .unwrap();
    let result = report(Some(directory.path()));
    assert_eq!(result.log_count, 0);
    assert_eq!(result.unavailable_log_count, 1);
    assert!(result.text.contains("File unavailable or not UTF-8 text"));
}

#[cfg(unix)]
#[test]
fn a_recognized_symlink_cannot_collect_an_unrelated_file() {
    let directory = tempfile::tempdir().unwrap();
    let outside = tempfile::NamedTempFile::new().unwrap();
    fs::write(outside.path(), "PRIVATE_OUTSIDE_LOGS").unwrap();
    std::os::unix::fs::symlink(
        outside.path(),
        directory.path().join("schemacraft.2026-10-22.log"),
    )
    .unwrap();
    let result = report(Some(directory.path()));
    assert_eq!(result.log_count, 0);
    assert!(!result.text.contains("PRIVATE_OUTSIDE_LOGS"));
}

#[test]
fn saving_writes_exactly_the_preview_even_if_the_source_log_changes() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("schemacraft.2026-10-22.log");
    fs::write(&source, "INFO rows=1\n").unwrap();
    let reviewed = report(Some(directory.path()));
    fs::write(source, "INFO rows=999\n").unwrap();
    let destination = directory.path().join("diagnostic.txt");
    fs::write(&destination, "previous report").unwrap();
    write_report(&destination, &reviewed.text).unwrap();
    assert_eq!(fs::read_to_string(destination).unwrap(), reviewed.text);
}

#[test]
fn invalid_destinations_and_oversized_reports_do_not_write_anything() {
    let directory = tempfile::tempdir().unwrap();
    for path in [
        PathBuf::from("relative.txt"),
        directory.path().join("preferences.json"),
        directory.path().join("project.scraft"),
    ] {
        assert!(matches!(
            write_report(&path, "report"),
            Err(SupportError {
                kind: SupportErrorKind::InvalidDestination
            })
        ));
        assert!(!path.exists());
    }
    let destination = directory.path().join("report.txt");
    assert!(matches!(
        write_report(&destination, &"x".repeat(MAX_REPORT_BYTES + 1)),
        Err(SupportError {
            kind: SupportErrorKind::ReportTooLarge
        })
    ));
    assert!(!destination.exists());
    assert!(matches!(
        write_report(&directory.path().join("missing/report.txt"), "report"),
        Err(SupportError {
            kind: SupportErrorKind::WriteFailed
        })
    ));
}

#[test]
fn support_urls_are_fixed_and_the_issue_query_contains_only_the_build_version() {
    assert_eq!(
        SupportPage::BugReport.url(),
        format!(
            "{REPOSITORY_URL}/issues/new?template=bug_report.yml&app_version={}",
            env!("CARGO_PKG_VERSION")
        )
    );
    assert_eq!(
        SupportPage::SecurityPolicy.url(),
        format!("{REPOSITORY_URL}/security/policy")
    );
}
