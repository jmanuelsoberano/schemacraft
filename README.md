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
- **Portable projects.** A `.scraft` file keeps the schema and the diagram, reopens without a
  database and refreshes from it with a reviewed diff that keeps your layout.
- **Interactive diagrams.** Entity cards at three detail levels, crow's foot relationships,
  layered, organic and radial layouts, isolation of a table with its neighbours, undo and redo,
  and a command palette.
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

The project has one maintainer, who holds every role. After the initial commit, every change has
reached `main` through a pull request that passed the required CI checks, and the branch rules
allow no bypass. Contributions from others are reviewed with particular attention to build
scripts and workflows, and every signing request is approved by the maintainer.

Only the files that the release workflow builds from this repository are signed: the portable
executable and the installer attached to each GitHub release.

### Privacy policy

This program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it.

SchemaCraft has no telemetry and no update check. It connects only to the SQL Server the user
specifies, and it opens Microsoft's WebView2 download page only when the user asks.

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
the version in `package.json` and `Cargo.toml`, add the entry to `CHANGELOG.md`, commit, tag
`vX.Y.Z` and push the tag.

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
