# Architecture

SchemaCraft is a Tauri 2 desktop application. A Rust workspace holds the domain core and the
application host; a React frontend renders the diagram. This document records the decisions that
shape the codebase as short architecture decision records (ADRs). Each one states the decision and
the reason; alternatives appear only when they were seriously considered.

The product requirements live in [PRD_SchemaCraft_v1.md](./PRD_SchemaCraft_v1.md) and the user
experience bar in [ux-principles.md](./ux-principles.md).

## Layout

```
schemacraft/
├── crates/schemacraft-core/   Rust library: domain model, inspectors, project files, diff engine
│   ├── src/model/             pure schema types (tables, columns, keys, snapshot)
│   ├── src/inspectors/        DatabaseInspector trait, errors, progress, SQL Server implementation
│   ├── src/project/           .scraft documents, saved connections, canvas state, atomic JSON files
│   ├── src/diff/              comparison of two snapshots behind "refresh from database"
│   ├── src/preferences/       connection history and recent projects (per-user JSON file)
│   └── tests/                 integration tests and SQL fixtures (run against a real server)
├── src-tauri/                 Rust binary: Tauri host, IPC commands, logging, configuration
├── src/                       React + TypeScript frontend
│   ├── app/                   application shell, actions, brand, global styles
│   │   ├── actions/           action registry, keyboard shortcuts, action buttons
│   │   ├── shell/             top bar, entities sidebar, diagram canvas, status bar
│   │   └── styles/            design tokens and base styles
│   ├── features/              one folder per product capability
│   │   ├── connection/        connection dialog, history, flow store, progress, change review
│   │   ├── preferences/       mirror of the preferences file: history and recent projects
│   │   ├── project/           open project store, open/save flows, unsaved-changes guard
│   │   └── schema/            entity list helpers and data type formatting
│   └── shared/                cross-cutting modules
│       ├── contracts/         TypeScript types generated from Rust (ts-rs)
│       ├── i18n/              message catalogues and translation hook
│       ├── ipc/               typed wrappers over Tauri `invoke` and native dialogs; preview backends
│       ├── settings/          persisted preferences (theme, language, layout)
│       └── ui/                accessible UI primitives (Radix based)
├── assets/brand/              source artwork for the application icon
├── scripts/                   developer scripts (SQL Server container for tests)
├── docs/                      PRD, architecture, UX principles
└── .github/workflows/         continuous integration
```

Dependencies only point inwards: `src-tauri` depends on `schemacraft-core`, never the other way
round; the frontend talks to Rust exclusively through IPC commands; `shared/` modules never import
from `app/`.

## Decisions

### ADR-001: Rust workspace with a framework-free core

`crates/schemacraft-core` knows nothing about Tauri, HTTP or any UI. It contains the schema model,
the database inspectors (`DatabaseInspector` strategy), `.scraft` persistence, the diff engine and
the preferences. `src-tauri` is a thin adapter that maps core operations to IPC commands.

Why: the core can be unit tested with `cargo test` in seconds and without a window, the PRD's
module boundaries (`inspectors`, `model`, `project`, `diff`, `ui`) map one-to-one to directories,
and a future CLI or server could reuse the core unchanged.

### ADR-002: Tauri 2 stable in a single binary crate

The application targets Tauri 2.12 (crate and CLI). Tauri 3 was in alpha when the project started
and is not used. `src-tauri` is a plain binary crate (`main.rs` plus modules) instead of the
template's library-plus-binary split, which exists to support mobile targets this product does not
have.

Why: fewer build artefacts on Windows (no `cdylib`/`staticlib` link steps) and a simpler mental
model. The split can be reintroduced if mobile ever becomes a goal.

### ADR-003: TypeScript contracts are generated from Rust

Every type that crosses the IPC boundary or is persisted derives `ts_rs::TS`. Running
`cargo test --workspace` (or `npm run contracts`) regenerates `src/shared/contracts/generated/`,
which is committed; CI fails when the generated files are out of date.

Why: a single source of truth for the model. Hand-written TypeScript mirrors drift silently and
produce the most tedious class of integration bugs. `ts-rs` was preferred over `tauri-specta`
because it is stable, small and does not change how commands are declared.

### ADR-004: Failures are typed errors, never panics

Clippy denies `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented` and `dbg_macro` across
the workspace; tests opt out locally. Library errors use `thiserror` enums; the Tauri layer maps
them to a serialisable error payload for the frontend (introduced with the first fallible command
in milestone 2). The release profile sets `panic = "abort"`, which is consistent with the rule: a
panic is a bug, not a flow.

### ADR-005: React 19 and React Flow for the canvas, own SVG renderer for export

