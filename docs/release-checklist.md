# Release checklist

How a SchemaCraft release is verified against the acceptance criteria of the PRD (section 5) and
the scope each version adds (section 3.8 for 1.1 and 3.9 for 1.2), what CI covers and what is checked by hand
before a draft release is published. The automated parts run on every pull request and push to
`main` (`ci.yml`, sized to the change, ADR-033) and on every tag (`release.yml`).

## Release 1.2 preparation

The feature checks and dated local release verification below are complete. On 2026-10-19 the
maintainer reported that the Spanish interface review and release acceptance session passed:
capability probe, diagnostic log review, capture, refresh, save, reopen and export. That session
used SQL login authentication; it did not verify Windows Authentication. No private connection
details or database contents are recorded here.

The version commit follows that acceptance. After the feature PR merges, a separate release PR
updates the package and workspace versions, both lockfiles, the dated CHANGELOG entry and this
checklist. That PR must pass all gates, both SQL Server versions, the local release smoke test
and the previous-reader check. After that PR merges, the version tag on `main` builds a draft
release. Downloaded-asset, clean-machine and installer checks use those artifacts and must pass
before the draft is published.

## Acceptance criteria

For 1.2.0, "verified" means the automated checks and dated local application checks below;
maintainer acceptance is recorded above. Windows Authentication has historical manual evidence
only and has not been reverified separately for 1.2. The downloaded executable passed the local
checks recorded below; clean-machine, runtime and installation checks remain pending.

| #   | Criterion (PRD section 5)                                    | How it is verified                                                                                                                                                   | 1.0.0          | 1.1.0          | 1.2.0                                                |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------- | ---------------------------------------------------- |
| 1   | Connects with SQL Server and with Windows Authentication     | Integration tests in CI against SQL Server 2019 and 2022 (2022 alone up to 1.1.0) cover SQL logins; Windows Authentication was verified by hand on a local instance. | done           | done           | SQL logins verified; Windows Authentication pending  |
| 2   | Extracts complete schemas with keys, relationships and types | Integration tests on the fixture database check tables, views, columns, types, primary keys, foreign keys, indexes and check constraints.                            | done           | done           | verified                                             |
| 3   | Hides and shows tables, isolates relational neighbourhoods   | Unit tests of the canvas state and the neighbourhood walk; checked in the real application in milestone 4.                                                           | done           | done           | verified                                             |
| 4   | At least three detail levels                                 | Unit tests of the geometry and the renderer for compact, keys and full; screenshots in both themes.                                                                  | done           | done           | verified                                             |
| 5   | At least two automatic layouts plus manual placement         | Unit tests of the layered, organic and radial layouts; timings in the real application (200 tables: layered 456 ms, organic 222 ms).                                 | done           | done           | verified                                             |
| 6   | Saves `.scraft` and reopens it without a connection          | Rust round-trip tests of the file; save and reopen checked in the real application in milestone 3.                                                                   | done           | done           | verified                                             |
| 7   | Refreshes against the database keeping the positions         | Rust integration test of the refresh with a changed fixture; reviewed diff checked in the real application.                                                          | done           | done           | verified                                             |
| 8   | Exports SVG, standalone interactive HTML and single-page PDF | Rust tests of PNG and PDF rendering; renderer and viewer tests; exports of 8 and 200 tables checked in the real application in milestone 5.                          | done           | done           | verified                                             |
| 9   | Ships as a portable `.exe` on Windows                        | Release build in CI; the smoke test starts the real binary and checks the welcome screen, the version in About, language and theme switching and the reload guard.   | done, unsigned | done, unsigned | downloaded executable verified; installation pending |
| 10  | Bilingual, light and dark, UX definition of done per feature | Catalogue tests keep both languages in step; the smoke test switches language and theme; every feature was reviewed in both themes and languages while it was built. | done           | done           | verified; maintainer review passed                   |

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

## Scope of 1.2

The implemented parts of PRD section 3.9 extend the same gates. Each SQL Server integration
binary runs against both 2019 and 2022; the expected major version prevents a run from silently
testing the other container. Release publication still requires the manual checks below.

The 1.2.0 column records feature verification. The full local release build passed the smoke
test on both engines, and the published 1.1.0 executable passed the older-reader check. These
checks complement the core compatibility tests; downloaded release assets still require
their own publication checks. The downloaded 1.2.0 executable has since passed both-engine
application checks and the 1.1.0 reader check below; hosted verification remains pending.

