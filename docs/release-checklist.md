# Release checklist

How a SchemaCraft release is verified against the acceptance criteria of the PRD (section 5) and
the scope each version adds (section 3.8 for 1.1), what CI covers and what is checked by hand
before a draft release is published. The automated parts run on every pull request and push to
`main` (`ci.yml`, sized to the change, ADR-033) and on every tag (`release.yml`).

## Acceptance criteria

| #   | Criterion (PRD section 5)                                    | How it is verified                                                                                                                                                   | 1.0.0          | 1.1.0          |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------- |
| 1   | Connects with SQL Server and with Windows Authentication     | Integration tests in CI against SQL Server 2019 and 2022 (2022 alone up to 1.1.0) cover SQL logins; Windows Authentication was verified by hand on a local instance. | done           | done           |
| 2   | Extracts complete schemas with keys, relationships and types | Integration tests on the fixture database check tables, views, columns, types, primary keys, foreign keys, indexes and check constraints.                            | done           | done           |
| 3   | Hides and shows tables, isolates relational neighbourhoods   | Unit tests of the canvas state and the neighbourhood walk; checked in the real application in milestone 4.                                                           | done           | done           |
| 4   | At least three detail levels                                 | Unit tests of the geometry and the renderer for compact, keys and full; screenshots in both themes.                                                                  | done           | done           |
| 5   | At least two automatic layouts plus manual placement         | Unit tests of the layered, organic and radial layouts; timings in the real application (200 tables: layered 456 ms, organic 222 ms).                                 | done           | done           |
| 6   | Saves `.scraft` and reopens it without a connection          | Rust round-trip tests of the file; save and reopen checked in the real application in milestone 3.                                                                   | done           | done           |
| 7   | Refreshes against the database keeping the positions         | Rust integration test of the refresh with a changed fixture; reviewed diff checked in the real application.                                                          | done           | done           |
| 8   | Exports SVG, standalone interactive HTML and single-page PDF | Rust tests of PNG and PDF rendering; renderer and viewer tests; exports of 8 and 200 tables checked in the real application in milestone 5.                          | done           | done           |
| 9   | Ships as a portable `.exe` on Windows                        | Release build in CI; the smoke test starts the real binary and checks the welcome screen, the version in About, language and theme switching and the reload guard.   | done, unsigned | done, unsigned |
| 10  | Bilingual, light and dark, UX definition of done per feature | Catalogue tests keep both languages in step; the smoke test switches language and theme; every feature was reviewed in both themes and languages while it was built. | done           | done           |

## Scope of 1.1

What PRD section 3.8 adds to the criteria above. The SQL Server integration tests run in CI on
every change to the core (Linux job). Each part was also used in the real application against a
local SQL Server 2022 container, in both languages and themes, before it was merged.

| Part (PRD 3.8)                 | How it is verified                                                                                                                                                                                                                                                                                                                                                                                                                                     | 1.1.0 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| Partial access explained       | `sqlserver_permissions` creates nine logins, from `db_owner` down to `CONNECT` only, and checks every access verdict, that a hidden `CHECK` or `DEFAULT` text is never read as an empty one, that foreign keys to tables a login cannot see are kept, that a denial to `public` never reaches `dbo`, and the neutral states of a login that sees nothing and of an empty database; unit tests of the access notice, its causes and the `GRANT` script. | done  |
| `.scraft` format 2             | Rust tests upgrade a format 1 file and save it as format 2, open a newer format read-only only when its `minReaderVersion` allows it and refuse it otherwise, report a newer file this version cannot parse as a newer format rather than as a damaged one, and keep unknown keys at the root, the snapshot, the canvas and each node on save; an integration test refreshes a project saved by 1.0 with the same login and finds no change.           | done  |
| Refresh with fewer permissions | Rust tests of what a weaker capture keeps and for how long; integration tests refresh with a weaker login, which removes nothing, and with a stronger one, which reports no schema change and lists what became readable.                                                                                                                                                                                                                              | done  |
| Tables and views told apart    | Unit tests of the entity listing and its schema and kind sections; a test refuses any colour outside `tokens.css`, which the canvas, the exports and the viewer share.                                                                                                                                                                                                                                                                                 | done  |
| Inspector panel                | Unit tests of the view-model shared with the HTML viewer, of the panel and what it inspects, of its SQL disclosure and of the side panel widths in a narrow window.                                                                                                                                                                                                                                                                                    | done  |
| Readable rules                 | A golden file of 72 stored `CHECK` forms, 21 of them left unread on purpose, is checked against SQL Server by the integration tests and read by the frontend tests; further integration tests pin the engine behaviour the sentences rest on; unit tests of the parser, the `CHECK` and foreign key readers, the sentence templates in both languages and the crow's foot geometry.                                                                    | done  |

