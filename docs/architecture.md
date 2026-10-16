# Architecture

SchemaCraft is a Tauri 2 desktop application. A Rust workspace holds the domain core and the
application host; a React frontend renders the diagram. This document records the decisions that
shape the codebase as short architecture decision records (ADRs). Each one states the decision and
the reason; alternatives appear only when they were seriously considered.

The product requirements live in [PRD_SchemaCraft_v1.md](./PRD_SchemaCraft_v1.md) and the user
experience bar in [ux-principles.md](./ux-principles.md). The
[architecture page](https://jmanuelsoberano.github.io/schemacraft/architecture/) shows the same
structure as an interactive map: layers, components, data stores, flows and how to add a feature
(ADR-030).

## Layout

```
schemacraft/
├── crates/schemacraft-core/   Rust library, free of Tauri: everything the app knows and does
│   ├── src/model/             pure schema types (tables, columns, keys, snapshot)
│   ├── src/inspectors/        DatabaseInspector strategy, errors, progress, SQL Server implementation
│   ├── src/project/           .scraft documents, saved connections, canvas state
│   ├── src/diff/              comparison of two snapshots behind "refresh from database"
│   ├── src/preferences/       connection history and recent projects (per-user JSON file)
│   ├── src/credentials/       CredentialStore strategy: Windows Credential Manager, memory
│   ├── src/export/            SVG to PNG and PDF rendering with bundled fonts
│   ├── src/fs.rs              atomic file writes shared by projects, preferences and exports
│   ├── assets/fonts/          TTF fonts embedded in the exports
│   └── tests/                 integration tests and SQL fixtures (run against a real server)
├── src-tauri/                 Rust binary: Tauri host, IPC commands, job registry, logging, configuration
├── src/                       React + TypeScript frontend
│   ├── app/                   composition root: shell, actions, palette, global styles, dev hooks
│   │   ├── actions/           action registry, keyboard shortcuts, action buttons
│   │   ├── palette/           command palette over the action registry
│   │   ├── shell/             top bar, entities sidebar, diagram canvas, status bar, shell guards
│   │   └── styles/            design tokens and base styles
│   ├── features/              one folder per product capability
│   │   ├── about/             About dialog
│   │   ├── canvas/            entity nodes, relation edges, layouts and their worker, geometry
│   │   ├── connection/        connection dialog, history, flow store, progress, change review
│   │   ├── export/            export dialog and store, SVG renderer, standalone HTML packaging
│   │   ├── preferences/       mirror of the preferences file: history and recent projects
│   │   ├── project/           open project store, open/save flows, unsaved-changes guard, undo
│   │   └── schema/            entity list helpers and data type formatting
│   ├── shared/                cross-cutting modules
│   │   ├── brand/             logo and author credits
│   │   ├── contracts/         TypeScript types generated from Rust (ts-rs)
│   │   ├── errors/            title, hint and remedy for every error kind
│   │   ├── i18n/              message catalogues and translation hook
│   │   ├── ipc/               the only door to Tauri: commands, dialogs, window, runtime; preview backends
│   │   ├── settings/          per-window UI settings (theme, language, sidebar)
│   │   └── ui/                accessible UI primitives (Radix based)
│   └── viewer/                standalone viewer embedded in exported HTML files
├── assets/brand/              source artwork for the application icon
├── scripts/                   SQL Server container, font preparation, smoke test, page check, CI change filter
├── docs/                      PRD, decision records, UX principles, release checklist
│   └── architecture/          interactive architecture page and its model (GitHub Pages)
└── .github/workflows/         CI on every pull request, sized to the change; release on every tag
```

Dependencies only point inwards: `src-tauri` depends on `schemacraft-core`, never the other way
round. In the frontend, `app/` composes `features/`, which build on `shared/`; `shared/` never
imports from `app/` or `features/`, and only `src/shared/ipc` imports the Tauri API, for commands,
dialogs and the window alike. ESLint enforces these rules (ADR-031).

## Decisions

### ADR-001: Rust workspace with a framework-free core

`crates/schemacraft-core` knows nothing about Tauri, HTTP or any UI. It contains the schema model,
the database inspectors (`DatabaseInspector` strategy), `.scraft` persistence, the diff engine,
the preferences, the credential store and the PNG and PDF export. `src-tauri` is a thin adapter
that maps core operations to IPC commands.

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
file into a folder of roughly 150 MB, so it is not the default. Milestone 6 added a startup
check of the runtime (ADR-027), and since ADR-029 the NSIS installer relies on it too instead
of embedding the WebView2 bootstrapper.

Code signing is a distribution requirement, not an option: on Windows 11 machines where Smart
App Control is enforced, the unsigned release build is refused at launch (observed on the
development machine in milestone 1, while the debug build runs). Signing goes through the
SignPath Foundation (ADR-029); version 1.0.0 ships unsigned while that application is reviewed.

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
older files take defaults. Files are written to a sibling temporary file, flushed to the disk
and renamed over the destination, so a crash or a power cut never leaves a truncated project
behind; the preferences and the exports share the same helper (`src/fs.rs`). Node states are
stored sorted by qualified name, so saving an unchanged project twice yields the same bytes
except for `savedAt`.

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
that read and write projects, so no file content crosses the IPC boundary twice. The caller
passes the dialog title and the file-type name already translated. Every feature backend
(connection, project, preferences, credentials, export) is resolved by one helper,
`createBackendResolver`, and calls its commands through `invokeCommand`, which turns every
failure into an `OperationError`. The resolver picks the Tauri commands inside
the desktop runtime, a simulated backend in a development browser preview, or a backend that
reports the runtime as unavailable. The preview loader is passed as
`import.meta.env.DEV ? () => import(...) : null`, which lets the bundler drop every simulated
module from production builds.

### ADR-019: Remembered passwords live in the operating system store and never cross the IPC twice

"Remember password" hands the typed password to the Rust side once, which files it in the
Windows Credential Manager through the `keyring` crate under a key derived from the server and
the login (`CredentialStore`, a strategy with an in-memory implementation for tests and other
platforms). From then on the frontend only learns whether a password is remembered: connection
settings carry `password: { source: "stored" }`, and the Rust side resolves it right before
connecting. A remembered password that disappeared is its own classified error, which the dialog
answers by asking for the password again. Unticking the box on the next successful connection
removes the entry. Project files and preferences never contain a password in any form.

Why: the PRD requires passwords to live only in memory or in the operating system store. Keeping
resolution on the Rust side means the secret is never serialised towards the webview, and a
file opened on another machine simply asks for the password.

### ADR-020: Diagram geometry is computed from data, shared by the canvas and the exports

Node sizes (240 px wide, 38 px header, 22 px rows), the rows shown at each detail level, the
row at which a relationship attaches and the semantic zoom threshold (compact cards below 40 %)
live in `src/features/canvas/geometry.ts`, with no React in it. The canvas never measures the
DOM to decide where an edge goes: nodes are built with their computed size, and an edge attaches
at the row of its first column pair on each table. Anchors (`edgeGeometry.ts`) float with the
nodes: tables stacked vertically connect through their facing top and bottom edges, tables side
by side through their facing sides at the key row, overlapping tables leave through the same
side and bend around, and a self-reference loops out of the right side. Crow's foot markers are
SVG markers defined once (`RelationMarkers.tsx`) and painted with `context-stroke`, so they
inherit the colour and the emphasis of their edge.

Why: Step 5 renders the same diagram to SVG, HTML and PDF without a browser layout pass. When
geometry is a function of the project file, the export is the canvas, pixel for pixel, and the
unit tests cover the drawing rules without a DOM.

### ADR-021: Canvas state is a Memento in the project, undo lives in the project store

`CanvasState` (detail level, layout kind, viewport and, per entity, position, collapsed and
hidden) is a plain value inside `ProjectContent`: it is what `.scraft` saves and what Rust
validates (`retaining_entities_of`, `normalized`). Every change to it goes through
`projectStore.updateCanvas(update, { undoable, dirty })`, which pushes the previous value on a
bounded history (100 entries) and clears the redo stack; undo and redo swap values back. The
first layout of a fresh project is applied with `undoable: false, dirty: false`, so it is
neither an edit nor an undo step. Changing the detail level is saved with the project, but it
becomes an undo step only when the taller nodes have to move apart; on its own it is a view
setting, like the viewport. Transient interaction state (selection, hover, zoom level,
refresh highlights, context menu, layout in progress) lives in `canvasUiStore` and is never
saved. After a refresh, `refreshPlacement.ts` places new tables in free space next to the
tables they reference, or in a row below the diagram, and highlights them; surviving positions
never move.

Why: the PRD asks for the Memento pattern on the canvas and for positions that survive a
refresh. A value type makes saving, diffing and undoing the same operation, and keeps UI noise
out of the file.

### ADR-022: Three layout strategies behind one request, ELK runs in a worker

`LayoutRequest` is a tagged union (`layered` with a direction, `organic`, `radial` with a focus)
resolved by `runLayout` in `src/features/canvas/layouts`. Layered uses ELK.js inside a Web
Worker created from the bundled worker script, so the UI never blocks; organic runs d3-force
synchronously for a fixed number of ticks from the current positions; radial places rings by
breadth-first distance around the focused table (or the most connected one), each ring sorted so
a table sits in the direction of the table it was reached from. Tables without any visible
relationship stay out of the organic simulation and the radial rings and are placed in a block
below the diagram. Strategies receive only the visible entities with their computed sizes and
the visible relationships, and return positions; applying a result is one undoable
`updateCanvas`, and the saved layout kind lets "Apply last layout" repeat it after a refresh.
Measured in the real application on 200 tables: layered 456 ms from request to painted diagram,
organic 222 ms, pan and zoom at 72 fps on average.

Known limitation: edges are drawn between the floating anchors of ADR-020, not along the routes
ELK computes, so an edge that spans several layers can pass behind a table placed between its
ends. Adopting ELK's bend points is a candidate for Step 5, when the export needs the same
routes.

Why: ELK gives the best layered result but is CPU heavy; the worker keeps panning smooth while
it runs. One request type keeps the menu, the palette and the keyboard shortcuts on the same
code path, and Step 5 can reuse the strategies without a canvas.

### ADR-023: One SVG renderer in TypeScript draws the canvas's diagram for every export

The export never screenshots the DOM. `src/features/export/svg/renderDiagram.ts` builds an SVG
document from the project data with the geometry of ADR-020 (`geometry.ts`, `edgeGeometry.ts`)
and the same crow's foot markers, so the file is the canvas drawn again: the visible entities at
their positions, collapsed ones collapsed, at the chosen detail level and theme. Colours are the
design tokens converted once to sRGB hex (`palette.ts`), because renderers outside the browser
understand neither `oklch()` nor `light-dark()`; styles are plain class rules without
combinators, the subset every SVG consumer shares. Text stays text, selectable in SVG and PDF;
names that do not fit are shortened with an ellipsis, measured with a canvas in the webview and
estimated in tests. The renderer is deterministic for a given input, which the unit tests check.

Why: the PRD asks for continuous vector output with selectable text that matches the screen.
One renderer, shared with the standalone viewer, keeps the drawing rules in a single place.

### ADR-024: PNG and PDF are produced in Rust with resvg and svg2pdf, fonts bundled

`core::export` receives the SVG document and the destination (an `ExportRequest`, built from a
specification the TypeScript side validates with a Builder) and writes SVG and HTML verbatim,
rasterises PNG with resvg at 1x, 2x or 4x, or converts to a single-page PDF with svg2pdf whose
page is the diagram's size at 96 px per inch, with the text embedded as text. Four static TTF
faces (Inter and JetBrains Mono, regular and semibold, produced from the Fontsource packages by
`scripts/prepare-fonts.mjs`) are compiled into the binary and registered in a font database
shared across exports, with the system fonts behind them for glyphs the Latin subsets lack. The
raster is capped at 16 384 px per side, checked before allocation and mirrored by the dialog,
which refuses the scale and explains the limit. Files are written atomically like projects; the
command runs on a blocking thread, streams its stages through a channel and honours cancellation
between stages. resvg and usvg are pinned to 0.45 because svg2pdf 0.13 is built against that
usvg: the three must share one tree type.

Why: rendering in-process makes the output identical on every machine and works in the portable
executable without printers or dialogs; the WebView2 print path, with its page sizes and its
dialog, stays out of the picture.

### ADR-025: The standalone HTML is a viewer with the schema embedded, bundled by a Vite plugin

The HTML export embeds the visible part of the schema as JSON (never the server, the login or the
server version: only the database name, the objects on the diagram and their positions) together
with a small vanilla TypeScript viewer (`src/viewer`) that draws with the renderer of ADR-023 in
the browser: pan and zoom, the three detail levels, search, neighbour highlighting, a detail
panel per table and light and dark themes. A plugin in `vite.config.ts` bundles the viewer on
demand into a virtual module (`virtual:schemacraft-viewer`), so the application build stays one
command and the viewer never pulls React or the application stores. Fonts are embedded as
`@font-face` data URLs while "Embed fonts" stays on, as in SVG, adding about 125 KB.

Why: the user chose the full viewer over pre-rendered pictures; it keeps the file lighter for
large schemas and lets the reader explore. Sharing the renderer avoids a second drawing
implementation.

### ADR-026: The shell behaves like a desktop application, not a web page

Inside Tauri the webview's browser habits are switched off at the window, in the capture phase
so no component can let them through: the browser context menu is suppressed everywhere except
text fields (the diagram and the entities panel open their own), middle-click autoscroll and
dragging images or links out of the window are prevented, and every accelerator that would
reload, print, find, zoom, navigate history or (outside development) open the developer tools is
swallowed, held keys included. Where the habit has an application meaning it is mapped instead:
F5 refreshes from the database, Ctrl+P exports a PDF and Ctrl+F searches the entities. The
entities panel resizes by dragging its edge or with the arrow keys and remembers its width.

Why: a reload threw the open project away and the print dialog printed the page chrome; both
reached the user. Suppressing the defaults in one place keeps every future screen covered, and
mapping the familiar keys keeps the muscle memory useful.

### ADR-027: Releases are cut by a tag-driven workflow and smoke-tested

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`: it checks that the tag points at a
commit on `main` and matches the version in `package.json` and `Cargo.toml`, runs every quality
gate, builds the portable executable and the NSIS installer with the full release profile,
smoke-tests the real binary,
computes SHA-256 sums and publishes a draft GitHub release with the assets and generated notes.
The smoke test (`scripts/smoke-test-release.mjs`) starts the executable with a DevTools port,
which the application opens when `SCHEMACRAFT_REMOTE_DEBUGGING_PORT` is set, in a private
profile, and checks through that protocol that the welcome screen renders, that About shows the
version, that the language and the theme switch and that F5 does not reload, saving screenshots
as artifacts; CI runs the same test on pull requests that change code (ADR-033). Before any
window exists, the executable checks that the WebView2 runtime loads and otherwise shows a
native bilingual dialog offering Microsoft's download page, through `rfd`, which the dialog
plugin already compiles, since the workspace forbids `unsafe` FFI.

Why: a release must be reproducible from a tag and verified on the real binary, not in
development mode. The draft release gives the author a last manual check before publishing.
Signing was first planned as an optional Azure Trusted Signing step; ADR-029 replaced it.

### ADR-028: SchemaCraft is free software under the AGPL-3.0-only license

The project is published under the GNU Affero General Public License, version 3 only, the most
restrictive license approved by the Open Source Initiative in common use: anyone may use, study,
share and modify it, and whoever distributes a modified version, or offers one as a network
service, must publish its source under the same terms. Every dependency was checked for
compatibility: the Rust crates are under MIT, Apache-2.0, BSD, Zlib, MPL-2.0, Unicode or similar
permissive terms; the frontend packages are under MIT, ISC or Apache-2.0; ELK is dual-licensed
EPL-2.0 or GPL-3.0-or-later, which makes it usable in a GPL work; and the bundled fonts, Inter
and JetBrains Mono, are under the SIL Open Font License 1.1, which allows embedding them in a
program under any license as long as their license texts ship with them.

Why: an open-source license is a condition of free code signing for open-source projects, and
the copyleft keeps improvements shared with the project. The SPDX identifier appears in
`package.json`, in the Cargo workspace and in the Tauri bundle, which shows the license in the
installer.

### ADR-029: Signing through SignPath Foundation; the installer leaves WebView2 to Windows

Azure Trusted Signing, the optional step of ADR-027, is not available to individual developers
outside the United States and Canada. The SignPath Foundation signs open-source projects for
free, and its terms shape the release: a published code signing policy (the README section of
that name, also linked from every release), binaries built only by the release workflow from
the repository on GitHub-hosted runners without caches from earlier builds, and no proprietary
components. The release workflow therefore drops the Azure step and its caches, and the NSIS
installer no longer embeds Microsoft's WebView2 bootstrapper (`webviewInstallMode: skip`): like
the portable executable, the installed program checks for the runtime at startup and offers
Microsoft's download page when it is missing. Version 1.0.0 ships unsigned while the
application is reviewed; once it is approved, the release workflow submits the executable and
the installer to SignPath and the maintainer approves every signing request.

Why: Smart App Control refuses unsigned executables outright, so signing decides whether
SchemaCraft runs on a growing share of Windows 11 machines, and a certificate in the name of an
individual costs a yearly fee and a hardware token. The bootstrapper was the only third-party
binary in the installer, and leaving the runtime to Windows also keeps the installer from
contacting Microsoft on its own.

### ADR-030: The architecture page is generated from a checked model

`docs/architecture/index.html` renders `docs/architecture/model.json`: layers and components, the
dependency edges between them, where every piece of data lives, the main flows, the IPC commands,
the patterns, the recipes for adding a feature, the known deviations and a glossary, in English
and Spanish. GitHub Pages publishes the `docs/` folder. The model carries a manifest of the IPC
commands, feature folders, core modules, IPC backends and the number of decision records;
`scripts/check-architecture-page.mjs` compares it with the code in CI and also checks that every
component path exists and that both languages share their ids. A change that adds a command,
a feature folder, a core module or a backend, or a new decision record, updates the model in the
same pull request; the check fails otherwise.

Why: a diagram drawn by hand drifts from the code within weeks. Keeping the facts in data, the
page as a renderer and a CI check on the parts that can be read from the code keeps the map
honest without a build step, and the decision records stay the place for the reasons.

### ADR-031: Layer boundaries are enforced by lint

`eslint.config.js` gives each frontend layer a `no-restricted-imports` rule: `src/app` may import
features and shared modules; `src/features` may not import `app/`; `src/shared` imports neither
`app/` nor `features/`; the standalone viewer reuses features but never `app/`, and nothing
imports the viewer. Only `src/shared/ipc` may import `@tauri-apps/*`; the rest of the frontend
reaches commands, dialogs, the window (`nativeWindow.ts`) and the runtime check (`runtime.ts`)
through it. Code that several features need moves down into `shared/` (brand, error
presentation), and code that composes the application moves up into `app/` (the command
palette). Features may still use each other's public modules where one builds on the other, such
as canvas and project; the architecture page lists those edges.

Why: rules that live only in a document erode with every change. A lint error at the import names
the rule and the way out, in the editor and in CI, so the structure holds as features are added.

### ADR-032: Commands keep blocking work off the main thread

Tauri runs synchronous commands on the main thread, which also drives the window. A command stays
synchronous only when it reads memory and returns at once (`get_app_info`, `read_preferences`,
`cancel_*`). Every command that touches a file, the operating system credential store or a large
computation is `async` and hands that work to `run_blocking` (`src-tauri/src/commands/mod.rs`),
which runs it on the blocking thread pool and reports a crashed worker as an `unexpected` error.
Commands that need the application state inside the worker take the `AppHandle` and look the
state up there. `PreferencesStore::update` applies a change to a copy and keeps it only after the
file holds it, and a preferences file written by a newer version is never overwritten.

Why: a slow keyring call, a network drive or a diff of a thousand tables must not freeze the
window, and one rule for every command is easier to review than a judgement per command.

### ADR-033: CI runs what a change needs

On a pull request, each CI job first runs `scripts/ci-changes.sh`, which classifies the changed
files. A change limited to `docs/` and Markdown files runs only the frontend gates and the
architecture page check; any other change adds the Rust gates, the build and the smoke test; the
SQL Server integration job runs its tests only when the core, the Cargo manifests, the toolchain
or the CI definition change. The executable for the smoke test is built with the `ci` Cargo
profile (release without link-time optimisation), which halves the build time; release.yml keeps
the full release profile. Pushes to `main` run everything, which also keeps the build cache warm
for the next pull request. The classification runs inside each required job instead of in a
separate job, because a job skipped through a failed dependency would count as passed.

Why: a pull request that only touches the documentation should not wait fifteen minutes for a
Rust build, and the required checks must still fail closed when the classification itself fails.

## Milestones

| #   | Scope                                                           | Status |
| --- | --------------------------------------------------------------- | ------ |
| 1   | Workspace, domain model, Tauri host, application shell, tooling | done   |
| 2   | `DatabaseInspector`, SQL Server inspector, connection dialog    | done   |
| 3   | `.scraft` project files and schema diff engine                  | done   |
| 4   | Canvas: table nodes, relationships, layouts, detail levels      | done   |
| 5   | Export: SVG, standalone HTML, single-page PDF                   | done   |
| 6   | Portable executable validation and packaging                    | done   |