| Part (PRD 3.9)                              | How it is verified                                                                                                                                                                                                                                                                                                      | 1.2.0                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Measured capability and private diagnostics | The probe reports counts and bytes only; integration and diagnostics tests inspect successful, denied, failed and timed-out operations and reject private names, text and messages from the log.                                                                                                                        | feature checks verified            |
| Index and constraint state                  | Core tests pin clustering, included columns, disabled/filtered indexes, trust and partitioned index keys; frontend and export tests pin the resulting rule text, badges and relationship markers.                                                                                                                       | feature checks verified            |
| Format 3 and older readers                  | Round trips, migration chains and forward-read tests keep unknown fields and the table interpretation of 1.1; an export sentinel proves routine objects and module texts do not leave the project.                                                                                                                      | verified with the 1.1.0 executable |
| Code metadata and texts                     | `sqlserver_code` reads procedures, every SQL function kind, parameters/TVPs, returned columns, view options and DML trigger events/order; assembly tests cover CLR kinds and unknown values. Tests distinguish verbatim readable, encrypted, not-visible and omitted texts.                                             | feature checks verified            |
| Code access and scope                       | `sqlserver_permissions` pins reader, schema SELECT/EXECUTE, VIEW DEFINITION plus DENY EXECUTE and execute-only profiles on both engines. Bound schema filters, code-only schemas, views off and both code options are tested. A 2022-only persona checks USER_NAME with VIEW SECURITY DEFINITION denied.                | feature checks verified            |
| Code failure and refresh                    | A real denial of `sys.sql_modules` leaves tables readable and saved code intact. Unit tests cover timeouts, normalization, all 14 code properties, first captures, explicit exclusions, whole-object/definition dates and repeated weaker/failing reads. A failed optional read cannot claim the project is up to date. | feature checks verified            |
| Connection and review                       | Frontend tests cover default switches, stable schema selections after retesting, stage order, grouped counts, capture/failure lines, both languages and the Rust verdicts consumed by the review.                                                                                                                       | feature checks verified            |
| Code extraction budget                      | The stress fixture includes 200 tables, 200 triggers, 600 procedures, 100 scalar functions, 50 inline table functions and 20 views. The integration test enforces the five-second inspection budget and reports the elapsed time and snapshot JSON bytes.                                                               | debug and release verified         |
| Objects and module details                  | Frontend tests cover exclusive selection, document replacement and refresh removal, names with dots, grouping, 200-row pages, bounded search, palette kinds, parameters, function returns, trigger events/order and all definition states in both languages.                                                            | feature checks verified            |
| Read-only code viewer                       | Tests cover exact source splitting, literal search and range offsets, wrap persistence, copy feedback and owned shortcuts. Real-app checks cover selection, CRLF copying, CSS highlights, Escape focus, context-menu guards, global shortcuts and large sources.                                                        | feature checks verified            |

Trigger export tests also pin enabled, mixed and all-disabled counts, unchanged card height,
translated accessible descriptions, title fitting, deterministic SVG and byte-identical output
for a successful empty trigger capture. HTML projection sentinels allow visible trigger names
while rejecting module SQL, routine objects, hidden-parent triggers, carried code and unknown
properties. Hostile identifiers render as text. Shared details tests cover ordering, per-event
First/Last, view settings and honest unread, unknown and retained states in both languages.

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

## Independent draft-asset verification

`verify-release.yml` downloads the existing draft assets and verifies them without rebuilding,
signing, replacing or publishing them. The controller creates a new standard local account on
a disposable GitHub-hosted Windows Server 2022 runner. Only the limited-account worker launches
the portable executable, installer, installed executable and uninstaller. Each application
session preserves preferences as opaque bytes and restores the original bytes or absence after
confirmed process termination. Uploaded evidence excludes profiles, preferences and credentials.

The initial target is `v1.2.0`. Downloaded asset identity and portable application behavior have
been verified locally as recorded below; hosted, installed-application and Windows Authentication
results remain pending until the workflow has run and its reports have been inspected. Record
the tag/source commit, verifier commit, run URL,
asset hashes, Windows image and build, SQL Server and WebView2 versions, account/token checks,
UAC setting and per-scenario results. These are downloaded-asset results, separate from the local
candidate measurements below.