## Automated on every tag

- The tag points at a commit on `main` and matches `version` in `package.json` and in
  `Cargo.toml`, and `CHANGELOG.md` has a dated entry for that version with its link. The entry
  becomes the notes of the draft release; CI checks on every pull request that the version in
  `package.json` has one.
- The Rust toolchain is the one pinned in `rust-toolchain.toml`, the same one used locally;
  bumping it is a deliberate change that runs through the gates first.
- Frontend and Rust quality gates, generated contracts up to date.
- `npm run tauri build`: portable executable and NSIS installer.
- No dependency or build caches: the release is built from the repository alone.
- Signing through SignPath Foundation once the application to it is approved (1.0.0 and 1.1.0
  are unsigned).
- Smoke test of the built executable with screenshots and a report as an artifact; the runner
  installs the WebView2 runtime first when it lacks it, as a user's machine would need it.
- `SHA256SUMS.txt` and a draft GitHub release with both files.

## By hand before publishing the draft

- [ ] Download the assets and check them against `SHA256SUMS.txt`.
- [ ] Start the portable executable on a machine without SchemaCraft: the welcome screen appears.
      Without the WebView2 runtime, the dialog explains it and offers the download.
- [ ] Connect to a production database, read the schema, lay it out, save, reopen, refresh and
      export to PDF and HTML.
- [ ] Open a project saved by the previous release and refresh it with the same login: the review
      reports no schema change and offers to update the project. Apply, save, reopen the file
      and check that its header says `formatVersion` 2 and `minReaderVersion` 2.
- [ ] Connect with a login that lacks `VIEW DEFINITION` (for example a `db_datareader` member):
      the connection dialog warns before reading, the status bar shows the access chip, the
      access report opens with Ctrl+Shift+A and Copy GRANT script puts the script on the
      clipboard.
- [ ] Read a database with views: the entities panel shows Tables and Views sections, and views
      carry the VIEW label on the canvas and in the SVG, PDF and HTML exports.
- [ ] Open the Inspector with Ctrl+I on a selected table, follow the selection to another one,
      resize the panel and restart the application: it remembers the width.
- [ ] Select a table with `CHECK` constraints and foreign keys, in English and in Spanish: the
      Inspector and the HTML export read its rules as sentences, pointing at a rule highlights
      its columns and relationship, and Show SQL opens its definition. The PDF and PNG exports
      draw the same relationship markers as the canvas, the zero-or-one circles included.
- [ ] Open the HTML export in a browser on a machine without SchemaCraft.
- [ ] Run the installer and uninstall it; no administrator prompt appears.
- [ ] The release notes describe the program, link the code signing policy and carry the
      version's `CHANGELOG.md` entry.

## Known limitations of 1.1.0

- The executable is unsigned: SmartScreen shows "Windows protected your PC" on the first launch
  (More info, then Run anyway), and machines with Smart App Control enforced may refuse it.
- The WebView2 runtime is required. Windows 11 and updated Windows 10 already have it.
- SchemaCraft 1.0 refuses projects saved by 1.1, saying they were written by a newer version;
  keep a copy of a project that must still open in 1.0.
- A `CHECK` constraint outside the forms SchemaCraft reads shows its SQL instead of a sentence.
- A unique constraint or a nonclustered primary key whose index is disabled still makes a
  foreign key read "at most one" and draw the one-to-one marker, because the snapshot does not
  record whether an index is disabled (ADR-039).
- In layered layouts an edge spanning several layers can pass behind a table placed between its
  ends (ADR-022).

## Measurements

Sizes in decimal megabytes: the assets published for 1.0.0 and the release build of 1.1.0.
Startup from the smoke test on the development machine, 1.0.0 on 2026-10-13 and 1.1.0 on
2026-10-18; the 1.1.0 figures are from a start after the first, since the first start of the
new build took 1.6 s.

| Measurement                              | 1.0.0   | 1.1.0   |
| ---------------------------------------- | ------- | ------- |
| Portable executable                      | 11.5 MB | 12.1 MB |
| NSIS installer                           | 4.8 MB  | 5.0 MB  |
| Start until the window page is reachable | 0.5 s   | 0.54 s  |
| Welcome page `DOMContentLoaded`          | 0.1 s   | 0.03 s  |
