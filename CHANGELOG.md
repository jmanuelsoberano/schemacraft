# Changelog

All notable changes to SchemaCraft are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-14

First release.

### Added

- SQL Server inspector with SQL Server and Windows Authentication, encrypted connections, schema
  selection, cancellable extraction with progress, and actionable error messages.
- `.scraft` project files that reopen without a database, recent projects and connections,
  optional passwords kept in the Windows Credential Manager, and refresh from the database with a
  reviewed diff that keeps diagram positions.
- Diagram canvas with entity cards at three detail levels, crow's foot relationships, layered,
  organic and radial automatic layouts, manual placement, isolation of a table with its
  neighbours, undo and redo, and a command palette.
- Exports to SVG, standalone interactive HTML, single-page PDF and PNG at 1x, 2x and 4x, drawn by
  one renderer with bundled fonts.
- Bilingual interface (English and Spanish), light and dark themes, keyboard access throughout.
- Portable Windows executable and per-user installer, with a WebView2 runtime check at startup.

[1.0.0]: https://github.com/jmanuelsoberano/schemacraft/releases/tag/v1.0.0