| Verification                      | Required evidence                                                                                                                                       | Status                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Asset identity                    | Both downloaded binary hashes match `SHA256SUMS.txt`; executable and backend report the expected release version                                        | verified locally; repeat on hosted runner                      |
| Fresh standard account            | No existing installation, registration or app data; account is not in Administrators and worker has no administrative token                             | pending                                                        |
| Portable and installed app        | Embedded frontend, exact About version, English/light, Spanish/dark, reload guard and confirmed termination                                             | portable verified locally; hosted and installed checks pending |
| Per-user installation and removal | Installer `asInvoker` manifest, current-user registration, installed executable matching the portable, completed uninstall and preserved synthetic data | pending                                                        |
| Unavailable WebView2              | Native bilingual explanation and exit after No; report natural absence or process-local failure injection                                               | pending                                                        |
| Local Windows Authentication      | Actual application connection and capture against the owned local SQL fixture using the fresh Windows account                                           | pending                                                        |

The hosted runner is Windows Server, not a Windows 10/11 consumer image. Its UAC setting is
recorded; when UAC is disabled, successful standard-account execution does not verify interactive
elevation prompts. An empty `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` imposed only on the process
tests the runtime failure path without uninstalling a shared runtime; it is not evidence of
natural runtime absence. Local Windows Authentication does not test domain accounts, remote
Kerberos or delegation. Do not close broader manual checks based on these narrower results.

## By hand before publishing the draft

These boxes track the release artifacts and final acceptance, independently of the completed
development-build sessions recorded below. Leave a box open until its stated check is complete.

- [x] Download the assets and check them against `SHA256SUMS.txt`.
- [x] Exercise the downloaded portable against SQL Server 2022 and 2019 with SQL logins:
      capture, module details, save/reopen, unchanged refresh, SVG/PDF/PNG/HTML exports and
      English/light and Spanish/dark. Restore preferences after confirmed process termination.
- [ ] Start the portable executable on a fresh Windows 10/11 consumer installation without
      SchemaCraft: the welcome screen appears. Record separately any disposable Windows Server
      verification above.
- [ ] Verify the native bilingual explanation when WebView2 is unavailable and exit after No.
      Record whether the runtime was naturally absent or made unavailable only to this process.
- [ ] Connect to a production database, read the schema, lay it out, save, reopen, refresh and
      export to PDF and HTML.
- [ ] Open a project saved by the previous release and refresh it with the same login: the review
      reports no schema change other than any index aligned with a partitioned table, listed as
      changed because its key columns no longer start with the partitioning column, shows one
      "Index and constraint state" line with a count under "Recorded for the first time" and
      offers to update the project. Apply, save, reopen the file and check that its header says
      `formatVersion` 3 and `minReaderVersion` 2.
- [x] Open a format-3 project saved by the downloaded 1.2.0 executable in the published 1.1.0
      executable: it opens read-only and names 1.2.0 as the writer; the diagram and HTML/PDF
      exports work, Save and Refresh are disabled including shortcuts, and the input file is
      unchanged.
- [ ] Connect with a login that lacks `VIEW DEFINITION` (for example a `db_datareader` member):
      the connection dialog warns before reading, the status bar shows the access chip, the
      access report opens with Ctrl+Shift+A and Copy GRANT script puts the script on the
      clipboard.
- [ ] Read a database with views: the entities panel shows Tables and Views sections, and views
      carry the VIEW label on the canvas and in the SVG, PDF and HTML exports.
- [ ] Back up the application's `preferences.json` before each application test and restore it
      afterwards. Read `SchemaCraftCode` as owner and reader in both languages and themes, with
      both code options on and off. Check the two progress stages, code-only schemas, separate
      access-report rows and saved `programmability` states; time a stress inspection.
- [ ] In Objects and the palette, inspect a procedure, function, trigger and view, then select a
      card and the empty canvas. Check heading focus, Escape, 200-row paging and partial-access
      footers. Check all definition states, local find, exact-text copying and the remembered
      wrap preference in both languages and themes. Time a search across 600 procedures and
      scroll a synthetic 10,000-line definition in the real app.
