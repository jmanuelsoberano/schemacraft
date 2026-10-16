# SchemaCraft

Desktop CASE tool for database reverse engineering and entity-relationship diagram (ERD)
visualisation, built with Tauri 2, Rust and React. It connects to Microsoft SQL Server, extracts
the schema, keeps it in a portable `.scraft` project so the database is never queried twice for
the same diagram, and renders fast, interactive diagrams with high-fidelity single-page exports.

![SchemaCraft showing a sales schema at the Keys detail level](docs/images/canvas-keys-light.png)

## Features

- **Reverse engineering of SQL Server.** Tables, views, columns and types, primary and foreign
  keys, indexes and check constraints, with SQL Server or Windows Authentication over encrypted
  connections.
- **Honest with limited logins.** A login that sees only part of a database gets everything it
  can read, with what it cannot read marked as not available, never as missing, and an access
  report that names the cause and the one grant that would complete the schema.
- **Portable projects.** A `.scraft` file keeps the schema and the diagram, reopens without a
  database and refreshes from it with a reviewed diff that keeps your layout.
- **Interactive diagrams.** Entity cards at three detail levels, views told apart from tables by
  label, icon and colour, an entities panel with schema and kind sections, crow's foot
  relationships, layered, organic and radial layouts, isolation of a table with its neighbours,
  undo and redo, and a command palette.
- **Exports.** SVG with selectable text, a self-contained interactive HTML viewer, single-page
  PDF and PNG at 1x, 2x and 4x, all drawn by one renderer with bundled fonts.
- **Desktop quality.** English and Spanish, light and dark themes, keyboard access throughout, a
  portable executable of about 12 MB and a per-user installer.

## Download