The interactive canvas is built on `@xyflow/react` (React Flow), which provides pan, zoom,
minimap, selection and node dragging with good performance for hundreds of nodes. Automatic
layouts will use ELK.js (layered/Sugiyama) and d3-force (organic). High-fidelity export (milestone 5) will use a dedicated, deterministic SVG renderer that shares the node geometry module with the
canvas, so exported and on-screen diagrams are identical.

Why: React Flow is named in the PRD and removes a large amount of interaction code; export must
not depend on DOM screenshots. The small React Flow attribution stays visible, as its authors
ask of users without a Pro subscription; it is styled to blend with the canvas.

### ADR-006: Design tokens with `light-dark()`, no CSS framework

All colours, type sizes, spacing, radii and motion live as custom properties in
`src/app/styles/tokens.css`. Colours are declared once with `light-dark()`; the theme is chosen via
`color-scheme` on the root element (`system`, `light` or `dark`). Components use CSS Modules.

Why: one token set means light and dark cannot drift, native controls and scrollbars follow the
theme automatically, and there is no flash on startup because the system preference applies
before any JavaScript runs. A utility framework would add a build step and verbose markup for a
UI that is mostly bespoke.

### ADR-007: Typed message catalogues instead of an i18n library

Messages are plain TypeScript objects (`src/shared/i18n/messages/`). The English catalogue defines
the `MessageKey` type; other languages are typed against it, so a missing or extra key fails
type-checking. Plurals use `Intl.PluralRules`; interpolation is `{name}` replacement. A unit test
verifies every catalogue has the same keys and placeholders.

Why: two languages and a few hundred strings do not justify an i18n framework. The typed approach
gives compile-time completeness checks that most libraries lack.

### ADR-008: Action registry as the single source of commands

Every user operation is an `AppAction` (id, label key, icon, shortcut, availability, `run`).
Toolbars, menus, the welcome screen and keyboard shortcuts read from the same registry; the
command palette (milestone 4) will too.

Why: labels, icons and shortcuts shown in tooltips can never disagree with what the keyboard does,
and adding a feature means adding one action rather than touching every surface.

### ADR-009: SQL Server access with tiberius 0.13, bb8 and a self-owned connection manager

`tiberius` 0.13 (TDS 8.0, Windows integrated authentication through the `winauth` feature) is
the maintained line. `bb8-tiberius` still requires tiberius 0.12, so the pool uses `bb8` with a
small `ManageConnection` implementation in `inspectors/sqlserver/pool.rs`: it resolves named
instances through SQL Browser, bounds the TCP connection with a timeout, runs the login
handshake and validates idle sessions with `SELECT 1`. Pools live for one operation (test,
listing or inspection) and are dropped afterwards, so the application never keeps idle sessions
on a server. An inspection opens up to four sessions and runs its seven set-based catalog
queries concurrently; the schema filter is applied while assembling, and foreign keys whose
other end falls outside the selection are dropped. The schema picker lists only schemas that
hold user tables or views: ownership of the fixed-role schemas (`db_datareader` and friends) is
not reliable in real databases, and an empty schema has nothing to filter. Fallback if a
regression appears: tiberius 0.12.3 with `bb8-tiberius`.

### ADR-010: The portable executable relies on the WebView2 runtime

`npm run tauri build` produces a single `schemacraft.exe` with the frontend embedded. Like every
Tauri application on Windows it renders through the Evergreen WebView2 runtime, which ships with
Windows 11 and with Windows 10 updates. Bundling a fixed-version runtime would turn the single
file into a folder of roughly 150 MB, so it is not the default. The NSIS installer embeds the
WebView2 bootstrapper for machines that lack the runtime; milestone 6 adds a friendly startup
check for the portable executable.

Code signing is a distribution requirement, not an option: on Windows 11 machines where Smart
App Control is enforced, the unsigned release build is refused at launch (observed on the
development machine in milestone 1, while the debug build runs). Milestone 6 adds Authenticode
signing of the executable and the installer, for example through Azure Trusted Signing or an
OV/EV certificate, wired into the Tauri bundle configuration.

### ADR-011: One Server field that understands SSMS notations

The connection dialog has a single Server field that accepts `host`, `host\instance`,
`host,port`, a `tcp:` prefix and the `.` and `(local)` aliases, parsed by
`features/connection/serverAddress.ts`.

Why: it is what SQL Server users already type in SSMS and connection strings. Separate host,
instance and port fields would add a mode switch and three validations for no gain.

### ADR-012: Errors carry a classification, and the UI owns the remedy

Rust reports failures as `InspectorError` variants with a serialisable `InspectorErrorKind`; the
Tauri layer wraps them in `CommandError`. The frontend maps each kind to a title, a hint and,
when it applies, a one-click remedy (trusting the server certificate). Raw driver messages are
shown only as secondary detail.

Why: the core stays free of presentation text, the frontend never parses error strings, and
every error states what happened and what to do next, as the UX principles require.