- [ ] Refresh a 1.1 project with code enabled: only aggregate first-capture lines appear for
      code and "Update project" is offered. Apply the code-change fixture and verify altered
      bodies, trigger state/order, view check option, a removed function and an added procedure,
      with no change for a line-ending-only recreation. Read owner to reader and back: no false
      removals, retained dates, then now-available objects/texts. Turn options off and check
      counted exclusions. Deny the module catalog read: tables still refresh, saved code is kept
      and the review reports the failure. Save, reopen and inspect the diagnostic log for counts
      and timings without SQL or private names.
- [ ] Open the Inspector with Ctrl+I on a selected table, follow the selection to another one,
      resize the panel and restart the application: it remembers the width.
- [ ] Select a table with `CHECK` constraints and foreign keys, in English and in Spanish: the
      Inspector and the HTML export read its rules as sentences, pointing at a rule highlights
      its columns and relationship, and Show SQL opens its definition. The PDF and PNG exports
      draw the same relationship markers as the canvas, the zero-or-one circles included.
- [ ] Read a database with a unique constraint whose index is disabled, a filtered unique index,
      an enabled unique index without a filter and a foreign key added `WITH NOCHECK` (the
      `SchemaCraftCheckForms` database of the integration tests has all four), in English and in
      Spanish and in both themes. The disabled constraint carries the disabled badge and its key
      draws a crow's foot and names the index as the reason; the filtered index carries the
      filtered badge and its key draws a crow's foot and reads "at most one of the rows in … that
      the filter of the unique index … selects", never "at most one row in …"; the enabled
      unfiltered index draws the one-to-one marker; the untrusted key carries "not trusted" in a
      neutral tone, says that the rows already there may not follow it, words its rule about the
      referencing rows under "When a row is inserted or its ParentCode is changed:", its rules
      about the referenced table after it, and scripts `WITH NOCHECK` in Show SQL. The HTML export
      says the same, and the PDF and PNG draw the same markers.
- [ ] Open the HTML export in a browser on a machine without SchemaCraft.
- [x] Open the downloaded executable's standalone HTML export in an external browser on the
      validation machine: table, view and trigger details work, module Definition says
      "Not included in this file", and module source is absent. Inspect PDF and PNG output.
- [ ] In the real app, check trigger badges at all three detail levels and 30% zoom. Export SVG,
      PDF, PNG and HTML in both themes and languages; compare the canvas with SVG, open HTML in
      Edge, and check solid/dashed badges in a grayscale PDF print preview. A 1.1 project must
      say triggers were not read until refreshed. No exported module body or routine object may
      be present; HTML may name only triggers whose parents are on the diagram.
- [ ] Install and uninstall under a standard account without an administrative token; verify
      per-user registration, removal of installed files and preservation of synthetic data.
- [ ] On Windows 10/11 with UAC enabled, check that the installer and uninstaller require no
      administrator prompt or credentials. A hosted image with UAC disabled does not close this
      interactive check.
- [ ] The release notes describe the program, link the code signing policy and carry the
      version's `CHANGELOG.md` entry.

## Known limitations of 1.2.0

- Release binaries remain unsigned pending the signing workflow. SmartScreen may warn and
  Smart App Control may block execution. Microsoft Edge WebView2 is required; it is not bundled
  with either the portable executable or the installer.
- SchemaCraft 1.1 opens projects saved by 1.2 read-only, without the code of views, procedures,
  functions and triggers, and cannot save or refresh them; SchemaCraft 1.0 refuses them. Keep a
  copy of a project that must still be edited in 1.1.
- Only clustered and nonclustered indexes are read. A hash index of a memory-optimized table is
  not listed, nor is the primary key or unique constraint it backs, so such a table can show no
  primary key and a foreign key the hash index would make one-to-one draws a crow's foot. Reading
  hash indexes moves to 1.3.
- NOT FOR REPLICATION on `CHECK` constraints and foreign keys is not read. SQL Server never trusts
  such a rule, so it shows "not trusted". Its sentences do not say that writes by replication
  agents skip it, and its scripted SQL omits NOT FOR REPLICATION. Reading it moves to 1.3.
- Code comparison normalizes line endings, trailing spaces/tabs and empty edge lines without
  parsing SQL. The project preserves the original code, but the review is not a semantic SQL
  comparison. Database/server DDL triggers, synonyms, dependencies and descriptions are outside
  this scope.
- Exports deliberately exclude module SQL and routine objects. HTML includes trigger metadata
  only for visible parent tables and views; module definitions remain in the project and app.