Grab the latest release from the
[releases page](https://github.com/jmanuelsoberano/schemacraft/releases):

- `schemacraft-vX.Y.Z-windows-x64.exe`: the portable executable; nothing to install.
- `schemacraft-vX.Y.Z-windows-x64-setup.exe`: the per-user installer, which adds a Start menu
  entry and needs no administrator rights.
- `SHA256SUMS.txt`: checksums of both files.

Both need the Microsoft Edge WebView2 runtime, which Windows 11 and updated Windows 10 already
have; when it is missing, SchemaCraft says so and offers the download page. Releases are not
code-signed yet (see the code signing policy below), so SmartScreen shows a warning on the
first launch (More info, then Run anyway), and a PC with Smart App Control turned on refuses
unsigned executables.

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

The application to SignPath Foundation is under review; until it is approved, release files are
not signed.

- Committers and reviewers: [Manuel Soberano](https://github.com/jmanuelsoberano)
- Approvers: [Manuel Soberano](https://github.com/jmanuelsoberano)

The project has one maintainer, who holds every role. Changes reach `main` only through pull
requests that pass the required CI checks; the branch rules have no bypass list. On 2026-10-14
the history of `main` was rewritten once, with the branch rules paused for that push, to
replace the author email of earlier commits; no file changed, and pull requests #1 and #2 still
show the original commits. Contributions from others are reviewed with particular attention to
build scripts and workflows, and every signing request is approved by the maintainer.

Only the files that the release workflow builds from this repository are signed: the portable
executable and the installer attached to each GitHub release.

### Privacy policy

This program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it.

SchemaCraft has no telemetry and no update check. It connects only to the SQL Server the user
specifies, and it opens Microsoft's WebView2 download page only when the user asks. Its
interface runs in the Microsoft Edge WebView2 runtime that Windows provides, whose diagnostic
data is covered by the [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement)
and follows the Windows diagnostic data setting.

## Stack

- **Core:** Rust (`crates/schemacraft-core`), `serde`, `ts-rs`, `tiberius` with a `bb8` pool for
  SQL Server.
- **Host:** Tauri 2 (`src-tauri`), `tracing`.
- **Frontend:** React 19, TypeScript, Vite, React Flow, Radix primitives, Lucide icons, Zustand.
- **Quality:** Clippy with panic-free lints, rustfmt, ESLint (type-checked), Prettier, Vitest,
  GitHub Actions on Windows.

## Prerequisites

- Windows 10/11 with the WebView2 runtime (included in Windows 11).
- [Rust](https://rustup.rs) through rustup, which installs the toolchain pinned in
  `rust-toolchain.toml` (1.99.0, MSVC), plus the Microsoft C++ Build Tools.
- [Node.js](https://nodejs.org) 24 or newer with npm.

## Getting started

```bash
npm install
```

```bash
npm run tauri dev
```

The first Rust build takes a few minutes; later builds are incremental.

To produce the portable executable and the NSIS installer:

```bash
npm run tauri build
```

The portable binary is written to `target/release/schemacraft.exe` and the installer to
`target/release/bundle/nsis/`.

## Distribution

Every tag `vX.Y.Z` builds the assets listed under Download, smoke-tests the real executable and
publishes a draft GitHub release. [docs/release-checklist.md](docs/release-checklist.md) lists
what CI verifies and what is checked by hand before the draft is published. To cut a release: set
the version in `package.json` and `Cargo.toml`, add the entry to `CHANGELOG.md`, merge that
change into `main` through a pull request, then tag the merge commit `vX.Y.Z` and push the tag;
the release workflow refuses a tag that is not on `main`.

## Scripts

| Command                                                 | Purpose                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `npm run tauri dev`                                     | Run the desktop application with hot reload                |
| `npm run tauri build`                                   | Build the portable executable and the installer            |
| `npm run typecheck`                                     | Type-check the frontend                                    |
| `npm run lint`                                          | Lint the frontend with type-aware rules                    |
| `npm test`                                              | Run frontend unit tests                                    |
| `npm run format`                                        | Format the repository with Prettier                        |
| `npm run contracts`                                     | Regenerate TypeScript types from the Rust model            |
| `npm run contracts:check`                               | Fail if the generated TypeScript types are out of date     |
| `cargo test --workspace`                                | Run Rust tests (also regenerates the TypeScript contracts) |
| `cargo clippy --workspace --all-targets -- -D warnings` | Lint Rust with the project's strict rules                  |
| `node scripts/prepare-fonts.mjs`                        | Regenerate the TTF fonts bundled by the export renderer    |
| `node scripts/smoke-test-release.mjs <exe> [dir]`       | Start a release build and check its first screens          |

The smoke test sets `SCHEMACRAFT_REMOTE_DEBUGGING_PORT`, which makes any build of the application
open a Chrome DevTools Protocol port on localhost, so a script can drive the real executable.

## Integration tests against SQL Server

The core crate has integration tests that run against a real SQL Server 2022. They are skipped
unless the `SCHEMACRAFT_TEST_MSSQL_*` variables are set. With Docker Desktop running:

```powershell
.\scripts\dev-sqlserver.ps1 start
```

```powershell
.\scripts\dev-sqlserver.ps1 env | Invoke-Expression
```

```powershell
cargo test -p schemacraft-core --test sqlserver_integration --test sqlserver_permissions -- --nocapture
```

`sqlserver_integration` seeds two databases on the container: a fixture covering keys, indexes,
constraints, alias types and views, and a 200-table database used to check the extraction time
budget. `sqlserver_permissions` seeds a database of its own plus an empty one and reads them as
low-privilege logins: `db_owner`, `db_datareader`, `VIEW DEFINITION` only, a reader with the
`VIEW DEFINITION` of one schema, `SELECT` on two tables, `CONNECT` only, two variants of a
schema `DENY` and a column `DENY`. It creates these server logins itself, with the
`schemacraft_` prefix and a password made up for each run, so run it only against a disposable
server such as this container. Windows Authentication cannot run in the Linux container; it is
validated manually against a Windows instance.

## Browser preview

`npm run dev` serves the frontend alone. Outside the desktop runtime simulated backends take
the place of the Rust commands, so the flows can be reviewed in a browser: use `localhost` to
connect, or `auth-fail`, `cert-fail`, `down` and `slow` as server names to see each failure. A
server name that contains `partial`, `nothing` or `empty` (for example `partial.example.com`)
connects as a login that sees part of the schema, no table or view, or an empty database.
Projects are kept in memory (open returns the last saved project or a sample), the history is
seeded with two connections, and the recent projects include samples read with full and with
partial access, an upgraded 1.0 file and a file from a newer version, which opens read-only.
Refresh shows a fabricated review with every kind of change, or, when the login sees more or
less than before, what appeared, what disappeared and what could not be checked.

## Project files and preferences

A `.scraft` file is pretty-printed JSON: a header with the format version, the oldest format a
reader needs (`minReaderVersion`) and the save time, the connection without its password, the
inspection options, the full snapshot and the diagram state. The snapshot also records what the
login that read it could see: its permissions in that database, including the name of its
database user, and the list of facts kept from an earlier read that it could not check. Exports
leave out both records; the tables, views, texts and relationships kept from an earlier read are
drawn and embedded like any other object on the diagram, without a mark. A project reopens
without a database; refresh reconnects through the connection dialog and shows the differences
before applying them, keeping the positions of surviving tables.

SchemaCraft 1.1 saves projects in format 2. It opens 1.0 projects and converts them when they
are saved, after which SchemaCraft 1.0 can no longer open them. A project saved by a newer
version opens read-only when that version allows it: it can be rearranged and exported, but not
saved or refreshed. Data this version does not understand is kept as it is when a project is
saved.

Recent connections (never passwords) and recent projects are stored in `preferences.json`
inside the per-user configuration directory, `%APPDATA%\com.jmanuelsoberano.schemacraft` on
Windows. Delete the file to clear the history and the recent projects.

The interface also keeps two conveniences in the WebView2 local storage, under
`%LOCALAPPDATA%\com.jmanuelsoberano.schemacraft`; neither holds a secret:

- `schemacraft.settings`: the theme, the language, the entities panel's state and width, and the
  partial-access notices you closed.
- `schemacraft.connection`: the last connection form. The password is always blank; the server,
  login, database, schemas, encryption and certificate choice are kept.

Deleting `preferences.json` clears neither. Deleting the WebView2 data in that folder, with
SchemaCraft closed, resets both: the default theme and language return, closed notices show
again and the connection form starts empty, while the history, the recent projects and the
remembered passwords stay.

"Remember password" keeps a SQL login's password in the Windows Credential Manager (entries named
`sqlserver://<server>/<login>` under the `SchemaCraft` service) and never in any SchemaCraft file.
The history and a reopened project use it without asking; untick the box and connect again to
forget it, or remove the entry from the Credential Manager.

## Logins with limited permissions

SchemaCraft reads only the catalog, with the permissions of the login you connect with. When
you choose a database it checks what that login can see and, if that is not everything, says so
before reading anything. A login that sees part of the schema, for example a member of
`db_datareader`, still gets
everything it can read: `CHECK` and `DEFAULT` expressions it cannot read show as "not
available", foreign keys to tables it cannot see are kept, and the status bar opens an access
report with the cause and a script a DBA can run, with the database and the login's database
user filled in:

```sql
USE [Sales];
GRANT VIEW DEFINITION TO [reporting];
```

`VIEW DEFINITION` gives no access to data and allows no change; on SQL Server 2022 and later it
also shows users, roles and permissions. SchemaCraft only copies the script and does not offer
it when an explicit `DENY` is the cause, because a grant does not lift a denial. A login that
sees no table or view at all is told so and cannot start a read. Refreshing a project with a
login that sees less never removes what it cannot see: those items are kept and listed as not
checked.

## Project structure

```
crates/schemacraft-core/   domain model, inspectors, project files, diff engine, export (no Tauri)
src-tauri/                 Tauri host: IPC commands, configuration, icons
src/app/                   application shell, actions, brand, global styles
src/features/              connection, project, canvas, export and other features
src/shared/                contracts, i18n, ipc, settings, ui primitives
src/viewer/                standalone viewer embedded in exported HTML files
assets/brand/              source artwork for the application icon
docs/                      PRD, architecture decisions, UX principles
```

## Documentation

- [Product requirements (PRD)](docs/PRD_SchemaCraft_v1.md)
- [Architecture page](https://jmanuelsoberano.github.io/schemacraft/architecture/): layers,
  components, data, flows and how to add a feature
- [Architecture decision records](docs/architecture.md)
- [UX principles and definition of done](docs/ux-principles.md)
- [Changelog](CHANGELOG.md)

## Contributing

Issues and pull requests are welcome; [CONTRIBUTING.md](CONTRIBUTING.md) explains the setup,
the quality gates and the conventions. Security problems go through [SECURITY.md](SECURITY.md).

## Author

Developed by Manuel Soberano.

## Acknowledgements

The canvas is built on [React Flow](https://reactflow.dev), with layouts by
[ELK](https://eclipse.dev/elk/) and [d3-force](https://d3js.org). UI primitives come from
[Radix](https://www.radix-ui.com) and icons from [Lucide](https://lucide.dev). Exports are
rendered with [resvg](https://github.com/linebender/resvg) and
[svg2pdf](https://github.com/typst/svg2pdf), and the bundled fonts are
[Inter](https://rsms.me/inter/) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/), both
under the SIL Open Font License 1.1.

## License

SchemaCraft is free software, licensed under the
[GNU Affero General Public License, version 3](LICENSE). You may use, study, share and modify
it; if you distribute a modified version, or run one as a network service, you must offer its
source under the same license.