### ADR-013: Progress over an ordered channel, cooperative cancellation

`inspect_database` streams `InspectionEvent` messages through `tauri::ipc::Channel`, which
delivers in order. The first event carries a job id; `cancel_inspection` cancels the matching
`CancellationToken`, which the inspection checks between stages and while catalog queries run.

Why: channels are the Tauri mechanism designed for ordered, high-frequency updates, and
cooperative cancellation never leaves a session half-way through a query.

### ADR-014: Simulated backend for browser previews

Development builds running outside the desktop runtime load a simulated connection backend
through a dynamic import (`shared/ipc/previewConnectionBackend.ts`). Server names such as
`auth-fail`, `cert-fail`, `down` and `slow` reproduce the classified failures; anything else
succeeds with a small fixture schema. Production builds never include it, and inside Tauri it
is never loaded.

Why: the connection flow can be designed, reviewed and screenshot in a plain browser without a
database, in both themes and languages, which is how the UX definition of done is checked.

### ADR-015: `.scraft` is versioned, pretty JSON written atomically

A project file is one JSON document: a header (`formatVersion`, `savedAt`, `savedWith`)
followed by the content the application holds in memory, `ProjectContent`: the connection
without its password, the inspection options, the snapshot and the canvas state. Readers parse
the header first and refuse newer format versions with a classified error; missing fields of
older files take defaults. Files are written to a sibling temporary file and renamed over the
destination, so a crash never leaves a truncated project behind. Node states are stored sorted
by qualified name, so saving the same project twice yields the same bytes.

Why: the PRD asks for a readable, structured file that reopens without a database. Pretty
JSON with camelCase keys is diff-friendly and matches the IPC payloads, which means one set of
Rust types (`ts-rs` exported) describes the file, the IPC and the frontend state.

The canvas state is the Memento of the diagram: an immutable, serialisable value the canvas
produces when a project is saved and restores when it is opened. Milestone 4 adds the
caretaker (undo and redo) on top of the same value.

### ADR-016: The diff matches objects by name and is reviewed before it is applied

`SchemaDiff::between` pairs tables and views by schema-qualified name, foreign keys by
referencing table plus constraint name, and columns, indexes and constraints by name. A rename
is therefore a removal plus an addition; there is no heuristic rename detection in v1. Column
order is not compared, because reordering changes nothing in a diagram. Every list is sorted,
so the same two snapshots always produce the same diff, and a summary carries the counts the
review dialog shows.

Refresh from database reads the schema again, computes the diff on the Rust side and shows it
in the connection dialog; nothing changes until the user applies it. Applying replaces the
snapshot and carries the canvas state over to every surviving entity, changed or not; new
entities wait for a layout. A project opened from a file reconnects through the same dialog,
prefilled from the saved connection, because the password is never on disk.

### ADR-017: Preferences live in one Rust-owned file in the user's configuration directory

The connection history (last ten endpoints, most recent first, never a password) and the
recent projects (last ten paths) are a `Preferences` document stored as
`preferences.json` under the per-user application configuration directory
(`%APPDATA%\com.jmanuelsoberano.schemacraft` on Windows), written with the same atomic writer as
project files. Entries are deduplicated by endpoint (server, database and login, case
insensitive) and by path. The Rust side applies every change and returns the whole document;
the frontend mirrors it in a store and never writes the file itself. A damaged file is logged
and replaced by defaults rather than blocking start-up.

Why: a file the user can find and back up, consistent with the project format, independent of
the webview's storage, and ready to take theme and language later. Keeping it in AppData rather
than next to the executable keeps the portable build usable from read-only locations.

### ADR-018: Native dialogs through the Tauri plugin, preview backends behind a resolver

File pickers use `tauri-plugin-dialog`; the chosen path is then passed to the Rust commands
that read and write projects, so no file content crosses the IPC boundary twice. Every feature
backend (connection, project, preferences) is resolved by one helper: the Tauri commands inside
the desktop runtime, a simulated backend in a development browser preview, or a backend that
reports the runtime as unavailable. The preview loader is passed as
`import.meta.env.DEV ? () => import(...) : null`, which lets the bundler drop every simulated
module from production builds.

## Milestones

| #   | Scope                                                           | Status  |
| --- | --------------------------------------------------------------- | ------- |
| 1   | Workspace, domain model, Tauri host, application shell, tooling | done    |
| 2   | `DatabaseInspector`, SQL Server inspector, connection dialog    | done    |
| 3   | `.scraft` project files and schema diff engine                  | done    |
| 4   | Canvas: table nodes, relationships, layouts, detail levels      | next    |
| 5   | Export: SVG, standalone HTML, single-page PDF                   | planned |
| 6   | Portable executable validation and packaging                    | planned |
