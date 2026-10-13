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
│   └── src/model/             pure schema types (tables, columns, keys, snapshot)
├── src-tauri/                 Rust binary: Tauri host, IPC commands, logging, configuration
├── src/                       React + TypeScript frontend
│   ├── app/                   application shell, actions, brand, global styles
│   │   ├── actions/           action registry, keyboard shortcuts, action buttons
│   │   ├── shell/             top bar, entities sidebar, diagram canvas, status bar
│   │   └── styles/            design tokens and base styles
│   └── shared/                cross-cutting modules
│       ├── contracts/         TypeScript types generated from Rust (ts-rs)
│       ├── i18n/              message catalogues and translation hook
│       ├── ipc/               typed wrappers over Tauri `invoke`
│       ├── settings/          persisted preferences (theme, language, layout)
│       └── ui/                accessible UI primitives (Radix based)
├── assets/brand/              source artwork for the application icon
├── docs/                      PRD, architecture, UX principles
└── .github/workflows/         continuous integration
```

Dependencies only point inwards: `src-tauri` depends on `schemacraft-core`, never the other way
round; the frontend talks to Rust exclusively through IPC commands; `shared/` modules never import
from `app/`.

## Decisions

### ADR-001: Rust workspace with a framework-free core

`crates/schemacraft-core` knows nothing about Tauri, HTTP or any UI. It contains the schema model
and, in later milestones, the database inspectors (`DatabaseInspector` strategy), `.scraft`
persistence and the diff engine. `src-tauri` is a thin adapter that maps core operations to IPC
commands.

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

Planned for milestone 2. `tiberius` 0.13 (TDS 8.0, Windows integrated authentication through the
`winauth` feature) is the maintained line. `bb8-tiberius` still requires tiberius 0.12, so the
pool uses `bb8` with a small `ManageConnection` implementation of our own. Fallback if a
regression appears: tiberius 0.12.3 with `bb8-tiberius`.

### ADR-010: The portable executable relies on the WebView2 runtime

`npm run tauri build` produces a single `schemacraft.exe` with the frontend embedded. Like every
Tauri application on Windows it renders through the Evergreen WebView2 runtime, which ships with
Windows 11 and with Windows 10 updates. Bundling a fixed-version runtime would turn the single
file into a folder of roughly 150 MB, so it is not the default. The NSIS installer embeds the
WebView2 bootstrapper for machines that lack the runtime; milestone 6 adds a friendly startup
check for the portable executable.

## Milestones

| #   | Scope                                                           | Status  |
| --- | --------------------------------------------------------------- | ------- |
| 1   | Workspace, domain model, Tauri host, application shell, tooling | done    |
| 2   | `DatabaseInspector` trait and SQL Server inspector with tests   | next    |
| 3   | `.scraft` project files and schema diff engine                  | planned |
| 4   | Canvas: table nodes, relationships, layouts, detail levels      | planned |
| 5   | Export: SVG, standalone HTML, single-page PDF                   | planned |
| 6   | Portable executable validation and packaging                    | planned |
