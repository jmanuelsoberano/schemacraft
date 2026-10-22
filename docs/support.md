# Reporting problems

Status: unreleased support workflow. The published 1.2.0 executable provides the raw diagnostic
folder in About; this feature is prepared separately from Microsoft Store packaging.

## User flow

1. Open **About → Report a problem**, or use **Report a problem** in the command palette.
2. Review the diagnostic preview. Saving it is optional and opens the native save dialog.
3. Choose a writable destination ending in `.txt`. The saved UTF-8 text is exactly the preview;
   it is not refreshed behind the user's back. **Show saved file** reveals it for review.
4. Choose **Open bug report on GitHub** if desired. GitHub requires an account and reports are
   public. Describe the steps, expected/actual behavior and relevant versions. Attach the
   reviewed file manually only if useful, then submit the issue yourself.
5. Use **Security reporting guidance** for vulnerabilities, following [SECURITY.md](../SECURITY.md).

No project or database connection is needed. A report can be opened without a diagnostic file.
The application never creates an issue or uploads a report automatically.

## Diagnostic format and boundaries

Format 1 is plain text with a UTC generation time, application version/build, OS family,
architecture and numeric WebView2 version when available. Windows build and SQL Server versions
can be entered manually in the issue form; the collector does not query a database or system
inventory to discover them.

The source directory comes only from `AppState.log_directory`. Recognized files are
`schemacraft.YYYY-MM-DD.log` with a valid date and `schemacraft-panic.log`, directly inside that
directory. The collector ignores other names, subdirectories, symlinks and Windows reparse
points. It selects at most seven regular files, newest modification time first, with filename
as a deterministic tie-breaker.

At most 256 KiB per file is read. An oversized file contributes its recent complete lines and
a truncation notice. Unreadable or non-UTF-8 files contribute a static unavailability notice,
without raw error messages. A report with no log contents still contains basic application
information. Export is bounded to 2 MiB and uses an atomic local replacement; an invalid path,
non-text extension or oversized input fails before writing.

Projects, preferences, connection history, stored credentials, screenshots, arbitrary files,
hardware identifiers and environment-variable values are not collected. The existing logger's
typed privacy contract remains in force (ADR-041). Users still review the file before sharing.
Closing the dialog discards its in-memory preview; only an explicit save creates a report file.

The browser command accepts a closed `SupportPage` enum, not a URL, file path or issue body.
The bug URL contains only the fixed template and build version. The security destination is
the repository's existing security policy. Browser opening and local file export are independent.

## Verification

- Rust tests cover the filename/directory boundary, seven-file cap, missing logs, truncated and
  non-UTF-8 input, exact-preview saving, replacement, rejected destinations and fixed URLs.
- Store tests cover cancellation, retry, stale loading, concurrent saves and the absence of
  automatic saving or browser opening.
- Check the real desktop workflow in EN/ES, light/dark, with keyboard focus, local preview,
  save/cancel/error states and unchanged project state. Back up and restore preferences for
  every real-app session.
- Verify the GitHub form schema and version-field ID before merge. The live issue form becomes
  available only after its template reaches the default branch; local tests do not establish
  that GitHub has rendered it. No test should publish a real issue automatically.
- Run the normal quality gates and the SQL Server 2019/2022 regression checks. This workflow
  requires no Store SDK, account, certificate, telemetry service or database schema change.
