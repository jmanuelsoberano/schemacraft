# SchemaCraft

Desktop CASE tool for database reverse engineering and entity-relationship diagram (ERD)
visualisation, built with Tauri 2, Rust and React. It connects to Microsoft SQL Server, extracts
the schema, keeps it in a portable `.scraft` project so the database is never queried twice for
the same diagram, and renders fast, interactive diagrams with high-fidelity single-page exports.

## Status

Milestones 1 to 5 of 6 are complete: Rust workspace, domain model, Tauri host, application
shell with design system, bilingual UI (English and Spanish), light and dark themes, tooling and
CI; the SQL Server inspector with SQL Server and Windows Authentication, the connection dialog
with actionable errors and progress, and the entities panel listing the loaded schema; then
`.scraft` project files with open, save and recent projects, refresh from database with a
reviewed diff that keeps diagram positions, and a history of recent connections; then the
canvas: entity cards with three detail levels, crow's foot relationships, layered, organic and
radial layouts, isolation of a table with its neighbours, undo and redo, and a command palette;
and the exports: SVG with selectable text, a self-contained interactive HTML viewer,
single-page PDF and PNG at 1x, 2x and 4x, all drawn by one renderer with bundled fonts.

| Milestone | Scope                                                       |
| --------- | ----------------------------------------------------------- |
| 1 ✅      | Project bootstrap, domain model, application shell          |
| 2 ✅      | SQL Server inspector, connection dialog, entities panel     |
| 3 ✅      | `.scraft` project files and schema diff ("refresh from DB") |
| 4 ✅      | Canvas: table nodes, relationships, layouts, detail levels  |
| 5 ✅      | Export: SVG, standalone interactive HTML, single-page PDF   |
| 6         | Portable `schemacraft.exe` validation and packaging         |

## Stack

- **Core:** Rust (`crates/schemacraft-core`), `serde`, `ts-rs`, `tiberius` with a `bb8` pool for
  SQL Server.
- **Host:** Tauri 2 (`src-tauri`), `tracing`.
- **Frontend:** React 19, TypeScript, Vite, React Flow, Radix primitives, Lucide icons, Zustand.
- **Quality:** Clippy with panic-free lints, rustfmt, ESLint (type-checked), Prettier, Vitest,
  GitHub Actions on Windows.

## Prerequisites

- Windows 10/11 with the WebView2 runtime (included in Windows 11).
- [Rust](https://rustup.rs) stable (1.90 or newer) with the MSVC toolchain and the
  Microsoft C++ Build Tools.
- [Node.js](https://nodejs.org) 24 or newer with npm.

Release builds are not code-signed yet. Windows machines with Smart App Control enforced refuse
to launch unsigned executables; signing is scheduled for milestone 6 (see the architecture notes).

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
cargo test -p schemacraft-core --test sqlserver_integration -- --nocapture
```

The tests seed two databases on the container: a fixture covering keys, indexes, constraints,
alias types and views, and a 200-table database used to check the extraction time budget.
Windows Authentication cannot run in the Linux container; it is validated manually against a
Windows instance.

## Browser preview

`npm run dev` serves the frontend alone. Outside the desktop runtime simulated backends take
the place of the Rust commands, so the flows can be reviewed in a browser: use `localhost` to
connect, or `auth-fail`, `cert-fail`, `down` and `slow` as server names to see each failure.
Projects are kept in memory (open returns the last saved project or a sample), the history is
seeded with two connections, and refresh shows a fabricated review with every kind of change.

## Project files and preferences

A `.scraft` file is pretty-printed JSON: a header with the format version and the save time,
the connection without its password, the inspection options, the full snapshot and the diagram
state. It reopens without a database; refresh reconnects through the connection dialog and
shows the differences before applying them, keeping the positions of surviving tables.

Recent connections (never passwords) and recent projects are stored in `preferences.json`
inside the per-user configuration directory, `%APPDATA%\com.jmanuelsoberano.schemacraft` on
Windows. Delete the file to clear the history.

"Remember password" keeps a SQL login's password in the Windows Credential Manager (entries named
`sqlserver://<server>/<login>` under the `SchemaCraft` service) and never in any SchemaCraft file.
The history and a reopened project use it without asking; untick the box and connect again to
forget it, or remove the entry from the Credential Manager.

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
- [Architecture and decision records](docs/architecture.md)
- [UX principles and definition of done](docs/ux-principles.md)

## Author

Developed by Manuel Soberano.

## Acknowledgements

The canvas is built on [React Flow](https://reactflow.dev) (MIT), with layouts by
[ELK](https://eclipse.dev/elk/) and [d3-force](https://d3js.org). UI primitives come from
[Radix](https://www.radix-ui.com) and icons from [Lucide](https://lucide.dev).