- The layered-layout limitation from 1.1 remains: an edge spanning several layers can pass
  behind an intermediate table (ADR-022).

## Known limitations of 1.1.0

- The executable is unsigned: SmartScreen shows "Windows protected your PC" on the first launch
  (More info, then Run anyway), and machines with Smart App Control enforced may refuse it.
- The WebView2 runtime is required. Windows 11 and updated Windows 10 already have it.
- SchemaCraft 1.0 refuses projects saved by 1.1, saying they were written by a newer version;
  keep a copy of a project that must still open in 1.0.
- A `CHECK` constraint outside the forms SchemaCraft reads shows its SQL instead of a sentence.
- A unique constraint or a nonclustered primary key whose index is disabled still makes a
  foreign key read "at most one" and draw the one-to-one marker, because the snapshot does not
  record whether an index is disabled (ADR-039). Fixed in 1.2.0, which records index state.
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

### Release 1.2.0 measurements

Measured on 2026-10-19 from the full optimized release build: feature source `4cbe00b` plus the
1.2.0 manifest and lockfile changes. The executable reports 1.2.0 in About and Windows file
metadata. These are local candidate measurements, not sizes or timings of future CI assets.
Both startup samples are subsequent launches on the development machine, not cold starts.

| Measurement                              | 1.2.0          |
| ---------------------------------------- | -------------- |
| Portable executable, bytes               | 12,938,240     |
| NSIS installer, bytes                    | 5,262,398      |
| Start until the window page is reachable | 533.1–535.4 ms |
| Welcome page `DOMContentLoaded`          | 34.2–36.7 ms   |

The stress fixture and both code options match the development measurements below. Inspection
response time was measured in the real application from the start of the inspection request
until its response arrived: it includes Rust and IPC transport, but excludes response parsing,
project initialization and diagram rendering. It is not an end-to-end capture time. Diagnostic
bytes are those added by each complete application session, not the shared daily file size.

| Measurement                               | SQL Server 2022 (16.0.4305.5) | SQL Server 2019 (15.0.4500.2) |
| ----------------------------------------- | ----------------------------- | ----------------------------- |
| Stress inspection response                | 210.6 ms                      | 248.2 ms                      |
| Serialized snapshot with code, bytes      | 3,156,304                     | 3,156,304                     |
| Saved stress project, bytes               | 4,430,274                     | 4,430,274                     |
| Diagnostic log bytes added by the session | 5,306                         | 5,308                         |

### Downloaded release assets verification, 2026-10-19

