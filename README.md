# SchemaCraft

Desktop CASE tool for database reverse engineering and entity-relationship diagram (ERD)
visualisation, built with Tauri 2, Rust and React. It connects to Microsoft SQL Server, extracts
the schema, keeps it in a portable `.scraft` project so the database is never queried twice for
the same diagram, and renders fast, interactive diagrams with high-fidelity single-page exports.

## Status

Milestone 1 of 6 is complete: Rust workspace, domain model, Tauri host, application shell with
design system, bilingual UI (English and Spanish), light and dark themes, tooling and CI.

| Milestone | Scope                                                       |
| --------- | ----------------------------------------------------------- |
| 1 ✅      | Project bootstrap, domain model, application shell          |
| 2         | SQL Server inspector (SQL and Windows authentication)       |
| 3         | `.scraft` project files and schema diff ("refresh from DB") |
| 4         | Canvas: table nodes, relationships, layouts, detail levels  |
| 5         | Export: SVG, standalone interactive HTML, single-page PDF   |
| 6         | Portable `schemacraft.exe` validation and packaging         |

## Stack

- **Core:** Rust (`crates/schemacraft-core`), `serde`, `ts-rs`; SQL Server access with `tiberius`
  from milestone 2.
- **Host:** Tauri 2 (`src-tauri`), `tracing`.
- **Frontend:** React 19, TypeScript, Vite, React Flow, Radix primitives, Lucide icons, Zustand.
- **Quality:** Clippy with panic-free lints, rustfmt, ESLint (type-checked), Prettier, Vitest,
  GitHub Actions on Windows.

## Prerequisites

- Windows 10/11 with the WebView2 runtime (included in Windows 11).
- [Rust](https://rustup.rs) stable (1.90 or newer) with the MSVC toolchain and the
  Microsoft C++ Build Tools.
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

## Project structure

```
crates/schemacraft-core/   domain model, inspectors, project files, diff engine (no Tauri)
src-tauri/                 Tauri host: IPC commands, configuration, icons
src/app/                   application shell, actions, brand, global styles
src/shared/                contracts, i18n, ipc, settings, ui primitives
assets/brand/              source artwork for the application icon
docs/                      PRD, architecture decisions, UX principles
```

## Documentation

- [Product requirements (PRD)](docs/PRD_SchemaCraft_v1.md)
- [Architecture and decision records](docs/architecture.md)
- [UX principles and definition of done](docs/ux-principles.md)

## Acknowledgements

The canvas is built on [React Flow](https://reactflow.dev) (MIT), with layouts by
[ELK](https://eclipse.dev/elk/) and [d3-force](https://d3js.org). UI primitives come from
[Radix](https://www.radix-ui.com) and icons from [Lucide](https://lucide.dev).
