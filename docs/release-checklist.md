# Release checklist

How a SchemaCraft release is verified against the acceptance criteria of the PRD (section 5),
what CI covers and what is checked by hand before a draft release is published. The automated
parts run on every push (`ci.yml`) and on every tag (`release.yml`).

## Acceptance criteria

| #   | Criterion (PRD section 5)                                    | How it is verified                                                                                                                                                   | 1.0.0          |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | Connects with SQL Server and with Windows Authentication     | Integration tests against SQL Server 2022 cover SQL logins (CI, Linux job); Windows Authentication was verified by hand against a local instance in milestone 2.     | done           |
| 2   | Extracts complete schemas with keys, relationships and types | Integration tests on the fixture database check tables, views, columns, types, primary keys, foreign keys, indexes and check constraints.                            | done           |
| 3   | Hides and shows tables, isolates relational neighbourhoods   | Unit tests of the canvas state and the neighbourhood walk; checked in the real application in milestone 4.                                                           | done           |
| 4   | At least three detail levels                                 | Unit tests of the geometry and the renderer for compact, keys and full; screenshots in both themes.                                                                  | done           |
| 5   | At least two automatic layouts plus manual placement         | Unit tests of the layered, organic and radial layouts; timings in the real application (200 tables: layered 456 ms, organic 222 ms).                                 | done           |
| 6   | Saves `.scraft` and reopens it without a connection          | Rust round-trip tests of the file; save and reopen checked in the real application in milestone 3.                                                                   | done           |
| 7   | Refreshes against the database keeping the positions         | Rust integration test of the refresh with a changed fixture; reviewed diff checked in the real application.                                                          | done           |
| 8   | Exports SVG, standalone interactive HTML and single-page PDF | Rust tests of PNG and PDF rendering; renderer and viewer tests; exports of 8 and 200 tables checked in the real application in milestone 5.                          | done           |
| 9   | Ships as a portable `.exe` on Windows                        | Release build in CI; the smoke test starts the real binary and checks the welcome screen, the version in About, language and theme switching and the reload guard.   | done, unsigned |
| 10  | Bilingual, light and dark, UX definition of done per feature | Catalogue tests keep both languages in step; the smoke test switches language and theme; every feature was reviewed in both themes and languages while it was built. | done           |

## Automated on every tag

- The tag matches `version` in `package.json` (and therefore in `Cargo.toml`).
- The Rust toolchain is the one pinned in `rust-toolchain.toml`, the same one used locally;
  bumping it is a deliberate change that runs through the gates first.
- Frontend and Rust quality gates, generated contracts up to date.
- `npm run tauri build`: portable executable and NSIS installer.
- Signing with Azure Trusted Signing, only when the secrets exist (not in 1.0).
- Smoke test of the built executable with screenshots as an artifact.
- `SHA256SUMS.txt` and a draft GitHub release with both files.

## By hand before publishing the draft

- [ ] Download the assets and check them against `SHA256SUMS.txt`.
- [ ] Start the portable executable on a machine without SchemaCraft: the welcome screen appears.
      Without the WebView2 runtime, the dialog explains it and offers the download.
- [ ] Connect to a production database, read the schema, lay it out, save, reopen, refresh and
      export to PDF and HTML.
- [ ] Open the HTML export in a browser on a machine without SchemaCraft.
- [ ] Run the installer and uninstall it; no administrator prompt appears.

## Known limitations of 1.0.0

- The executable is unsigned: SmartScreen shows "Windows protected your PC" on the first launch
  (More info, then Run anyway), and machines with Smart App Control enforced may refuse it.
- The WebView2 runtime is required. Windows 11 and updated Windows 10 already have it.
- In layered layouts an edge spanning several layers can pass behind a table placed between its
  ends (ADR-022).

## Measurements

Release build of 1.0.0 on the development machine, 2026-10-13.

| Measurement                              | Value   |
| ---------------------------------------- | ------- |
| Portable executable                      | 11.6 MB |
| NSIS installer                           | 6.3 MB  |
| Start until the window page is reachable | 0.5 s   |
| Welcome page `DOMContentLoaded`          | 0.1 s   |