The [release workflow run](https://github.com/jmanuelsoberano/schemacraft/actions/runs/39310361788)
completed successfully for `v1.2.0`, whose source commit is
`2a659adf62dff78fa15cc1165b786499f9dc1016`. Both files were downloaded from the unpublished
release and matched its `SHA256SUMS.txt`. Their Windows file metadata reports 1.2.0; both are
unsigned. These are the CI-built assets, not the local candidate measured above.

| Downloaded asset                           | Bytes      | SHA-256                                                            |
| ------------------------------------------ | ---------- | ------------------------------------------------------------------ |
| `schemacraft-v1.2.0-windows-x64.exe`       | 12,921,344 | `765dd024aeb87b8536ebf40b62f8d1a3faaee64a8133ca892ceed584ad08b033` |
| `schemacraft-v1.2.0-windows-x64-setup.exe` | 5,262,873  | `dbd7616eda81f03683b81fec5fa7799d685a965b4b9c9bded0dd716208bb69ac` |

The downloaded portable passed 75 application checks on each of SQL Server 2022 (16.0.4305.5)
and SQL Server 2019 (15.0.4500.2), using SQL logins, the embedded production frontend and actual
Rust commands. The sessions covered exact About version, reload protection, capture, procedure
parameters and source, table-function returns, trigger and view details, save/reopen, unchanged
refresh, SVG/PDF/PNG/HTML exports, English/light and Spanish/dark. Each stress capture contained
200 tables, 20 views, 750 routines, 200 triggers and 970 readable definitions.

| Downloaded executable measurement         | SQL Server 2022 | SQL Server 2019 |
| ----------------------------------------- | --------------- | --------------- |
| Stress inspection response                | 179.0 ms        | 221.8 ms        |
| Serialized snapshot with code, bytes      | 3,156,304       | 3,156,304       |
| Saved stress project, bytes               | 4,430,274       | 4,430,274       |
| Diagnostic log bytes added by the session | 5,309           | 5,302           |

Response timing includes Rust and IPC transport but excludes response parsing, project
initialization and rendering; it is not end-to-end capture time. PDF and PNG were inspected
visually. The standalone HTML opened in an external browser and displayed table, view and
trigger details, with module Definition marked "Not included in this file" and module source
excluded.

The published 1.1.0 executable passed 18 checks with a project saved by the downloaded 1.2.0
binary: read-only opening, the newer writer identified, Save and Refresh disabled including
shortcuts, and successful PDF/HTML exports. The input remained byte-identical. All three
application sessions confirmed process termination before restoring preferences byte for byte.
Hosted clean-environment verification, Windows Authentication, unavailable-runtime behavior and
installer execution remain pending; the release remains unpublished.

### Local release candidate verification, 2026-10-19

The optimized 1.2.0 executable passed 75 application checks against each SQL Server engine,
using its embedded production frontend and real Rust commands. The sessions covered startup,
About, the reload guard, capture, procedure parameters and source, table-function returns,
trigger and view details, save/reopen, unchanged refresh, SVG/PDF/PNG/HTML exports, English/light,
Spanish/dark and the full stress fixture. PDF output and application screenshots were inspected;
the standalone HTML was opened in a separate browser and its table and trigger details checked.
Each stress capture contained 200 tables, 20 views, 750 routines, 200 triggers and 970 readable
definitions. Diagnostic output contained no SQL, passwords or fixture identifiers.

The published 1.1.0 executable, verified against its release checksum, passed 18 checks with a
project saved by this candidate. It opened read-only, named 1.2.0 as the writer, disabled Save
and Refresh including their shortcuts, and exported PDF and HTML. The input project remained
byte-identical. Every application session backed up preferences, confirmed process termination
and restored the original preferences byte for byte.

Rust formatting, Clippy, two workspace test runs (351 core and 24 host tests), unchanged generated
contracts, frontend formatting, lint, type checking, 817 tests, documentation checks and matching
PRD copies passed. All 64 SQL integration tests passed on each required engine. The full release
build produced the executable and NSIS installer, and release-note extraction passed. The feature
PR's Windows and SQL Server CI jobs passed on `4cbe00b`. These local-candidate checks preceded
the release PR, tag and downloaded-asset verification recorded above. Installer execution and
clean-machine checks remain publication gates.

### Code capture and refresh verification, 2026-10-19

Measured with the 1.2 development debug build against local SQL Server containers. The stress
fixture has 200 tables, 200 DML triggers, 600 procedures, 100 scalar functions, 50 inline table
functions and 20 views, with both code options enabled.

| Measurement          | SQL Server 2022 (16.0.4305.5) | SQL Server 2019 (15.0.4500.2) |
| -------------------- | ----------------------------- | ----------------------------- |
| Core inspection      | 542.2225 ms                   | 541.4735 ms                   |
| Serialized snapshot  | 3,156,304 bytes               | 3,156,304 bytes               |
| Readable module text | 2,028,740 characters          | 2,028,740 characters          |

Two stress captures in the real application took **690.7818–1,078.5906 ms** on SQL Server 2022.
This includes capture, IPC and project initialization; it is not a backend-only measurement.
All measurements stay within the five-second inspection budget.

Two real-application sessions verified capture and refresh in English/light and Spanish/dark:
code options, counted stages, code-only schemas, access-report rows, a format-2 first capture,
weaker and stronger permissions, a failed module query, opt-out saved and reopened, and changes
saved and reopened. Both sessions were repeated after visual corrections and passed again.
The diagnostic output contained neither module SQL, passwords nor fixture identifiers (server,
login, database, object or path). Each
session backed up preferences, confirmed that the test process had terminated and restored the
original preferences byte for byte. This is acceptance evidence for code capture and refresh;
the release-publication checks above remain open until the full 1.2 release is ready.

### Objects and code viewer verification, 2026-10-19

The 1.2 debug executable was checked in English/light and Spanish/dark against SQL Server 2022
with owner, reader and schema-scoped VIEW DEFINITION logins. Keyboard navigation covered routine
rows, the palette, trigger-to-parent focus, cards, the empty canvas and a hidden entity revealed
from the palette. Parameters, scalar and table returns, view code, trigger notes, encrypted and
unavailable code, omitted definitions and saved unverified definitions were checked. The preview
fixture supplied CLR and a 2,000-line source through the same desktop Inspector.

Local find, F3/Shift+F3, both Escape steps, code-only selection and global F1/F5/Ctrl+K/Ctrl+I
passed. Copy code matched the stored CRLF text and trailing spaces exactly through the system
clipboard. Context-menu and text-drag events remain available in the source surface. The wrap
preference survived switching modules. Pages grew from 200 to 400 rows and focused the first
new row; a broad search stayed capped at 200 with a refinement hint.

After avoiding a redundant render of the old results during urgent input updates, five real
keystrokes filtering the 600-procedure stress fixture took **45.3–68.8 ms** from keydown to two
animation frames after the new results appeared, below the 100 ms budget. Scrolling a synthetic
10,000-line procedure reached the last line with **13.6 ms average / 22.3 ms maximum** between
frames (acceptance bounds: average below 20 ms and maximum below 50 ms). These are local debug
measurements, not release-wide performance guarantees.

Both final scenarios passed. Every run backed up preferences, confirmed process termination
and restored the original bytes. Logs contained no SQL, passwords or fixture identifiers. Rust
and SQL gates were repeated against SQL Server 2022 and 2019; frontend tests, documentation checks
and the two matching PRD copies also passed. The publication checklist remains open.

### Trigger details and export verification, 2026-10-19

The real debug application read the local SchemaCraftCode fixture and displayed four parent
badges: enabled, mixed, INSTEAD OF and an isolated disabled test trigger. Counts remained present
in compact, keys and full levels and at 30% zoom. Open trigger reached the source page and moved
focus to its heading; Escape returned to the parent card. Views showed one Definition section,
WITH CHECK OPTION and indexed-view settings as applicable.

The application produced SVG, PDF, PNG and HTML for English and Spanish in both light and dark
themes (16 files). SVG and raster output retained the canvas layout, neutral badges and distinct
solid/dashed outlines. HTML opened independently in Microsoft Edge in English/light and
Spanish/dark, with trigger events and Definition marked as excluded. The file scan found the
visible test trigger name but neither its body sentinel nor the procedure name; hiding its
parent removed that trigger name too. Embedded definitions carried no text and routines were
empty. A format-2 project exported the unread-trigger note before refresh and badges afterward.

Every application run confirmed process termination before restoring the original preferences
byte for byte. Rust formatting, Clippy, two workspace test runs and unchanged generated contracts
passed. All 63 SQL tests passed on each of SQL Server 2022 and 2019 with required servers. The
frontend passed 807 tests, formatting, lint, type checking and the production build; documentation
checks and matching PRD copies passed. Review corrections preserve the oldest relevant trigger
read date and avoid saying none beside retained rows; HTML does not substitute a parent date for
an omitted code history. Manual grayscale print-preview verification confirmed that the dashed
badge on app.OrderLines remains distinct from the solid badges on app.Orders and app.OrderAudit.

### Qualified identifier regression verification, 2026-10-19

The real debug application captured a dedicated synthetic fixture on both SQL Server 2022 and 2019. `[a.b].c` and `a.[b.c]`, their corresponding views, same-named foreign keys and triggers
remained distinct. The Inspector, palette, raw and delimited searches, context menu, hide/show,
undo/redo, card dragging, save/reopen and a selective database refresh passed. Each object's
columns, code, position and hidden state remained with its exact qualified name. English/light
and Spanish/dark output was inspected; both sessions restored preferences byte for byte after
confirmed process termination and reverted the temporary fixture change.

Both sessions exported SVG, PDF, PNG and HTML. Hiding either side omitted only that side and its
trigger metadata, without module code or routines. PDF and PNG output was inspected visually;
the standalone HTML opened outside the application, found both delimited names separately and
showed their correct columns and firing timing. Existing structured project names need no
migration. Previously overwritten layout choices cannot be recovered.

Rust formatting, Clippy, two workspace test runs (351 core and 24 host tests), unchanged generated
contracts and the debug build passed. All 64 SQL tests passed on each required engine, including
the new identifier capture and schema-filter regression. Frontend formatting, lint, type checking,
817 tests, production build, architecture checks and matching PRD copies passed. Independent
reviews also checked opaque-key isolation, accessible relation labels and hidden-object export
filtering. Release-publication checks remain open.
