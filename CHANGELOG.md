# Changelog

All notable changes to SchemaCraft are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- A disabled button or menu item says why it is unavailable, for example that no project is open
  or that there is nothing to undo, instead of a generic note.
- The file type in the open and save dialogs follows the interface language.
- Saving projects and preferences, reading remembered passwords and comparing schemas no longer
  run on the window's thread, so the window stays responsive with large schemas or a slow disk.

### Fixed

- A preferences file written by a newer SchemaCraft is left untouched instead of being replaced.
- A failed write of the preferences no longer changes the history shown until the next restart.
- Project, preferences and export files are flushed to the disk before they replace the previous
  file, so a power cut cannot leave an empty file behind.

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
