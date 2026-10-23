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
│   ├── src/model/             pure schema types (tables, columns, keys, snapshot, code objects), access profile, carry-over
│   ├── src/inspectors/        DatabaseInspector strategy, errors, progress, native SQL Server and PostgreSQL inspectors
│   ├── src/project/           .scraft documents and their migrations, saved connections, canvas state
│   ├── src/diff/              comparison of two snapshots behind "refresh from database"
│   ├── src/comparison/        immutable comparison of independent captures, evidence and bounded source-line pages
│   ├── src/preferences/       connection history and recent projects (per-user JSON file)
│   ├── src/credentials/       CredentialStore strategy: Windows Credential Manager, memory
│   ├── src/export/            SVG to PNG and PDF rendering with bundled fonts
│   ├── src/fs.rs              atomic file writes shared by projects, preferences and exports
│   ├── src/diagnostics.rs     typed events of the local diagnostic log: counts, timings and kinds only
│   ├── assets/fonts/          TTF fonts embedded in the exports
│   ├── probes/                capability probe: a read-only T-SQL script, run by hand with the login SchemaCraft uses, that returns numbers only
│   └── tests/                 integration tests, SQL fixtures, golden CHECK forms, low-privilege logins and the probe's allowlist (run against a real server)
├── src-tauri/                 Rust binary: Tauri host, IPC commands, job registry, logging and the diagnostic log file, configuration
├── src/                       React + TypeScript frontend
│   ├── app/                   composition root: shell, actions, palette, global styles, dev hooks
│   │   ├── actions/           action registry, keyboard shortcuts, action buttons
│   │   ├── palette/           command palette over the action registry
│   │   ├── shell/             top bar, status bar, welcome overlay, layout menu, shell guards, side-panel widths
│   │   └── styles/            design tokens, base styles and the test that keeps every stylesheet on tokens
│   ├── features/              one folder per product capability
│   │   ├── about/             About dialog
│   │   ├── access/            partial-access chip and bar, access report, GRANT script
│   │   ├── canvas/            diagram canvas, entities panel, nodes, edges and markers, layouts and their worker, geometry, focus between canvas and Inspector
│   │   ├── connection/        connection dialog, history, flow store, progress, change review
│   │   ├── comparison/        independent project comparison, scoped offline report and local source details
│   │   ├── dependencies/      catalog-reference Inspector section, bounded directed map and closed exports
│   │   ├── export/            export dialog and store, SVG renderer, standalone HTML packaging with the viewer's catalogue subset
│   │   ├── inspector/         Inspector panel: the selected entity's details beside the canvas, its rules in words with their SQL
│   │   ├── preferences/       mirror of the preferences file: history and recent projects
│   │   ├── perspectives/      named maps over one snapshot, shared notes and reviewed annotation projection
│   │   ├── project/           open project store, open/save flows, unsaved-changes guard, undo
│   │   └── schema/            entity identity and kinds, entity lists, data types, expression texts, coverage, object details view-model
│   │       └── rules/         readable rules: the CHECK tokenizer, parser and reader, the foreign key reader, sentences as data
│   ├── shared/                cross-cutting modules
│   │   ├── brand/             logo and author credits
│   │   ├── contracts/         TypeScript types generated from Rust (ts-rs)
│   │   ├── errors/            title, hint and remedy for every error kind
│   │   ├── i18n/              message catalogues with the rules sub-catalogue, catalogue translator (shared with the viewer), translation hook
│   │   ├── ipc/               the only door to Tauri: commands, dialogs, window, runtime; preview backends
│   │   ├── settings/          per-window UI settings (theme, language, panel widths, closed access notices)
│   │   └── ui/                accessible UI primitives (Radix based), the resizer of both side panels
│   └── viewer/                standalone viewer embedded in exported HTML files, drawing the shared details view-model and its rules
├── assets/brand/              source artwork for the application icon
├── scripts/                   SQL Server containers, font preparation, smoke test, page check, CI change filter, release notes
├── docs/                      PRD, decision records, UX principles, release checklist
│   └── architecture/          interactive architecture page and its model (GitHub Pages)
└── .github/workflows/         CI on every pull request, sized to the change; release on every tag
```

Dependencies only point inwards: `src-tauri` depends on `schemacraft-core`, never the other way
round. In the frontend, `app/` composes `features/`, which build on `shared/`; `shared/` never
imports from `app/` or `features/`, `features/schema` imports only `shared/` and itself, and only
`src/shared/ipc` imports the Tauri API, for commands, dialogs and the window alike. ESLint
enforces these rules (ADR-031, ADR-037).

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

Since 1.2 a panic still leaves a trace although release builds have no console: the hook that
logging installs appends the panic's file and line, never its message, to
`schemacraft-panic.log` next to the diagnostic log, through `std::fs` rather than the logger,
before `panic = "abort"` ends the process (ADR-041).

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

Since 1.1 no stylesheet other than `tokens.css` writes a theme colour. The tones that components once
declared for themselves are tokens: the subtle and border colours of the four alert tones, the
overlays, the danger ring, the highlights on the accent colour and the brand glow, together with
the view tokens (`--color-view`, `--color-view-subtle`, `--color-on-view`, ADR-036) and
`--color-warning-text`. CSS Modules and the viewer's stylesheet use `var(...)` for every theme
colour, and `src/app/styles/tokens.test.ts` fails on a raw hex or `oklch()` colour in any of them
(ADR-037); the viewer's two shadows (`--sc-shadow` and the pressed-button shadow) stay translucent
black in `viewer.css`, the one colour the test does not police.

Why: one token set means light and dark cannot drift, native controls and scrollbars follow the
theme automatically, and there is no flash on startup because the system preference applies
before any JavaScript runs. A utility framework would add a build step and verbose markup for a
UI that is mostly bespoke.

### ADR-007: Typed message catalogues instead of an i18n library

Messages are plain TypeScript objects (`src/shared/i18n/messages/`). The English catalogue defines
the `MessageKey` type; other languages are typed against it, so a missing or extra key fails
type-checking. Plurals use `Intl.PluralRules`; interpolation is `{name}` replacement. A unit test
verifies every catalogue has the same keys and placeholders.

Since 1.1 one translator serves the application and the standalone viewer.
`createCatalogTranslator` (`src/shared/i18n/translator.ts`) builds `t`, `tCount` and `template`
over any catalogue with `formatMessage` and `Intl.PluralRules`, with no store or framework behind
it. The application builds it over the whole catalogue of the chosen language (`useI18n`); an
exported HTML file embeds the subset the viewer needs (`viewerMessages`, chosen by key prefix:
`viewer.`, `details.`, `entity.`, `viewMode.`, `indexKind.`, `definition.` and `rule.`, plus
the search placeholder and the partial-access note), and the viewer builds the same translator
over it. The viewer's own catalogue and its interpolation are gone, so every string lives in
`en.ts` and `es.ts` and the catalogue test covers the viewer's placeholders too (ADR-025,
ADR-038). A translator over a wider catalogue is assignable to one over a subset of it, which is
how the shared details view-model accepts either, and the rule readers take a narrower one still
(`RuleTranslator`).

The words of the readable rules (ADR-039) are a sub-catalogue, `messages/rules/en.ts` and
`messages/rules/es.ts`, which `en.ts` and `es.ts` spread in: the keys are part of `MessageKey`,
the catalogue test checks their parity and placeholders like any other, and the `rule.` prefix
carries them into an exported file. The names of the referential actions no longer travel there,
since the sentences say what each action does. A sentence that draws a column or a table as a
chip is not formatted to a string: `formatMessageParts` (`formatMessage.ts`) splits a template
into text and the arguments of its placeholders, an unknown placeholder staying visible as text,
so a renderer can draw each argument as it likes without concatenating pieces of a sentence.

Why: two languages and a few hundred strings do not justify an i18n framework. The typed approach
gives compile-time completeness checks that most libraries lack.

### ADR-008: Action registry as the single source of commands

Every user operation is an `AppAction` (id, label key, icon, shortcut, availability, `run`).
Toolbars, menus, the welcome screen and keyboard shortcuts read from the same registry; the
command palette (milestone 4) will too.

Since 1.1 the detail levels, the theme and the language are registry actions as well
(`view.detailCompact`, `view.detailKeys` and `view.detailFull` on Ctrl+1, Ctrl+2 and Ctrl+3;
`settings.theme.*`; `settings.language.*`), run by the top bar's segmented control and menus and
listed in the palette, and the Inspector toggle is `view.toggleInspector` (Ctrl+I). A test over
the registry the shell builds (`useAppActions.test.ts`) fails when two actions share a shortcut
or one takes a browser accelerator that is not on the claimed list of ADR-026 (F5, Ctrl+P,
Ctrl+F, Ctrl+Shift+H, Ctrl+Shift+L).

The exceptions are deliberate. A gesture on one entity is not an action, because an action
takes no argument: the context menu's items, the eye and the double-click of a sidebar row, the
card chevron, and the double-click and Enter on a card call the feature functions the registry
would call (`canvasActions.setHidden` and `setCollapsed`, `focusEntity`, `openInspector`), and
the one entity-free item of the context menu, "Show all", runs the registry action the shell
passes in. Enter on a focused card is handled by the canvas, not as a global shortcut, because
an Enter captured at the window would take activation from every button. The controls of a
rule in the Inspector (ADR-039) are local to it, like a disclosure: its Show SQL toggle and Copy
SQL button, the table chips of its sentences, and the highlight that pointing at the rule or
focusing one of its controls sets on the canvas. The four layout strategies, collapse all, expand
all, the three themes and the two languages have no shortcut: they live in the layout menu, the
top bar and the palette, and Ctrl+Shift+L repeats the last layout.

Since 1.2 `help.openLogFolder` (ADR-041) has no shortcut either: opening the log folder is a step
of a bug report, not of daily work, so it lives in the palette and in the about dialog (F1), and it
is unavailable when the session writes no log.

The module Inspector's code controls are local too (ADR-044): Find, next/previous match, Wrap
and Copy operate on the displayed source. Opening a routine or trigger takes a `ModuleRef`, so
it follows the same argument-taking exception as selecting a table. The shortcut listener leaves
keys owned by the code viewer to that surface before applying global actions or browser guards.

Why: labels, icons and shortcuts shown in tooltips can never disagree with what the keyboard does,
and adding a feature means adding one action rather than touching every surface.

### ADR-009: SQL Server access with tiberius 0.13, bb8 and a self-owned connection manager

`tiberius` 0.13 (TDS 8.0, Windows integrated authentication through the `winauth` feature) is
the maintained line. `bb8-tiberius` still requires tiberius 0.12, so the pool uses `bb8` with a
small `ManageConnection` implementation in `inspectors/sqlserver/pool.rs`: it resolves named
instances through SQL Browser, bounds the TCP connection with a timeout, runs the login
handshake and validates idle sessions with `SELECT 1`. Pools live for one operation (test,
listing, description or inspection) and are dropped afterwards, so the application never keeps
idle sessions on a server. An inspection opens up to four sessions and runs the access probe
(ADR-034) and its seven set-based table catalog queries concurrently; the table schema filter is
applied while assembling. Since 1.2 the code stage shares those four sessions and filters every
query on the server with bound schema parameters (ADR-043). A foreign key whose referenced table is visible but outside the selection is
dropped, because an edge needs both tables on the diagram; one whose referenced table the login
cannot see is kept apart (ADR-034). The schema picker lists the schemas in which the access
probe finds a table or view the login can see: ownership of the fixed-role schemas
(`db_datareader` and friends) is not reliable in real databases, and an empty schema has nothing
to filter. Since 1.2 a separate list includes schemas with visible procedures or functions for
the code option (ADR-043). Fallback if a regression appears: tiberius 0.12.3 with `bb8-tiberius`.

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
SignPath Foundation (ADR-029); releases ship unsigned while that application is reviewed.

### ADR-011: One Server field that understands SSMS notations

The connection dialog has a single Server field that accepts `host`, `host\instance`,
`host,port`, a `tcp:` prefix and the `.` and `(local)` aliases, parsed by
`features/connection/serverAddress.ts`.

The field keeps the notation the user typed. Everywhere else a server has one canonical name,
the one Rust `format_target` produces: `host\instance` for a named instance, otherwise
`host,port` with the default port 1433 spelled out. The credential keys use it, and
`formatTarget` in `serverAddress.ts` mirrors it for the status bar, the connection history and
the keys of saved connections, with parity tests on the Rust cases; `formatServerAddress` only
refills the field.

Why: it is what SQL Server users already type in SSMS and connection strings. Separate host,
instance and port fields would add a mode switch and three validations for no gain. One
canonical name makes `db` and `db,1433` the same server in every list.

### ADR-012: Errors carry a classification, and the UI owns the remedy

Rust reports failures as `InspectorError` variants with a serialisable `InspectorErrorKind`; the
Tauri layer wraps them in `CommandError`. The frontend maps each kind to a title, a hint and,
when it applies, a one-click remedy (trusting the server certificate). Raw driver messages are
shown only as secondary detail.

Why: the core stays free of presentation text, the frontend never parses error strings, and
every error states what happened and what to do next, as the UX principles require.

### ADR-013: Long jobs report over an ordered channel and stop on a cancellation token

Inspection and export are the long jobs, and both follow one pattern. The command registers a
`CancellationToken` under a new job id in its `Jobs` registry (`src-tauri/src/state.rs`) and
streams events through `tauri::ipc::Channel`, which delivers in order: first `Started { jobId }`,
then `Progress` with the job's own payload (`InspectionProgress` or `ExportStage`).
`cancel_inspection` and `cancel_export` cancel the token of a job id and answer `UnknownJob`
when no such job is running. An async job races all of its work against the token:
`SqlServerInspector::inspect` runs inside `tokio::select!` with `biased`, so opening the pool
and the login handshake can be cancelled too, and a server that accepts the TCP connection and
never answers is abandoned at once; dropping the unfinished work closes its sessions. A blocking
job, such as the export on `run_blocking`, checks the token between its steps and touches the
destination only after the last check.

Why: channels are the Tauri mechanism designed for ordered, high-frequency updates, and one
shape for every long job keeps the progress views and the Cancel buttons alike. Racing the
token makes Cancel answer at once whatever the server does, and a blocking job that stops
between steps never leaves a half-written file.

### ADR-014: Simulated backend for browser previews

Development builds running outside the desktop runtime load a simulated connection backend
through a dynamic import (`shared/ipc/previewConnectionBackend.ts`). Server names such as
`auth-fail`, `cert-fail`, `down` and `slow` reproduce the classified failures; anything else
succeeds with a fixture schema that holds stored-form `CHECK` and `DEFAULT` texts, unique and
plain indexes, a computed column, a disabled and a `SET NULL` foreign key. A server name that
contains `partial`, `nothing` or `empty` chooses what the login sees: part of the schema, no
table or view, or an empty database. `previewAccess.ts` follows the Rust access verdicts and the
refresh merge of ADR-034, so the notices and the review can be checked without a server. The
preview's recent projects include a capture with partial access, an upgraded 1.0 file and a
file of a newer format, which opens read-only (ADR-035). Production builds never include any of
it, and inside Tauri it is never loaded.

Why: the connection flow can be designed, reviewed and screenshot in a plain browser without a
database, in both themes and languages, which is how the UX definition of done is checked.

### ADR-015: `.scraft` is versioned, pretty JSON written atomically

A project file is one JSON document: a header (`formatVersion`, `minReaderVersion`, `savedAt`,
`savedWith`) followed by the content the application holds in memory, `ProjectContent`: the
connection without its password, the inspection options, the snapshot with its access profile
and the canvas state. The header decides how a file is read before its content is interpreted:
an older format is upgraded in memory, a newer one opens read-only when its `minReaderVersion`
allows it and is refused with a classified error otherwise, and keys this version does not know
survive a save (ADR-035). Files are written to a sibling temporary file, flushed to the disk and
renamed over the destination, so a crash or a power cut never leaves a truncated project
behind; the preferences and the exports share the same helper (`src/fs.rs`). Node states are
stored sorted by qualified name, so saving an unchanged project twice yields the same bytes
except for `savedAt`.

Why: the PRD asks for a readable, structured file that reopens without a database. Pretty
JSON with camelCase keys is diff-friendly and matches the IPC payloads, which means one set of
Rust types (`ts-rs` exported) describes the file, the IPC and the frontend state.

The canvas state is the Memento of the diagram: an immutable, serialisable value the canvas
produces when a project is saved and restores when it is opened. Milestone 4 adds the
caretaker (undo and redo) on top of the same value.

Since 1.2 the header says `formatVersion` 3 and `minReaderVersion` 2, and the snapshot can hold
the code of views, procedures, functions and triggers under `programmability`, apart from the
tables and views (ADR-042). A project of 1.0 or 1.1 is upgraded when it is read and saved as
format 3.

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

What the fresh capture could not see is never a change (ADR-034). The diff compares the saved
snapshot with the fresh one merged by `SchemaSnapshot::with_unchecked_facts_from`, so a table, a
view, a text or a foreign key the login can no longer see is listed as not checked, with the
moment it was last read, instead of removed or changed. Texts are compared only when both sides
are readable (`Definition::differs_from`), a default that appears or disappears counts only when
the side that has it knew its state (`Definition::is_known`: readable or not visible), and a
`CHECK`'s enabled flag is compared only when both sides recorded it, and the review marks the
side that is disabled. A key whose referenced table became invisible keeps what the fresh
capture read of its referencing side (columns, actions and enabled flag) and takes only the
referenced table and columns from the saved key, so a change to it is still reported; when its
referencing columns changed, the saved key is not kept at all. Facts the saved snapshot could
not state and the fresh one reads (a text that was not visible or not recorded, a foreign key
whose referenced table became visible, and, next to a 1.0 file, which recorded no access, a
bound default, a default whose text is not visible or a key to an invisible table, none of which
1.0 could hold) are listed as now available, and a new verdict on the login's access sets
`access_changed`. A review
is up to date only when none of these is present either (`SchemaDiff::is_up_to_date`); otherwise
it offers to apply, worded "Update project" when no object changed. Applying runs the same merge
(`ProjectContent::with_refreshed_snapshot`), so the project keeps every fact the review called
not checked and lists it in `snapshot.carriedOver`.

Since 1.2 a state recorded on one side only is never a change: an index or a primary key compares
its enabled, filtered and included-column state only when both snapshots recorded it, a `CHECK`
and a foreign key compare their trust the same way (`ForeignKeyProperty::Trust`, also for a key
whose referenced table became visible or invisible), and `access_changed` compares a coverage of
code only when both captures judged it (ADR-042). A capture that records such a family of facts
for the first time, as the first 1.2 refresh of a 1.1 project records the state of its indexes and
constraints, says so in `SchemaDiff::capture_changes`, one line per family with a count
(`indexAndConstraintStateRecorded`: the indexes, primary keys, `CHECK`s and foreign keys held by
both snapshots whose state is now recorded), never as a change of each object. The one exception is
an index aligned with a partitioned table: 1.1 read the partitioning column as its first key column,
so the first 1.2 refresh reports that index as changed, once (ADR-039). The verdicts the review
needs travel with the diff, computed in Rust: `hasObjectChanges` (the opposite of `is_empty`) and
`isUpToDate`, which also requires no capture line. `reviewChanges.ts` reads them and never works
them out again, so a fact the lists do not show cannot make the review say the project is up to
date. A review with a capture line and no object change offers "Update project", and the panel lists
the line under "Recorded for the first time". Code comparisons, explicit exclusions and failed
optional reads use the same verdicts and are specified in ADR-043.

### ADR-017: Preferences live in one Rust-owned file in the user's configuration directory

The connection history (last ten endpoints, most recent first, never a password) and the
recent projects (last ten paths) are a `Preferences` document stored as
`preferences.json` under the per-user application configuration directory
(`%APPDATA%\com.jmanuelsoberano.schemacraft` on Windows), written with the same atomic writer as
project files. Entries are deduplicated by endpoint (server, database and login, case
insensitive) and by path. The Rust side applies every change and returns the whole document;
the frontend mirrors it in a store and never writes the file itself. A damaged file is logged
and replaced by defaults rather than blocking start-up.

The webview's localStorage holds only conveniences of the window, never a secret and never
domain history, under two keys. `schemacraft.settings` keeps the theme, the language, whether
the entities panel is open and its width, the Inspector's width (never whether it is open: it
starts closed on every launch), and the signatures of the partial-access notices the user closed
(endpoint, database and verdicts; the 50 most recent). `schemacraft.connection`
keeps the last connection draft with the password always blank. Each field of the settings is
checked on its own when it is read back (`mergePersistedSettings`), so a damaged value or one
from another version falls back to its default. Deleting `preferences.json` clears the history
and the recent projects but neither key; clearing the WebView2 data under
`%LOCALAPPDATA%\com.jmanuelsoberano.schemacraft` resets both keys and touches neither the
history nor the remembered passwords.

Why: a file the user can find and back up, consistent with the project format, independent of
the webview's storage, and ready to take theme and language later. Keeping it in AppData rather
than next to the executable keeps the portable build usable from read-only locations. What
stays in localStorage only saves the user a click, so losing it costs nothing.

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
side and bend around, and a self-reference loops out of the right side from the referencing row
to the referenced row; when both ends attach at the same point, the header of a card whose rows
are hidden, each moves `LOOP_SPREAD` off it, the referencing end up and the referenced end down.
Crow's foot markers are described once as data, `RELATION_MARKER_SHAPES` in `edgeGeometry.ts`
(ADR-037), named by what an end says (`many`, `one`, `zeroOrOne`) and each drawn facing its
table, so one orientation, `MARKER_ORIENT` (`auto-start-reverse`), lets any shape serve at either
end: `RelationMarkers.tsx` renders them as
SVG markers painted with `context-stroke`, so they inherit the colour and the emphasis of their
edge, and the exporter renders the same table. Which marker each end gets is decided once, by
`relationEnds` in `graph.ts` from the facts the rule reader states (ADR-039), and drawn in
standard crow's foot notation. `relationPath` routes every edge with one set of smooth-step
options or draws the self-reference loop, `relationOffsets` picks the attachment row at each end,
and `isCollapsible` says whether a card has rows to hide at a detail level, which is when it
shows a collapse toggle.

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
refresh highlights, context menu, layout in progress, whether the Inspector is open and its
request for focus, the rule the Inspector highlights) lives in `canvasUiStore` and is never
saved; the Inspector derives what it shows from the selection and holds no state of its own
(ADR-038, ADR-039). Since 1.2 `selectedModule` and the node-deselection request are transient too
(ADR-044): selecting a module clears selected entities, selecting an entity clears the module,
and a new document or removal of the selected module clears it. No module creates a canvas node,
saved selection or undo step. After a refresh,
`refreshPlacement.ts` places new tables in free space next to the
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
document from the project data with the geometry of ADR-020 (`geometry.ts`, `edgeGeometry.ts`),
the marker table of `edgeGeometry.ts` and the ends `relationEnds` chooses (markers `sc-many`,
`sc-one` and `sc-zero-or-one`, each with the `-active` variant the viewer switches to), so the
file is the canvas drawn again: the visible entities at their positions, collapsed ones
collapsed, at the chosen detail level and theme, with views marked as on the canvas (ADR-036).
Every column name carries its full name in a `data-column` attribute, since the text shown may be
cut short, so the viewer can find the columns of a rule on the drawing (ADR-039). Colours are
the design tokens converted to sRGB hex (`palette.ts`), because renderers outside the browser
understand neither `oklch()` nor `light-dark()`; a test recomputes the conversion, so the palette
cannot drift from `tokens.css` (ADR-037). Styles are plain class rules without combinators, the
subset every SVG consumer shares. The renderer holds no text of its own: the caller passes the
labels it needs already translated (`RenderOptions.labels.view` and `.triggers`), so the exports
speak the interface language and the viewer its own. Text stays text, selectable in SVG and PDF;
names that do not fit are shortened with an ellipsis, measured with a canvas in the webview and
estimated in tests. The renderer is deterministic for a given input, which the unit tests check.

Since 1.2 a neutral trigger pill sits between the VIEW label and the column count in the same
38 px header. Its width is reserved before the entity name is shortened. `geometry.ts` supplies
the count and enabled/disabled variant; the caller supplies the full translated accessible
description, also used as the SVG title. Static exports add a trigger legend only when a badge
is drawn and a separate note when triggers were not read. A mixed capture instead says that
some trigger metadata could not be checked. These notes take measured document space. A
successful capture with no triggers keeps the previous diagram output byte for byte.

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

The HTML export embeds the visible part of the schema as JSON (never the server, the login, the
server version or the access probe: only the database name, the objects on the diagram, their
positions, the verdicts on the login's access, ADR-034, the read dates of the facts kept for
those objects and the subset of the message catalogue the viewer says, ADR-038) together with a
small vanilla TypeScript viewer (`src/viewer`) that draws with the renderer of ADR-023 in the
browser: pan and zoom, the three detail levels, a search whose results name the kind of each
entity, neighbour highlighting, a detail panel per table and view drawn from the view-model the
Inspector draws, its `CHECK`s and keys read out in words with their columns highlighted on the
diagram (ADR-039), and light and dark themes. Its colours are the
application's: `buildStandalonePage` writes the palette of ADR-023 into the page as `--sc-*`
custom properties for both themes, ahead of the viewer's stylesheet, which therefore declares no
colour of its own beyond its shadows (ADR-037). A plugin in `vite.config.ts` bundles the viewer on
demand into a
virtual module (`virtual:schemacraft-viewer`), so the application build stays one command and
the viewer never pulls React or the application stores. Fonts are embedded as `@font-face` data
URLs while "Embed fonts" stays on, as in SVG, adding about 125 KB.

Since 1.1 the viewer has no text of its own: `ViewerData.messages` carries the export language's
subset of `en.ts` and `es.ts` and `createCatalogTranslator` reads it (ADR-007), so an export in
Spanish speaks Spanish in every panel line. The detail panel is `describeObjectDetails` plus
`presentObjectDetails` over the embedded snapshot, with the scope of a file: no hidden entities,
`ViewerData.access` (level and coverage, never the probe) and `ViewerData.carriedOver` (the kept
facts of the objects and keys on the diagram, apart from the snapshot, so a hidden table is
never named), and only the diagram known: a key to a table that is not on the diagram is left
out of the file, together with the FK mark it gives its columns, an empty relation list reads
"None on the diagram" rather than saying there is none, and a list that is not empty carries no
note that a key may be missing. The panel no longer announces its whole content through
`aria-live` on every click: choosing a search result or following a relation link moves focus
to the panel's heading, so a keyboard or screen-reader user lands on the entity they chose.

Since 1.2 the explicit snapshot projection also includes the code capture state, trigger
metadata for visible parents and module settings for visible views. Definitions pass through
`withoutText`; routines, saved module bodies, unknown properties and the carried-code ledger
never enter the file. Whole objects retained without a fresh read are excluded from that subset;
the parent's existing kept-fact date still qualifies its details. Trigger names travel like
index and constraint names. Keys to hidden tables still lose their names and their metadata.
View Definition says "Not included in this file"; WITH CHECK OPTION and indexed-view settings
remain visible when read. Procedures and functions are not exported as objects, although an
exported CHECK or DEFAULT expression may name one.

Why: the user chose the full viewer over pre-rendered pictures; it keeps the file lighter for
large schemas and lets the reader explore. Sharing the renderer avoids a second drawing
implementation.

### ADR-026: The shell behaves like a desktop application, not a web page

Inside Tauri the webview's browser habits are switched off at the window, in the capture phase
so no component can let them through: the browser context menu is suppressed everywhere except
text fields and the read-only code viewer (the diagram and the Objects panel open their own), middle-click autoscroll and
dragging images or links out of the window are prevented, and every accelerator that would
reload, print, find, zoom, navigate history or (outside development) open the developer tools is
swallowed, held keys included. Where the habit has an application meaning it is mapped instead:
F5 refreshes from the database, Ctrl+P exports a PDF, Ctrl+F searches Objects outside the code viewer, Ctrl+Shift+H
shows every hidden entity and Ctrl+Shift+L repeats the last layout; Ctrl+I (the Inspector) and
Ctrl+1 to Ctrl+3 (the detail levels) need no mapping, because WebView2 reserves neither (only
Ctrl+Shift+I, the developer tools). Both side panels, the entities panel and the Inspector,
resize by dragging their edge or with the arrow keys, Home and End, through one handle for
either edge (`PanelResizer` in `shared/ui`), and remember their width. In a window too narrow
for both at their width, `fitSidePanels` (`app/shell/sidePanelWidths.ts`) narrows them, the
Inspector last and neither below its minimum, so the canvas keeps 320 px and the top bar's
controls stay in the window; the remembered widths do not change, and the handles' widest
width follows the room left.

Since 1.2 the code viewer owns Ctrl+F, F3, Shift+F3 and source selection inside its region
(ADR-044). Escape first closes its find field; with find closed it reaches the Inspector and
returns focus home. The source's native context menu remains available for selecting and copying
text, and Tab is never captured. Global actions such as Ctrl+K, Ctrl+I, F1 and F5 retain their
usual behavior outside editable fields.

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

Since 1.1 the notes of the draft release are the version's CHANGELOG.md entry, printed by
`scripts/release-notes.mjs` after what SchemaCraft is, the assets and the code signing policy,
and followed by GitHub's list of pull requests. The script joins the entry's wrapped lines, which
a release page would show as line breaks, and fails when the entry, its date or its link is
missing; the release workflow runs it before building, and CI runs it on every pull request for
the version in `package.json`, so no version reaches a tag without its entry. Users read on the
release page what changed, a new project format included, and the changes are written once.

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
Microsoft's download page when it is missing. Releases ship unsigned while the application is
reviewed; once it is approved, the release workflow submits the executable and the installer
to SignPath and the maintainer approves every signing request.

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
presentation, the resizer both side panels share), and code that composes the application moves
up into `app/` (the command palette). Code that is a feature's behaviour moves out of the shell
into its feature: the diagram canvas, the entities panel and the entities search live in
`features/canvas` and the Inspector in `features/inspector`, and `AppShell` only places them,
each side panel in a named landmark, handing over what belongs to the shell as props: the
welcome screen (`emptyState`), the development hook (`onFlowInit`), the access bar (`notice`),
the registry's show-all command for the context menu and its access-report command and
shortcut hint for the Inspector. Features may still use each other's public modules where one
builds on the other, such as canvas and project, or the Inspector on canvas, project and schema;
the architecture page lists those edges.
`features/schema` is the exception in the other direction: a second lint rule lets it import only
`shared/` and itself, so every feature and the viewer can read entity identity from it without a
cycle (ADR-037).

Why: rules that live only in a document erode with every change. A lint error at the import names
the rule and the way out, in the editor and in CI, so the structure holds as features are added.

### ADR-032: Commands keep blocking work off the main thread

Tauri runs synchronous commands on the main thread, which also drives the window. A command stays
synchronous only when it reads memory and returns at once (`get_app_info`, `read_preferences`,
`cancel_*`). Every command that touches a file, the operating system credential store or a large
computation is `async` and hands that work to `run_blocking` (`src-tauri/src/commands/mod.rs`),
which runs it on the blocking thread pool; a task that cannot be joined is reported as an
`unexpected` error, while a panic ends the process, since release builds abort on panic. The
connection commands look up a remembered password the same way before they open the network
connection.
Commands that need the application state inside the worker take the `AppHandle` and look the
state up there. `PreferencesStore::update` applies a change to a copy and keeps it only after the
file holds it, and a preferences file written by a newer version is never overwritten.

Why: a slow keyring call, a network drive or a diff of a thousand tables must not freeze the
window, and one rule for every command is easier to review than a judgement per command.

### ADR-033: CI runs what a change needs

On a pull request, each CI job first runs `scripts/ci-changes.sh`, which classifies the changed
files. A change limited to `docs/` and Markdown files runs only the frontend gates and the
architecture page check; any other change adds the Rust gates, the build and the smoke test; the
integration job runs its tests when the core, Cargo manifests, toolchain, CI definition,
`dev/postgresql/**`, `scripts/ci-changes*` or `scripts/dev-sqlserver.ps1` change. Fixture Markdown
under `dev/postgresql/` also requires the native matrix. The executable for the smoke test is built with the `ci` Cargo
profile (release without link-time optimisation), which halves the build time; release.yml keeps
the full release profile. Pushes to `main` run everything, which also keeps the build cache warm
for the next pull request. The classification runs inside each required job instead of in a
separate job, because a job skipped through a failed dependency would count as passed.

Why: a pull request that only touches the documentation should not wait fifteen minutes for a
Rust build, and the required checks must still fail closed when the classification itself fails.

Since 1.2 the integration job reads SQL Server 2019 as well as 2022. It has two services, `mssql`
(2022) on port 1433 and `mssql2019` on 1434, and two steps that run the SQL Server test binaries,
one against each server. Each step names the major version its server must report in
`SCHEMACRAFT_TEST_MSSQL_MAJOR`, and `connects_to_the_expected_major_version` checks it, so a wrong
port cannot test one version twice. The 2019 step runs after a failure on 2022 as well
(`!cancelled()`), so one run reports both versions; it reuses the binaries the first step built,
and the job's timeout grew from 30 to 40 minutes. A matrix would be the usual shape, but GitHub
names each matrix job after its values and the branch ruleset requires this check by name, so two
services in the one job keep the required check without a change to the ruleset. The job also sets
`SCHEMACRAFT_TEST_REQUIRE_SERVER=1`, under which a missing server variable fails every SQL Server
test instead of skipping it, so the job can no longer pass without having reached a server. The
four SQL Server binaries are `sqlserver_integration`, `sqlserver_permissions`,
`diagnostics_privacy` and `sqlserver_code`; the last also verifies the independently captured
dependency family.

The unreleased native PostgreSQL increment extends that same Linux job with dedicated
PostgreSQL 15, 16, 17 and 18 fixtures, ephemeral TLS certificates and sequential
`postgresql_integration` runs. `dev/postgresql/Test-Fixtures.ps1` requires a real server, verified
TLS and the expected major for each run, and refuses another active Cargo process. Optional
catalog stages, restricted roles, refresh retention, native facts and transport/privacy cases
belong to this matrix. The required check names remain `Lint, test and build (Windows)` and
`SQL Server integration tests (Linux)`; the latter now covers both providers. Classification
tests exercise frontend-only, documentation-only, fixture, classifier and core changes without
accessing Git. Changing native fixtures therefore cannot silently skip the integration gate.

### ADR-034: Honest access: one access probe, and unknown is not none

A login may see only part of a database, and SQL Server says so silently: the catalog views
leave out the objects it cannot see and return `NULL` for the texts it cannot read. SchemaCraft
1.0 showed those gaps as facts: an empty `CHECK` expression, a column without a default, no
foreign key. Since 1.1 the application measures what the login can see and never presents a gap
as an absence.

One access probe per database (`inspectors/sqlserver/access.rs`), a single batch with two
result sets, reads the facts: `VIEW DEFINITION`, `SELECT` and `VIEW SECURITY DEFINITION` on the
database; the explicit `DENY` rows on `VIEW DEFINITION`, `SELECT` and `CONTROL` for the login's
user and its roles, at the database, schema and object level (an object row only for the object
itself, so a column `DENY` hides nothing), and none for `dbo`, which `sysadmin` members and the
database owner enter as, since SQL Server applies no denial to it; whether any user table or
view is visible; the
database user when the login has one of its own; and, per schema, the two grants, a denial flag
and whether it holds a visible table or view. `describe_database` runs it when a database is
selected, in place of the schema listing, and every inspection runs it next to the catalog
queries as the `CheckingAccess` stage. Pure rules in `model/access.rs` turn the facts into a
level (`full`, `partial`, `empty`, `nothingVisible`) and a coverage per kind of fact. Only the
object list and the `CHECK` and `DEFAULT` texts can be partial, because the columns, keys,
indexes and foreign keys of a visible table need no further permission. A login that sees
nothing reads as `empty` only when it could have seen everything (`VIEW DEFINITION` on the
database and no denial); otherwise it is `nothingVisible`, since SQL Server cannot tell an empty
database from a hidden one, so a `db_datareader` member on an empty database reads as nothing
visible. A login with `VIEW DEFINITION` and without `VIEW SECURITY DEFINITION` cannot see its
own denials, which then count as unknown. The profile (the facts, the scope they were judged in
and the verdicts) is frozen in the snapshot as `SchemaSnapshot.access`, and a file without one
says "not recorded". The prediction made at database selection and the capture can disagree,
for instance when `OBJECT_DEFINITION` still returns a bound default to a reader.

The model keeps unknown apart from none. `CHECK` and `DEFAULT` texts are a `Definition`:
`readable { text }`, `notVisible`, `notRecorded` (an upgraded 1.0 file could not tell) or
`unknown`, the fallback for a status written by a newer version. Whether a column has a default
comes from `sys.columns.default_object_id`, which every login sees, and legacy bound defaults are
read with `OBJECT_DEFINITION`. A foreign key whose referenced table the login cannot see is kept
in `foreignKeysToInvisibleTables` with its local columns, actions and enabled flag: its columns
keep the key badge, no edge is drawn, and its rules are worded against "the referenced table"
(ADR-039). A refresh that sees less keeps what it cannot check (ADR-016).

The interface discloses in grades (`src/features/access`). Full access adds nothing. Partial
access adds one polite line in the connection dialog; a dismissible bar above the entities list,
remembered per endpoint, database and verdict, which moves focus to the entities search when it
closes; a quiet chip in the status bar; and "not available" wherever a `CHECK` or `DEFAULT` text
is shown. Lists, counts and empty states say "none" only under complete coverage, so the sidebar
shows one muted footer instead and the status bar leaves out a count of zero. The Access report
(`view.accessReport`, Ctrl+Shift+A) shows the coverage, the keys to invisible tables, the facts
kept from earlier reads with their date, the permissions per schema and a copyable
least-privilege script, `GRANT VIEW DEFINITION TO [user]`, whose comments say that on SQL Server
2022 and later the permission also shows users, roles and permissions. SchemaCraft never runs
it, and does not offer it when a `DENY` explains the gap, because a grant does not lift a
denial. A login that sees nothing gets a danger notice and cannot start a read; an empty
database gets neutral notes and empty states. An export of a partial capture says so in one
line (a footnote in SVG, PDF and PNG, a header line in HTML), and the HTML export embeds the
verdicts (level and coverage), never the probe (ADR-025). The wording is "not visible to this login" and "no visible para este inicio de sesión",
never "hidden" or "oculto", which mean hidden on the canvas. CI reads one fixture database as
logins with each of these profiles (`tests/sqlserver_permissions.rs`).

Why: SchemaCraft is used to understand a database, and a missing table, text or relationship
that looks like an absence is a false statement the user will act on. SQL Server cannot tell
the user, so the application must. One probe classifies every tested permission profile in one
round trip, `VIEW DEFINITION` is the single grant that completes the schema without exposing
data, and disclosing in grades keeps the common case, full access, free of warnings.

Since 1.2 the access probe is verified on SQL Server 2019 as well as 2022 (ADR-033). SQL Server
2019 does not know `VIEW SECURITY DEFINITION`: `HAS_PERMS_BY_NAME` answers `NULL` for it, to `sa`
too, and a `DENY` of it is a syntax error, so a login with `VIEW DEFINITION` sees its denials and
counts them, which the 2019 run pins. The branch where the count is unknown has a login of its
own, `schemacraft_vd_deny_vsd` in `permission_logins_2022.sql`, created only where the server
reports major version 16 or later: `VIEW DEFINITION` with `VIEW SECURITY DEFINITION` denied. SQL
Server then hides every denial from it, its own included, and its own row in
`sys.database_principals`. Since 1.2 the probe falls back to `USER_NAME()` for this current user
only, so `databaseUser` is populated while `explicitDenials` stays `null`. Its capture reads every
object and text yet vouches for no absence: the level is partial, with a partial object list,
complete texts and the one cause that the login cannot see its denials. Code visibility has
separate rules and counts (ADR-043); it never changes this table-access verdict.

### ADR-035: Project format 2 reads forward: two version numbers, migrations, kept unknown keys

The header of a project carries two numbers, like the read and write versions of an SQLite
file: `formatVersion`, the format the file follows, and `minReaderVersion`, the oldest format a
reader must understand to open it. This version writes format 2 with `minReaderVersion` 2.
`read_project` parses the JSON once and reads both before the content. A file whose
`minReaderVersion` (by default its `formatVersion`) is above 2 is refused as
`UnsupportedFormatVersion`; a newer format within that limit opens read-only; an older one is
upgraded in memory. A newer file whose content this version cannot parse is refused as
unsupported as well, never reported as damaged: a value it does not know is not damage. The
command returns an `OpenedProject` with `isReadOnly`. A read-only project can be rearranged and
exported, is never marked unsaved and cannot be saved, saved as or refreshed; a status-bar chip
says so and names the version that wrote it.

Upgrades live in `project/migrations.rs`, one step per format, applied to the raw JSON before
the typed parse. They never fail and leave what they do not recognise alone, so the parser still
reports real damage. Format 1 to 2 turns each `CHECK` and default text into a readable
`Definition` and an empty one into `notRecorded`, and marks a missing default `notRecorded` in a
schema that had an empty `CHECK` text, where 1.0 could not read texts; the snapshot gets no
access profile and `CHECK` constraints no enabled flag. A 1.0 file is saved as format 2, which
1.0 refuses with its own message.

Keys this version does not know are kept at four levels, the document root, the snapshot root,
the canvas and each node, in flattened `unknown` maps that the contracts leave out
(`#[ts(skip)]`). The frontend carries them along, and `Project::new` drops header keys found
among them, so the header is never written twice. Snapshot keys go when a refresh replaces the
snapshot, and exports never embed any of them (ADR-025). `#[serde(other)]` stays in an attribute
of its own, because ts-rs drops a serde attribute with a key it does not model, and the
workspace enables ts-rs's `no-serde-warnings` so the fallback prints no warning on every build.

The rule for adding data: a new fact inside tables, views, columns, keys, indexes or
constraints, a new value of any persisted enum, or a changed meaning raises `formatVersion`,
because an older version would drop or misstate it on save, and with the higher number it opens
the file read-only instead. `minReaderVersion` rises too when an older reader would misread the
file rather than merely miss something: a changed meaning, or a new value of a closed enum such
as `AccessLevel`, `Completeness`, `SnapshotFact`, `IndexKind`, `ReferentialAction`,
`DetailLevel` or `LayoutKind`, which the older parser cannot read. `Definition` is the open
exception, since older readers show an unknown status as "not available", and a new enum may
take the same kind of fallback. A key at one of the four kept levels that stays true whatever an
older version does around it, such as a colour per node, needs no bump. Every bump adds a
migration step, a fixture file of the previous format and a test that it upgrades and saves.

Why: format 2 is a one-way door for 1.0 users, so the doors after it should open both ways. Two
numbers let a later version add facts without locking 1.1 out, opening read-only keeps an older
version from destroying what it does not understand, and migrations on raw JSON keep today's
types free of yesterday's shapes.

Since 1.2 SchemaCraft writes format 3 with `minReaderVersion` 2 (ADR-042), refuses a file whose
`minReaderVersion` is above 3 and upgrades formats 1 and 2. Keys a newer version wrote are kept at
five levels: the snapshot's `programmability` joins the four above, so later families of code can
arrive without a bump. Format 3 adds only keys that 1.1 keeps or ignores and changes neither a
meaning nor a closed enum, which `project/forward_read.rs` tests, so 1.1 opens a 1.2 file read-only.
`migrations::format_2_to_3` rewrites the header only, and `fixtures/format-2.scraft`, written by the
SchemaCraft 1.1.0 core, is the fixture of the previous format.

### ADR-036: Tables and views are told apart by section, label, icon and colour

A database view is drawn as a card like a table, and 1.0 told them apart only by a tint on the
header and a grid icon, which a grayscale print and a quick glance both lost. Since 1.1 the
distinction is made in several ways at once, everywhere an entity appears.

The entities panel (`features/canvas/EntitiesSidebar.tsx`) groups the entities by schema and,
inside each schema, in a Tables and a Views section with a count. A level that distinguishes
nothing is left out: one schema, no schema headers; one kind, no kind headers. The shape is
decided on the unfiltered list (`entityListShape` in `features/schema/entities.ts`), so the panel
keeps its structure while the user types. Headers are buttons with `aria-expanded`; a schema or
a section collapses for the session only, never into storage, and while a search is active
everything is expanded and the toggles are disabled, so a match is never hidden in a collapsed
section. An absent kind omits its level the same way, and under partial coverage the single
footer of ADR-034 stays the honest marker, so an omitted Views section never claims "none".

Since 1.2 this panel is named Objects and also lists procedures and functions (ADR-044). Those
two sections always keep their kind headers when present, even when a schema contains only one
routine kind, and start collapsed. The existing singleton-header rule still applies to tables
and views. Searching opens matching sections temporarily without changing their session state.

On the canvas a view carries a solid VIEW label (VISTA in Spanish, key `entity.view.label`)
between its name and the column count, the Lucide Glasses icon, the convention of SQL Server
Management Studio, and the `--color-view` tokens, a teal (hue 195) well apart from the violet of
selection; no dashed border and no italics. The schema prefix on the tinted header uses
`--color-text-secondary`, so the text keeps AA contrast. At the Keys level a view has no key
rows, so it is a header-only compact card with the label and its count: the same 38 px box as
before, which leaves saved layouts and `spreadForDetailLevel` untouched. The collapse chevron
shows only when `isCollapsible` (ADR-020) finds rows to hide, and the minimap tints views through
React Flow's `--xy-minimap-node-background-color`. The SVG renderer draws the same header (view
tint, label pill, Glasses symbol, secondary schema text) with the label passed in as
`RenderOptions.labels.view`, which `exportStore` translates in the interface language, so SVG,
PDF and PNG match the canvas; the HTML viewer passes the same `entity.view.label` from the
catalogue subset embedded in the file (ADR-038), and names the kind next to every search result
and in its detail panel. The command palette shows a kind icon and a Table or View label on
every entity row.

Since 1.2, a separate neutral trigger pill is present at all three detail levels and
at semantic zoom. A solid outline and Zap icon count enabled triggers; when all are disabled,
a dashed outline and ZapOff icon count the total instead. INSTEAD OF is expressed in the
translated accessible description, tooltip and SVG title. No colour alone carries its state,
and the header remains 38 px high in the canvas and every export.

The word "view" therefore means a database view and nothing else in the interface, in both
languages: the viewport commands read "Fit diagram to window" and "Center on screen" ("Ajustar el
diagrama a la ventana", "Centrar en pantalla"), and compact, keys and full are detail levels.

Why: WCAG 1.4.1 asks that colour never be the only signal; a label survives a grayscale print,
and a label plus an icon survives a glance. The selection ring stays violet and the view tint
teal, so the two never blend. Deciding the levels on the unfiltered list keeps the panel from
reshaping on every keystroke, and keeping the box of a view unchanged keeps every existing
project opening exactly as it did.

### ADR-037: Each drawing rule has one home, and a test keeps it there

Three rules of the diagram had drifted into copies: the `schema.name` identity of an entity and
its kind lived in four modules; the crow's foot markers and the smooth-step routing were written
once for the canvas and once for the SVG renderer; and the colours existed as `oklch()` tokens,
as hand-converted hex in `palette.ts` and again in `viewer.css`, with stray `oklch()` values in
several CSS Modules. Each rule now has one home, and where a rule can be checked by a machine, a
lint rule or a test keeps it there.

Entity identity: `src/features/schema/entities.ts` is the only module that spells `EntityKind`,
`ENTITY_KINDS`, `entityKey` and the entity list (`listEntities`, `groupEntities`,
`filterEntityGroups`, `countEntities`, `entityListShape`). The canvas, the command palette, the
status bar, the review panel, the access report, the exports and the viewer import them from
there; `shared/ipc`, which may not import features, compares names field by field where it filters
canvas nodes (`previewProjectBackend.refreshProjectContent`), and the DEV-only preview fixture
keeps a `Map` key of its own (`nameKey` in `previewAccess.ts`) that never stands in for the
`schema.name` identity string. ESLint makes `features/schema` a leaf among the features: it may
import only `shared/` and itself (ADR-031), so the viewer bundle can always take it and no entity
helper can grow a dependency on a store.

Entity keys are opaque: each schema and object component escapes `%`, `.`, `[` and `]` before
joining with a dot. Thus `[a.b].c` and `a.[b.c]` remain distinct, literal escape-looking names
cannot alias encoded names, and entity keys cannot collide with tagged JSON module keys.
`foreignKeyId` applies the same encoding to the constraint name, including in layout input.
Human text uses `qualifiedNameLabel` or `displayIdentifier`, which delimit dotted or bracketed
identifiers using SQL Server brackets. Searches use the original names rather than encoded keys.
The saved project and Rust comparisons already use separate schema/name fields, so this changes
neither the project format nor saved positions. Older projects regain independent nodes when
opened; already-lost layout choices cannot be reconstructed.

Markers and routing: `canvas/edgeGeometry.ts` holds `RELATION_MARKER_SHAPES` (the width,
reference point, path and optional circle of each marker kind), `MARKER_HEIGHT`,
`MARKER_REF_Y`, `MARKER_ORIENT`, `startMarkerKind`, `endMarkerKind` and `relationPath`, which
routes an edge with one set of smooth-step options or draws the self-reference loop;
`geometry.ts` holds `relationOffsets`, the row at which each end attaches, and `graph.ts`
`relationEnds`, the marker kind of each end of a key. `RelationMarkers.tsx` renders its
`<marker>` elements from the table under the ids of `canvas/relationMarkerIds.ts`, and
`RelationEdge.tsx` and `renderDiagram.ts` call the same functions. The refactor was checked by
comparing the renderer's output byte for byte before and after it. The standard notation of
ADR-039 later changed what the table draws and named its kinds by meaning, not where it lives;
`src/viewer/viewerStyles.test.ts` checks that `viewer.css` swaps every marker the renderer puts
at either end for its own `-active` variant.

Colours: `src/app/styles/tokens.css` is the only place a theme colour is written (ADR-006).
`palette.ts` is its sRGB derivation, and `PALETTE_TOKENS` names the token each entry converts;
`src/app/styles/tokens.test.ts` redoes the OKLab conversion and fails on any drift. The same test
reads every `*.module.css` and `viewer.css` as text, which vitest hands through only for `?raw`
imports (`test.css.include` in `vite.config.ts`), checks that it read them, and fails on a raw
hex or `oklch()` colour (`url(#id)` references and relative `oklch(from ...)` colours excepted).
`buildStandalonePage` writes the palette into the HTML as `--sc-*` custom properties for both
themes (`viewerPaletteStyles`), so `viewer.css` holds no colour of its own beyond its two
translucent shadows, which the test does not police. A new colour is a
token first and then, when an export or the viewer needs it, a `DiagramPalette` entry with its
`PALETTE_TOKENS` line; the test's failure message prints the expected hex.

The trigger badge follows the same rule: `geometry.ts` owns `triggerBadge` and
`EntityDescriptor.triggers`, and `triggerBadgeText.ts` owns the translated description. Both
canvas and exports consume these values. Unread or unverified trigger metadata cannot produce
a current count; a successful capture with no triggers draws no badge.

Why: a copy that is "kept in step" by hand is a bug waiting for its second editor, and the
viewer's key badge had already drifted from the application's warning colour. One module per
rule, a lint rule where a module boundary carries the rule and a test where a value does, keep
the canvas, the exports and the viewer the same diagram without anyone having to remember to
sync them.

### ADR-038: The Inspector and the viewer's detail panel share one view-model

Since 1.1 the application has an Inspector: a panel on the right of the canvas with the details
of the selected table or view, its columns (type, nullability, identity, computed, default),
primary key, indexes, `CHECK` constraints and the foreign keys out of it and into it, each fact
with how far the capture vouches for it: readable, not available to this login, not recorded by
a 1.0 file, or not checked since the date it was last read (ADR-034, ADR-016); a `CHECK` or
`DEFAULT` inside a table or view kept whole carries the object's date, or its own earlier one
when it was kept on its own before. The exported HTML viewer has had a detail panel since 1.0. Both now draw one view-model, in two modules of
`features/schema`: `objectDetails.ts` holds the facts (`describeObjectDetails(snapshot, key,
scope)`), the only place the details are built from the snapshot, which reads `Definition`
through `definition.ts` (`definitionText`, `isUnknownDefinition`, the readers of table-expression
statuses) and the carried facts through the scope, and `objectDetailsView.ts` the presentation
(`presentObjectDetails(details, translator)`), every title, badge, value, empty line and
footnote already translated. The React panel (`features/inspector`) and the vanilla viewer
(`src/viewer/main.ts`) only lay that text out, one renderer per section kind, so both show the
same sections in the same order with the same words and states, and the readable rules of
ADR-039 extend the `CHECK` and key items without a third path. The `scope` argument states what
the renderer knows beyond the snapshot: the entities hidden on the canvas, the access coverage,
the carried facts, whether the read was limited to some schemas and whether only the diagram is
known, as in an exported file. That is where the two differ: the file knows only the diagram
(ADR-025), so it leaves out keys to tables that are not on it, an empty relation list reads
"None on the diagram", and it offers no "Why?" link.

Every applicable section appears, in a fixed order, and an empty one prints one line whose
wording follows the completeness of the list: "None" only when the list is known to be
complete, otherwise "None visible to this login", "None recorded", "Not checked since", "None
on the diagram" or "None in the inspected schemas". "Referenced by" carries a footnote under
partial coverage, because tables the login cannot see may reference the table. The target of a
relation is a link when the table is on the canvas, "Hidden on the canvas" when it is hidden,
"This table" for a self-reference and "A table not visible to this login" for a key kept in
`foreignKeysToInvisibleTables`. In the Inspector every not-available value and every
not-visible line carries a "Why?" link to the Access report; the exported file cannot offer one.

The panel is a complementary landmark the shell places (`<aside aria-label="Inspector">`),
never `role="dialog"`, so shortcuts keep working while it is open. It starts closed on every
launch, remembers only its width (280 to 560 px, default 360, in `schemacraft.settings`,
ADR-017; narrower in a window without room for it, ADR-026) and follows the canvas selection:
one selected entity shows its details, none or several show an empty state, and an entity
hidden on the canvas cannot be shown, because it has no card to select. It opens with Ctrl+I,
the top-bar button or the palette (all three `view.toggleInspector`), a double-click on a card
or on a sidebar row, Enter on a focused card, or "Show details" in the context menu. A
double-click leaves focus where it was, so the pointer goes on working on the canvas; every
other way in moves focus to the panel's heading, and so does following a relation link, "Show
details" included when it is chosen with the mouse, because the closing menu leaves focus
nowhere. Enter is handled by the canvas only when the focused element is the card itself, never
as a global shortcut, so the buttons inside a card keep it. Escape anywhere in the panel, its
resize handle included (the shell passes the handle in, and the panel draws it inside the
element that handles Escape), returns focus to the inspected card, or to the canvas when the
card is not rendered, and leaves the panel open; Ctrl+I and the close button close it, and
`returnFocusFromInspector` hands focus back to the card before the panel turns inert, so focus
never drops to the document. The open state and the focus request live in `canvasUiStore`
(ADR-021); the panel itself holds no state.

The viewer takes the embedded subset of the message catalogues through the shared translator
(ADR-007), the access verdicts and the read dates of the kept facts of the objects on the
diagram (ADR-025), and its own catalogue is gone.

Since 1.2 the same Inspector also follows a selected procedure, function or trigger (ADR-044).
Their facts and presentation are separate modules, `moduleDetails.ts` and
`moduleDetailsView.ts`, with `module.*` messages excluded from the embedded viewer catalogue.
Tables and views also share a Triggers section, after the CHECK constraints on tables; views
end with Definition. Trigger events retain their First/Last order and disabled/replication
marks, sorted by INSTEAD OF then AFTER, enabled state and name. "None" requires a successful
trigger-metadata read for that parent; missing, failed and retained reads keep distinct states.
`DetailsScope.definitions` says whether source may be shown. The shared Definition view-model
contains metadata only: the app resolves its code viewer from the snapshot, while HTML says
"Not included in this file". Both retain recorded WITH CHECK OPTION and indexed-view badges.
Only the app offers Open trigger. No source text or module pages enter the HTML detail model.
Escape and closing the Inspector use
the selected object's home: an entity card, a trigger's parent card, or a routine's Objects row,
with the Objects search field as the module fallback.

Why: a second implementation of the details would drift from the first within a release, and
the exported file is where other people read the schema, so it must say what the application
says, with the same honesty about what the login could not see. One module and two renderers
is the rule ADR-020 and ADR-023 already apply to the diagram. A non-modal panel that mirrors
the selection has no state to fall out of step with the canvas, and keeping Enter inside the
canvas keeps every other button in the interface working.

### ADR-039: Readable rules are derived in TypeScript from the stored definitions

Since 1.1 the Inspector and the viewer's detail panel read `CHECK` constraints and foreign keys
out in sentences in the interface language, with the SQL one click away. The readers are pure
TypeScript in `src/features/schema/rules`, inside the `features/schema` leaf (ADR-037), so the
Inspector and the viewer run the same code over the same snapshot. Nothing is computed in Rust
and neither the `.scraft` file nor the JSON an HTML export embeds gains a field: the sentences are
worked out where they are shown.

The `CHECK` reader reads the text SQL Server stores in `sys.check_constraints.definition`,
through `definition.ts` (ADR-038), in three steps: `tokenizeCheck` (`checkTokens.ts`),
`parseCheck` (`checkParser.ts`, recursive descent with T-SQL precedence, where NOT binds looser
than a comparison, as SQL Server stores it, with a depth bound) and `readCheckConstraint`
(`checkReader.ts`). It knows a closed set of forms: comparisons with a literal, with the time
now or between two columns, with date wording for date and time columns; inclusive ranges;
`IN` and `NOT IN` lists, which SQL Server stores as a reversed OR chain and the reader gives back
in the written order; `IS [NOT] NULL`; `LIKE` shapes (starts with, ends with, contains, digits
only, any other pattern with a note on how patterns read); `LEN` and `DATALENGTH` limits and the
not-blank idioms; AND lists; explicit NULL guards; and an OR, worded as "at least one of these
must hold", only when no branch can be unknown. Reading is all or nothing: a function it does not
know, arithmetic, a name that is not a column of the table, or any other form outside the set
reads none of the expression. The item then says the rule cannot be put into words and shows the
stored SQL, open from the start, and the columns its tokens name still highlight. An item starts
over when a refresh changes its rule's SQL or readability (`sqlDisclosure.ts`), and the Inspector
mounts new items for each entity, so two tables' `CHECK`s that share a name never share a state.

A wrong sentence is worse than none, so every sentence states only what SQL Server enforces when
a value is written. A `CHECK` accepts a row whose expression is unknown, so a rule over a
nullable column sits under "When … has a value:", an OR other than a list of values is left
unread when NULL could make one of its branches unknown, and so is any comparison with a NULL
literal (`Status IN ('A', NULL)` accepts every value). A disabled `CHECK` reads under "When
enabled:", and one from a 1.0 file, which did not record its state, under "If enabled (this file
did not record whether it is):". Text comparisons and patterns carry a note that they follow the
column's collation, which the model captures only from v1.2, and that two texts differing only
in trailing spaces are equal; lengths say "not counting trailing spaces". Patterns are subtler:
a `char` or `varchar` value with trailing spaces still ends with a suffix, while an `nvarchar`
one, or any value against an `N'…'` pattern, does not, so a suffix says which applies, and a
trailing space is refused by digits only like any other character. `char` and `nchar` pad a
shorter value with spaces, and `LIKE` sees them. A prefix, a text contained and a suffix outside
Unicode read as on `varchar`, since the padding comes after the value and is taken by the closing
`%` or need not match; everything else is left unread on these types: a Unicode suffix (an
`nchar` column or an `N'…'` pattern) refuses every value shorter than the column, a `_` can match
a padding space (`'A'` passes `LIKE 'A_'` on `char(5)`), a Unicode pattern can fail on one
(`'AB'` fails `LIKE N'[A-Z][A-Z]'` on `nchar(5)`), and digits only refuses the empty value its
sentence accepts. The time now reads "the
server's date and time when the value is saved", because SQL Server checks a `CHECK` again only
when a statement writes one of its columns.
Comparisons whose meaning depends on the session or on a conversion stay unread: a `'YYYY-MM-DD'`
literal against `datetime`, which `DATEFORMAT` changes, a `date` column against `getdate()`, text
ordering and float literals among them. Each section with rules in words ends with one note that
SchemaCraft words them from their definitions and that SQL Server checks them when values are
written, so rows saved before a rule existed may not follow it.

The foreign key reader (`foreignKeyReader.ts`) uses row phrasing with the tables as chips, always
`schema.name`: "Each row in sales.Orders belongs to exactly one row in dbo.Customers", "Cada fila
de sales.Orders pertenece exactamente a una fila de dbo.Customers". No table name is turned into
a noun, so no sentence guesses a singular or a Spanish gender. Whether the link is required
(`foreignKeyOptionality`) follows SQL Server's rule for composite keys, MATCH SIMPLE: a key is
checked only when every one of its columns has a value, so it is optional as soon as any column
accepts NULL. How many referencing rows a referenced row can have (`foreignKeyChildCardinality`)
is at most one only when the primary key or a unique constraint of the referencing table lies
within the key's columns; a unique index alone leaves that sentence out, because the snapshot
does not record whether an index is filtered, and a filtered one allows several. Nor does the
snapshot record whether an index is disabled, a known limitation: a unique constraint or a
nonclustered primary key whose index is disabled limits nothing, yet still yields "at most one"
and the one-to-one marker until the snapshot captures index state, as the engine tests pin.
Then come what deleting and changing a referenced row do, for each action. NO ACTION is checked
once the statement has run, cascades included, so one statement can delete a row with the rows
that point to it, re-key a row that points to itself along with its own column or swap two keys:
its sentences say a delete is blocked if, once the statement has run, rows still point to the
row, and a change if they still point to its old value and no row has it. SET DEFAULT says the
columns take their default values, or NULL when they have none, and takes a neutral wording when
a default is not available, not recorded or kept from an earlier read; when the referenced key
is one identity column, which never changes, the update sentence is left out for NO ACTION and
says the action has no effect otherwise; a self-reference says "of the same table, which may be
itself", and its NO ACTION sentences speak of the rows of the same table.
A key to a table the login cannot see (ADR-034) gets a sentence that it belongs to a row in a
table not visible to this login and its actions against "the referenced table", with no
parent-side sentence. Explanations are cached per snapshot in a `WeakMap`; an `ExplanationScope`
brings what the exported snapshot travels without (whether an access profile exists and the kept
facts), so the viewer words SET DEFAULT as the application does. The SQL of a key is scripted
from the catalog as an `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY … REFERENCES …` statement
with `quoteIdentifier` (`sqlIdentifiers.ts`); a disabled key is added `WITH NOCHECK`, since
adding a key checks the rows already there and a disabled one may have let in rows that do not
follow it, then disabled with a `NOCHECK CONSTRAINT` statement. A note under the SQL says it is
not the statement that created the key; a key to an invisible table has no SQL and no
disclosure, since there is nothing to reveal.

Sentences are data (`ruleText.ts`): a reading is a tree of `RuleNode`s, sentences and groups with
a heading, whose texts are message keys with typed arguments (a column, a list of columns, a
table, a literal, a list of values, the time now, a keyword, a count), never text.
`formatRuleText` turns one into text, column, table and code parts through the translator's
`template`, `formatMessageParts` and the plural rules of ADR-007 and `Intl.ListFormat`, so
"'A', 'I', or 'S'" reads "'A', 'I' o 'S'" in Spanish and nothing is concatenated. The view-model
of ADR-038 carries each `CHECK`'s reading and each key's explanation as a `RuleView` (sentences,
the line for a rule it cannot read, the SQL and its note, and the columns and relationship it
involves) and each section's notes; `RuleItem.tsx` in the Inspector and `src/viewer/rules.ts`
draw it.

Pointing at a rule with the pointer, or focusing one of its controls (the highlight adds no tab
stop of its own), sets `canvasUiStore.ruleHighlight` with an owner: only the item that set it
clears it, and closing the Inspector or a real change of selection clears it too. Each card
reads only its own entry. A card the rule involves gets a 2 px accent outline 3 px off the card,
which never reads as the selection ring that hugs it, so both show on a selected card; the rule's
rows get the subtle accent tint, a 2 px accent bar at their start and the name in the accent text
colour, with the type in secondary text for AA contrast. Only colours change, never the weight
or the size, so rows and anchors stay where they are; at the Keys or compact level, or on a
collapsed card, the outline alone says it. A key's relationship is emphasised without opening its
label, which would cover the columns, and the Inspector's columns table tints the same rows. A
table chip is a button only for the item's other table, out of the tab order (`tabIndex` -1),
because the item's target link already takes the keyboard there. The viewer does the same with
its own classes and inserted shapes (`sc-rule-outline`, `sc-rule-tint`, `sc-rule-bar`,
`sc-rule-column`, `sc-rule-relation`), as compound selectors that win over the SVG's own rules,
finds the columns through `data-column` (ADR-023), suspends its neighbour highlight while a rule
holds the emphasis, ignores pointer moves inside the panel and repaints the highlight when
`render()` replaces the SVG, which no longer rebuilds the panel, so a change of theme or detail
level keeps the keyboard where it was. The relationship's hover label on the canvas adds its ON
DELETE sentence, under "When enabled:" for a disabled key. Each HTML export grows by about 43 KB:
some 31 KB of viewer script, mostly the readers, 2 KB of styles and 10 KB of rule messages.

The diagram draws the same facts in standard crow's foot notation: `relationEnds` (`graph.ts`)
calls `foreignKeyChildCardinality` and `foreignKeyOptionality` on the referencing table, so the
markers and the sentences cannot disagree. The referencing end is a crow's foot, or zero or one
for a one-to-one key; the referenced end is a bar, or a bar and a circle (zero or one) when any
key column accepts NULL. 1.0 meant a circle at the referencing end when every key column
accepted NULL, and drew it and the crow's foot under the referencing card, where neither showed;
existing diagrams and exports therefore look different in 1.1.

The golden forms keep the reader honest. `fixtures/sqlserver/check_forms.json`, in
`crates/schemacraft-core/tests`, holds 72 synthetic cases on one table with structured columns,
each as written, as stored and as it must be read, 21 of them unread. `sqlserver_integration.rs`
builds `SchemaCraftCheckForms` from it and asserts every stored form, column list and enabled
state against SQL Server 2022, and `checkReader.test.ts` reads every stored form against the same
columns. Two more integration tests pin, on scratch tables (`rule_facts.sql`), the engine facts
the wording rests on: a `CHECK` accepts unknown and a NULL in `IN` accepts every value, equality
ignores trailing spaces, `LIKE` ignores them only outside Unicode and a pattern can refuse them,
`char` and `nchar` pad with them and `LIKE` sees the padding (suffixes, exact patterns, `_` and
`NOT LIKE`, against Unicode and plain patterns), a disabled key checks nothing and cascades
nothing, adding a key checks the rows already there unless it is added `WITH NOCHECK`, NO ACTION
is checked once the statement has run (a self-referencing subtree deleted at once, a row that
points to itself re-keyed with its pointer, swapped keys, a row deleted by another key's
cascade), a row with a NULL in a column of a composite key is not checked, an identity column
cannot be updated, SET DEFAULT sets NULL where a column has no default, and neither a filtered
unique index nor a unique constraint whose index is disabled keeps a referenced row to one
referencing row. A new form starts as a golden case.

Why: interpreting the stored definitions where they are shown keeps one module for two renderers
and leaves both file formats alone, while a reader in Rust would freeze sentences of one language
into the snapshot or need a second implementation for the viewer. A closed grammar with a
conservative fallback can only say too little, never something false, and a golden table checked
against the engine catches a normal form that changes before a sentence goes wrong; a later
consumer outside the frontend can port the table rather than the reasoning. Row phrasing reads
right for any table name in either language, and markers chosen by the functions that word the
sentences cannot contradict them.

Since 1.2 the golden forms and the engine facts are asserted against SQL Server 2019 as well as
2022 (ADR-033). SQL Server 2019 stores all 72 forms exactly as 2022 does, with the same columns and
enabled states, and behaves the same on every scratch table, so `check_forms.json` keeps one stored
form per case. Should a version store a case differently, the file records that version's form for
the case beside the other, and the test checks each against its own version; a case is never
skipped on a version.

Since 1.2 the snapshot records whether an index or a primary key is enabled and whether an index is
filtered (ADR-042), which lifts the known limitation of 1.1.0 described above. A disabled index
enforces nothing, and a filtered unique index limits only the rows its filter selects.
`foreignKeyChildCardinality` judges the primary key, the unique constraints and the unique indexes
that lie within the key's columns: the primary key and a unique constraint hold unless they are
recorded as disabled, and a unique index holds only when it is recorded as enabled and without a
filter. The key is at most one when any of them holds; unknown when none holds but a unique index
is filtered or its state was not recorded, so a filtered unique index never gives `atMostOne`; and
many otherwise, every one of them disabled included. A disabled clustered index is the exception:
SQL Server then takes no row in the table, keeps every foreign key on it disabled and refuses to
enable one until the index is rebuilt, which makes it unique again, so a disabled clustered primary
key, unique constraint or unique index holds and is not named among the disabled ones; the
nonclustered indexes disabled along with it stay disabled after that rebuild and count as disabled.
A project saved before 1.2 did not record the state, so its primary keys and unique constraints keep
the 1.1 reading and its unique indexes stay unknown until a refresh records it: opening an old file
changes no diagram, and the first refresh may change markers, which the review announces in one line
(ADR-016). The sentence names the reason, with the index names drawn as code: a key that can be
referenced by any number of rows because of a disabled index says "…, or by none, because the index
UQ_X is disabled", and one that is unknown because of a filter says "A row in … can be referenced by
at most one of the rows in … that the filter of the unique index UX_X selects", which claims nothing
about the other rows; a state not recorded leaves the sentence out, as in 1.1. `relationEnds` calls
the same function, so the canvas and every export follow: an enabled unique index without a filter
now draws zero or one at the referencing end, and a disabled nonclustered unique constraint a crow's
foot. Key columns come from `key_ordinal` greater than 0 and included columns from
`is_included_column`, in `index_column_id` order, so the partitioning column SQL Server adds on its
own to an aligned index, listed with neither, is no longer the first key column; memory-optimized
hash indexes (type 7) are not read in 1.2.

Since 1.2 the snapshot also records whether SQL Server trusts each `CHECK` and foreign key
(`is_not_trusted`). An enabled rule it does not trust, after `WITH NOCHECK`, an enable without
`WITH CHECK`, or because it is `NOT FOR REPLICATION`, which SQL Server never trusts even when it
checked every row, first says "Rows already in {table} may not follow this rule: SQL Server marks it
as not trusted", with no cause claimed, since several statements leave the same flag. Its sentences
then sit under "When a row is inserted or its {columns} is changed:", naming the columns a `CHECK`
reads or a key's referencing columns, because SQL Server checks an UPDATE only when it writes one of
them, so a row that breaks the rule stays as it is while its other columns change. A key's sentences
about the referenced table hold for every row and follow the group (`stateRules` in `ruleText.ts`,
RuleNode parts like every sentence). A `CHECK` the reader cannot put into words keeps that first
sentence above its SQL, and one whose text the login cannot see keeps it above the words for the
missing text, since `is_not_trusted` needs no VIEW DEFINITION. A disabled rule, never trusted, reads
under "When enabled:" as before, and a rule whose trust was not recorded reads as in 1.1. The note
under a section with rules in words keeps its last clause, that rows saved before a rule existed may
not follow it, only while the file has not recorded whether SQL Server trusts one of the section's
rules; once trust is recorded it ends at "when values are written", because SQL Server verified a
trusted rule against every row and an untrusted one says so itself, without a cause. The view-model
badges such a rule "not trusted", a disabled key, index or constraint "disabled" and a filtered
index "filtered", all in the neutral tone every badge but the key and link ones has, and gives an
index with included columns an `INCLUDE (…)` line, in the Inspector and the viewer alike (ADR-038).
`foreignKeyDefinitionSql` scripts an enabled key that is not trusted as
`ALTER TABLE … WITH NOCHECK ADD CONSTRAINT …` with no `NOCHECK CONSTRAINT` statement after it, which
recreates it enabled and not trusted; 1.2 does not read `NOT FOR REPLICATION`, so the statement
leaves it out. The engine facts gain, on both versions: a key added `WITH NOCHECK` is enabled and
not trusted, refuses a new row without a parent row and a write of the referencing column of the old
one, which stays and takes changes to its other columns, and `WITH CHECK CHECK CONSTRAINT` refuses
to trust it while that row is there; a `CHECK` enabled again without `WITH CHECK` is not trusted,
checks every row inserted and every row whose columns it reads are written, leaves a row that breaks
it in place when other columns change, and becomes trusted with `WITH CHECK CHECK CONSTRAINT` once
the row that breaks it is gone; a `CHECK` and a key `NOT FOR REPLICATION` stay not trusted after
`WITH CHECK CHECK CONSTRAINT`; disabling a clustered primary key disables the key of its table and
its other indexes, the table takes no row, and the key cannot be enabled until the index is rebuilt,
which leaves the other indexes disabled; the scripted statement recreates an enabled key that is not
trusted; an enabled unique index without a filter keeps a referenced row to one referencing row; the
filtered and the disabled unique indexes are reported as such; and the partitioning column of an
aligned index is neither a key column nor an included one.

### ADR-040: A database that cannot be shared is measured by a probe its owner runs, and the probe returns numbers only

Some decisions rest on databases the project cannot see: how much code a real schema holds, how
large its texts are, how often its triggers are disabled or its indexes filtered, what a
production login may read. `crates/schemacraft-core/probes/capability-probe.sql` lets the owner
of such a database measure it and share numbers only. It is run with the login SchemaCraft
connects with, not as `dbo`, since every count is what that login can see. It lives under
`crates/`, so an edit to it counts as a core change and runs the SQL Server tests (ADR-033).

The script is one T-SQL batch without `GO`, short enough to read before it runs. It starts with
`DECLARE @scan_text bit = 1`, `SET NOCOUNT ON` and `SET LOCK_TIMEOUT 5000`, fills a table
variable section by section, each but `probe` in its own `TRY … CATCH`, and ends with one `SELECT`
of that variable. Every row is `(section nvarchar, metric nvarchar, value bigint)`. The labels
are literals of the script, type codes become labels through fixed `VALUES` lists, and a value is
a count, a sum or maximum of `DATALENGTH`, a server property as a number, milliseconds, or a
capability as 1, 0 or -1 when the server does not answer. No name of an object, schema, column,
parameter, principal, login, database, collation, server or file is returned, nor any definition
or expression text: names and texts are read only on the server, inside `COUNT`, `DATALENGTH`,
`LIKE`, `CHARINDEX`, a comparison with a fixed word or a permission check, and become numbers
there. A failed section returns only `ERROR_NUMBER()`, never the message. It reads catalog views
and system functions only: no table data, no procedure, no dynamic management function and no
write beyond the table variable. The text scan runs `LIKE` on the server and returns how many
modules match each pattern; whoever runs it can turn it off at the top. The sections are
`probe`, `server`, `access`, `objects`, `modules`, `text`, `triggers`, `views`, `routines`,
`indexes`, `constraints`, `columns`, `properties` and `timings`.

The engine sets rules for keeping it runnable on every version and for every login, learned
against SQL Server 2022 and checked on 2019:

- A catalog column that a version lacks fails the whole batch at compile time, where no `CATCH`
  can report it, so the script uses only columns that exist since SQL Server 2012 and reads newer
  flags through `OBJECTPROPERTY`, which answers NULL instead.
- A subquery inside an aggregate is Msg 130, a compile error too, so flags that need one are
  worked out per object in a derived table and summed outside it.
- `ISNULL` returns the type of its first argument, so a `tinyint` is cast before -1 can stand in
  for its NULL, and no aggregate is given a NULL, whose warning would land in the sqlcmd output.
- `sys.sql_expression_dependencies` raises Msg 229 for `VIEW DEFINITION` without `SELECT`, so only
  the permission to read it is probed.
- The `sys.objects` row of a table type is marked `is_ms_shipped`, so table types are counted in
  `sys.table_types`.
- Another session's uncommitted schema change holds locks that the catalog queries wait for, so a
  blocked section reports error 1222 after 5 seconds, and the owner runs the probe again once
  that change has ended.
- An error that no `CATCH` can handle, such as a compile error, reaches the client with a header
  that names the server, so the README runs sqlcmd with `-r1`, which keeps every message on the
  screen and only the result set in the file.

Tests keep the contract. `tests/common` holds `PROBE_METRICS`, every `(section, metric)` pair the
script may return, and `run_probe`, which sends the script as one `simple_query`, as SSMS sends
it, and asserts one result set with the columns `section`, `metric` and `value` of types
`nvarchar`, `nvarchar` and `bigint`, no NULL, every pair in the list and none twice, and every
listed metric unless its section failed. A change that would return anything else, a name above
all, fails until the list grows in the same pull request, where a review sees it. A static test
reads the script without its comments and literals and fails on `GO`, on a statement that runs
code, writes or changes the session, on a `SET` other than `SET NOCOUNT ON`,
`SET LOCK_TIMEOUT 5000` or one of a variable, on an `INSERT` into anything but the table
variable, on a dynamic management view or a `sys.fn_` function, and on the functions that hand
back a name, an error message or a definition, such as `OBJECT_NAME`, `ERROR_MESSAGE` and
`OBJECT_DEFINITION`; the only name functions it calls, `QUOTENAME` and `USER_NAME`, feed a
permission check. It also checks that every `CATCH` returns only `ERROR_NUMBER()` as
`error_number` and that every label is a literal or a column of a fixed `VALUES` list, so how many
rows come back never depends on the database and the allowlist sees every row any database can
produce. `sqlserver_integration.rs` runs the probe as `sa` on `SchemaCraftFixture`,
`SchemaCraftCheckForms` and `SchemaCraftCode`, a database of its own built from
`fixtures/sqlserver/code.sql` (views `WITH CHECK OPTION`, indexed and encrypted; triggers on a
table and on a view, marked First and Last, disabled, `NOT FOR REPLICATION` and encrypted;
procedures and functions of every T-SQL kind, one created through `sp_executesql` with CRLF and
trailing spaces; a schema with code only; a database DDL trigger; no CLR module, which needs an
assembly, so the CLR counts are pinned at 0), and compares the counts with what each fixture
defines. One more run holds a schema lock in a database of its own while the probe runs, so that
every `CATCH` that can wait on it runs, and checks that they return only error 1222.
`sqlserver_permissions.rs` runs it as `sa` and as the `db_owner`, reader, `VIEW DEFINITION`,
sales-texts and connect-only logins and pins what each sees: a `db_datareader` member, for one,
sees no procedure, no scalar function and no text, and no `VIEW DEFINITION` on the database. On
SQL Server 2022 it also runs as the login denied `VIEW SECURITY DEFINITION` (ADR-034), which
reports 1 for `view_definition` and 0 for `view_security_definition`; on 2019, which does not know
that permission, `view_security_definition` is -1 for every login, `sa` included.
`permissions.sql` gained the code those runs count and no table, view, `CHECK` or `DEFAULT`, so
every access verdict of ADR-034 holds.

The results belong to the database's owner: the README asks to keep them outside the repository
and to share only the grid of numbers, `.gitignore` ignores a result written next to the script,
and none is committed.

Why: a probe built on the inspector would reuse the connection code, whose errors carry server,
login and object names, and would have to be compiled and trusted. A T-SQL script has no
connection code and no error text to clean, runs in the tools a DBA already has, and can be read
line by line before it runs; the allowlist and the static test turn "numbers only" into a
property CI checks rather than a promise.

### ADR-041: A local diagnostic log holds typed counts, timings and kinds, never names, paths or code

Release builds have no console, so a user who met a bug had nothing to attach. Since 1.2 SchemaCraft
keeps a log on the user's machine, in `%LOCALAPPDATA%\com.jmanuelsoberano.schemacraft\logs`, the
folder Tauri's `app_log_dir` names, and sends it nowhere.

What the log may say is fixed by type, not by a filter. `crates/schemacraft-core/src/diagnostics.rs`
is the only place that emits events on the target `schemacraft-diagnostics`, a name with a hyphen,
which no module path has, so an event that names no target never matches it. It has one function
per event, and their parameters are integers, booleans, durations, `&'static str` and closed
classifications, which implement the marker trait `ClosedKind` next to their own enum, so the module
depends on `model` alone. The events are `app_started` (the app's version and the WebView2
runtime's, as numbers), `startup_failed` (WebView2 missing, or Tauri could not start),
`catalog_query` (the fixed name of the query, rows, ms), `inspection_completed` (tables, views,
foreign keys, keys to invisible tables, the access level and the ms of connecting, reading,
assembling and the whole), `project_opened` (format version, read-only, KB, ms), `project_saved`
(format version, KB, ms), `export_written` (format, KB, ms) and `command_failed` (the command's
fixed name, its `CommandErrorKind`, and the SQL Server error number and catalog query when there
are ones). No event takes a server, a host, a login, a database, a schema or object name, a path,
SQL text, a definition or an error message. Errors cross with `log_summary()`, which every core
error enum has: the kind, the SQL Server error number (`InspectorError` keeps it for a rejected
login, an unavailable database, a refused session and a failed query) and the query name, never the
message, which names servers, logins, databases, objects and files. `CommandError` carries the
number and the query to its `log` method without sending them over the IPC, and every command that
can fail records its failure through `commands::logged`, or through `log` itself in the synchronous
`cancel_*`.

`src-tauri/src/logging.rs` keeps the console layer as it was, under `SCHEMACRAFT_LOG`, and adds a
file layer that accepts exactly that target, from that module, at info and above, whatever
`SCHEMACRAFT_LOG` says. It checks the module (`diagnostics::MODULE`) as well as the target, so an
event in another file that names the target, by mistake or through a copy of the constant, stays
out too. Its formatter writes the UTC time, the level and the event's own fields, and no span, no
target and no thread, so neither a stray `tracing::info!` elsewhere nor a future `#[instrument]`,
which records every argument of a function in its span, can reach the file; a source scan test
fails when any other file names the target or imports its constant under another name. A line
reads `2026-10-18T21:04:05.120Z INFO catalog query query="columns" rows=418 elapsed_ms=31`.

The files come from tracing-appender's `RollingFileAppender`: one per UTC day,
`schemacraft.2026-10-18.log`, at most seven files kept, written in blocking mode, so the last line
is on disk before `panic = "abort"` ends the process. They are named by date and never renamed: a
writer capped by size renames `schemacraft.log` to `schemacraft.1.log`, which fails on Windows while
a second SchemaCraft holds the file open, whereas files that are only created and appended to, one
write per line, let two instances share a day's file. Each time the appender is built, at every
start, and again at each UTC midnight while SchemaCraft runs, it first deletes the oldest files, by
creation time, until six are left, and then opens today's file, so the folder holds at most seven
files and a second start on the same day leaves six. It counts every file whose name starts with
`schemacraft` and ends with `log`, so the panic file below is one of them, deleted like a daily file
once it is the oldest. The folder is resolved before Tauri starts: `main.rs` calls
`tauri::generate_context!()` first, and the pure function `log_directory` joins `LOCALAPPDATA`, the
identifier and `logs`, so the WebView2 check and a failed start are logged too. When the folder
cannot be created, the application goes on with the console only and the about dialog says that
this session writes no log.

A panic hook appends `time panic version=… at=file:line` to `schemacraft-panic.log` in the same
folder through `std::fs`, without the logger, whose lock the panicking thread may hold, and then
calls the previous hook. It writes the location, never the message, which can quote anything the
code had at hand, and a dependency's path keeps only the part from its crate's folder on, without
the folders of the machine that built the executable.

`AppInfo.logDirectory` gives the about dialog the folder, which it shows with an "Open log folder"
button and the sentence that the log holds counts and timings for bug reports, never names, code,
paths or passwords, and is never sent anywhere. `open_log_folder` opens the folder the state holds,
never a path from the frontend, with the opener plugin's Rust API on `run_blocking`, so no
capability of the window grows; `help.openLogFolder` puts it in the palette, without a shortcut
(ADR-008). Errors of the frontend are not logged: a window error or a rejected promise carries a
message and a stack whose text can hold anything the page had at hand, and the WebView's console
stays out of the file.

Tests keep the contract. Unit tests check that each event records only its declared fields, that the
`log_summary()` of every `InspectorError` variant built with a sentinel server, database, login and
path holds none of them, the source scan, that the formatter writes no span context, the file
filter, `log_directory` and the console filter as pure functions (the environment cannot be changed
in a test, since `env::set_var` is unsafe in edition 2024 and the workspace forbids unsafe code) and
the panic line. `tests/diagnostics_privacy.rs`, run against both CI servers, captures every event on
the target at every level, without span context, which the formatter's unit test keeps out of the
file, while it reads `SchemaCraftPermissions` as `sa` and as the `db_datareader` login, logs in with
a wrong password, opens a database the login has no user in, and reads as a login that may not read
`sys.check_constraints` (`fixtures/sqlserver/diagnostics_logins.sql`), and fails on any schema,
object, column, key or constraint name of the fixture, any readable expression, the server's name, a
login, the host, a password, a database or a fragment of the server's messages.

Why: a log is useful in a bug report only when it can be shared without reading it twice. A typed
allowlist keeps names, paths and code out by construction, which a filter over free-form events
could not do, because errors carry server, login and object names; counts and timings are what a
slow or failing inspection needs. Date-named files make rotation safe for two processes without a
lock between them, and resolving the folder before Tauri starts covers the failures users meet
first.

### ADR-042: Project format 3 keeps code under `snapshot.programmability` and state facts in optional fields, so 1.1 reads it forward

SchemaCraft 1.2 records what 1.1 could not: the code of views, procedures, functions and DML
triggers, the state of indexes, keys and constraints, and what a login sees of code. It writes
them as format 3 with `minReaderVersion` 2 (`project/document.rs`), so SchemaCraft 1.1 still opens
a 1.2 project, read-only.

All code lives under one key at the snapshot root, `programmability` (`model/programmability.rs`),
never inside a table or a view. It holds what the capture read of the objects and of their texts
(`capture`, each `read`, `notRead` with the reason `optionOff`, `queryFailed` or `timedOut`, or
`unknown`); the view modules (`view`, `definition`, `hasCheckOption`, `isIndexed`); the routines
(name, kind, `body`, the parameters in declaration order, the return type of a scalar function and
the columns of a table function); the DML triggers, whose identity is their parent and their name,
since a DML trigger lives in its parent's schema (timing, events with the firing order set for each
statement, enabled, `NOT FOR REPLICATION`, `body`); and `carriedOver`, the code kept from an
earlier read, with the part kept (`whole` or `definition`) and when it was last read. A parameter
has no default, because `sys.parameters` keeps a T-SQL parameter's default only in the module
text. A `body` is `sql { definition }`, `clr` or `unknown`, and a `CodeObjectRef` names a view, a
routine or a trigger. `Definition` gains `encrypted`: a module created `WITH ENCRYPTION` has a
`NULL` text for every login, the database owner included, so the state is known, has no text and
never differs from anything. It occurs only under `programmability`. Every new enum reads a value
written by a newer version as `unknown`, with `#[serde(other)]` in an attribute of its own
(ADR-035).

The placement is a privacy rule as much as a model. The HTML export rebuilds the snapshot root from
the keys it knows (ADR-025), so code cannot reach an export by accident, and `accessSummary`
rebuilds the coverage from the objects and the `CHECK` and `DEFAULT` texts, so an export never
speaks of code it does not contain. As objects of their own, like foreign keys, code objects can be
compared and kept on a weaker refresh apart from the tables, and the canvas, its geometry and every
node stay as they are. `programmability` keeps keys a newer version wrote, the fifth level that does
so after the document root, the snapshot root, the canvas and each node, so database triggers,
synonyms or table types can arrive later without raising `minReaderVersion`. The frontend passes the
snapshot through as it is, so those keys survive a save from the application too.

The other facts are new fields of structs that are not flattened, which an older serde ignores.
Some are optional and written only when recorded (`skip_serializing_if = "Option::is_none"`, and
`#[ts(optional)]` in the contracts): `includedColumns`, `isFiltered` and `isEnabled` on `Index`;
`isEnabled` on `PrimaryKey`; `isTrusted` on `CheckConstraint`, `ForeignKey` and
`ForeignKeyToInvisibleTable`; `executeDenials` on `AccessProbe`; and `programmability` and
`moduleDefinitions` on `AccessCoverage`. For these, absent means not recorded, never `false` and
never none: a 1.1 file has no `programmability` because its code was never read, and its indexes
have no state because none was read. The rest are plain flags and counts, written only when true
or not zero, so an absent key reads as `false` or 0 (`serde(default)`):
`hasVisibleProgrammability` and `isExecuteDenied` on `SchemaAccess` (not seen, or not asked, as
before 1.2); `includeProgrammability` and `includeModuleDefinitions` on `CaptureScope` (the
capture did not ask); and `moduleDefinitions`, `moduleDefinitionsNotVisible` and
`moduleDefinitionsEncrypted` on `AccessCounts` (none counted). Whether code was judged at all is
read from `AccessCoverage.programmability` and `moduleDefinitions`, never from these flags or
counts. `isEnabled`, not `isDisabled`, follows `CheckConstraint.isEnabled` and
`ForeignKey.isEnabled`. The inspection options gain `includeProgrammability` (read procedures,
functions and triggers) and `includeModuleDefinitions` (save their code), on by default through
serde, so a 1.1 project refreshed in 1.2 reads and saves code unless the user turns them off; the
connection draft carries both and restores them from a saved project. A capture's `CaptureScope` says that it asked for code only when the inspector read
code, whatever the options say.

For 1.1 to read a 1.2 file without misreading it, no key it parses may change meaning and no closed
enum it knows may gain a value. The audit:

- `SnapshotFact`, `Completeness`, `AccessLevel`, `IndexKind` and every enum of the canvas are
  untouched; kept code has its own list under `programmability`.
- `AccessLevel`, and with it the 1.1 chip, bar, notice and export note, is still judged over the
  tables and views and the `CHECK` and `DEFAULT` texts only (`AccessCoverage::is_full`). The
  coverage of code is reported apart and never changes the level.
- `AccessCounts.definitions` still counts `CHECK` and `DEFAULT` texts only; module texts have
  counts of their own.
- `Definition.encrypted` never appears where 1.1 parses a `Definition`.

So `minReaderVersion` stays 2. SchemaCraft 1.1.0 opens a 1.2 file read-only: it shows and exports
it without code and cannot save or refresh it. That block must stay, because a 1.1 refresh would
drop the snapshot's unknown keys, and the code with them. SchemaCraft 1.0 refuses the file, as it
refuses format 2.

`migrations::format_2_to_3` rewrites the header only, since a format 2 document is already valid
format 3 content. `fixtures/format-2.scraft` was written by the SchemaCraft 1.1.0 core, never by a
later version: a throwaway test in a worktree of the tag `v1.1.0` read the integration fixture
database as `sa` and refreshed it as the 1.1.0 "two tables" login, with a `CHECK` disabled for the
run, so the file holds an access profile, kept facts, a disabled `CHECK`, a key to an invisible
table and a key written by a newer version at each of the four levels 1.1 keeps
(`project/test_fixtures.rs` says how). Tests open it, find every fact, save it as format 3 and find
the same document with only the header and the two options new; the format 1 tests run through the
chain 1 to 2 to 3. `project/forward_read.rs` holds the guarantee itself: it removes exactly the keys
format 3 added from a fully populated 1.2 project and finds the document a capture without them
writes, the verdicts on access included, which it judges again without code, from a project read
by a login that sees everything as well as from the reader's; it checks every value of a closed
enum 1.1 parses (the provider, the authentication mode, the encryption, the type length, the
access level and coverage, the index kind, the referential actions, the kind of a kept fact and
the canvas enums) and that `encrypted` appears only under `programmability`. The same check was
made once with 1.1.0's own code, in that worktree: it opens such a file read-only, keeps
`programmability` among the snapshot's unknown keys and reads every other key exactly as in the
1.1 file it came from. A sentinel test
exports a snapshot whose code carries a sentinel in every text and name and finds it nowhere in the
page, and `projection.test.ts` pins every key path an export carries of a table, view, column,
index, key and constraint over fixtures typed `DeepRequired`, with one fixture for each variant of
a union (`EveryVariant`), so a field Rust adds, to a type or to any variant, or a new variant fails
to compile there and then fails the inventory until someone decides whether it may leave the
application.

A field or a family recorded on one side only is never a change. Indexes and primary keys compare
their name, key columns, kind and clustering always, and the new state fields only when both sides
recorded them, `CHECK` constraints and foreign keys compare their trust the same way, and
`access_changed` compares a code coverage only when both captures judged it, so refreshing a 1.1
project reports no access as changed and no index as changed except one aligned with a partitioned
table: 1.1 read its key columns with the partitioning column first, and that first refresh reports
it once as changed, with the corrected key columns (ADR-039). It also reports one line saying that
the state is recorded now (ADR-016). Where a state was not recorded, the diagram reads as it did in
1.1 (ADR-039).

Module texts travel inside the snapshot, over the IPC every command already uses. A refresh followed
by a save moves the snapshot about seven times, which stays well under a second below 20 MB of
readable module text, about ten million characters. If a real database holds more, the fresh
snapshot is to stay on the Rust side, and the diff and the refresh are to take its id instead of a
second copy; the probe of ADR-040 measures that size.

Why: code is business logic, and the one place an export cannot reach by accident is a key it does
not know. Optional fields and a fifth kept level add facts without changing any 1.1 reading, so the
door format 2 opened stays open both ways: 1.1 can show a 1.2 project and cannot damage it.
Recording an absent state as "not recorded" keeps the first 1.2 refresh of an old project from reading as
hundreds of changes and keeps a gap from reading as a fact.

### ADR-043: Code is read independently, kept when it cannot be checked and compared without formatting noise

The code persisted by ADR-042 is now read, refreshed and reviewed. Procedures and functions are
independent objects; DML triggers follow the table or view they belong to; view modules add code
facts to the views already on the diagram. None becomes a canvas node. Reading code is optional,
and a failed optional read must neither fail a successful table inspection nor erase an earlier
capture.

`inspectors/sqlserver/programmability.rs` reads five metadata queries before one module-text
query: objects (`V`, `P`, `PC`, `FN`, `FS`, `IF`, `TF`, `FT`, `AF`), table and view DML triggers
(`TR`, `TA`, `parent_class = 1`), trigger events, parameters and table-function result columns.
`code_assembly.rs` maps those rows purely and sorts them deterministically. Parameters retain
their declaration order, type, `OUTPUT` and `READONLY`; table-valued parameters retain their table
type. Parameter 0 is a scalar or aggregate function's return type, never a normal parameter or a
table function's return type. Returned columns describe structure only: defaults on a
multi-statement function's internal return-table variable remain in its SQL body and are neither
queried nor persisted separately. The existing `Column` contract is retained with no default
expression for these result columns. Trigger timing, enabled and `NOT FOR REPLICATION` flags are
independent; firing order is recorded per INSERT, UPDATE and DELETE event. A view records
`WITH CHECK OPTION` and whether it has a unique clustered index. CLR bodies are `clr`, with no
SQL text; SQL bodies retain `readable`, `encrypted`, `notVisible` and `notRecorded` separately.

Every code query binds the schema filter on the server. A selection longer than 2,000 schemas
runs in bounded chunks and deduplicates the returned identities; it never falls back to all
schemas. Turning views off excludes their modules and their triggers in SQL. Text rows stream
from `sys.sql_modules` and are consumed one at a time; the driver rows are not collected alongside
a second copy of every body. Stored texts are unchanged, including an empty readable string.
An absent text row after a successful read is `notVisible`; `OBJECTPROPERTY(IsEncrypted)`
distinguishes encryption, including for a login that cannot read the text. A deliberate text
opt-out is `notRecorded` even for an encrypted module.

The table catalog and probe still use their existing `try_join!`; a surrounding `join!` waits for
that result and the code stage independently, on the same four-session pool. The code stage returns
its capture outcome instead of propagating a query error. A metadata error leaves both families
`notRead`; a text error keeps the metadata and leaves only definitions `notRead`. Driver timeouts
and SQL Server error 1222 retain `timedOut`; other failures are `queryFailed`. A failed code lease
is marked broken through the pool manager before it returns, so a partly consumed response cannot
poison a waiting table query. Progress reports `ReadingProgrammability` with the routine and
trigger count, then `ReadingModuleDefinitions` with the readable-text count; a failed stage has
no count. Diagnostics retain the static query name, error kind and number, outcome, counts and
timings, never driver messages, names or SQL text (ADR-041).

The access probe records code visibility and `EXECUTE` denials separately. Table access still
depends only on tables, views and `CHECK`/`DEFAULT` texts. The shared code-object coverage is complete
only when `VIEW DEFINITION` covers the selected schemas and no relevant denial is known or
unknown; `SELECT` or `db_datareader` alone cannot vouch for a complete procedure/function list.
The permission fixture pins the following on SQL Server 2019 and 2022: a reader sees table
functions and the triggers of visible parents but no procedures or scalar functions; schema
`SELECT` does not reveal procedures; schema `EXECUTE` reveals only its permitted routines;
`VIEW DEFINITION` still reveals a procedure denied `EXECUTE`. That last measured combination
does not reduce code coverage. An encrypted module is not a permission gap, and a CLR module is
not counted as a SQL text. A failed or omitted family has no coverage verdict. The schema picker
can add code-only schemas while objects are requested, but a login with no visible table or view
still cannot start an inspection. The current-user fallback of ADR-034 does not claim that the
denials became visible.

`model/code_carry_over.rs` extends the existing pure refresh merge. A missing routine is kept
when its schema may hide routines, and missing view modules and triggers follow their retained
parents. A query failure or timeout keeps in-scope code; readable text that becomes not visible
is kept, but fresh encryption is never replaced by an old readable body. If the text query fails
and the fresh state is unrecorded or unknown, a previously known definition state is kept too,
including not-visible and encrypted states; a freshly known encrypted state or CLR implementation
always wins. This failure rule preserves historical evidence and is separate from carrying a
readable text after a successful but weaker read. Each kept whole object
or definition carries the date it was last read; repeated weaker reads keep that date, and code
whose parent was retained inherits the parent's older date. Turning objects off, turning texts
off, excluding a schema or excluding views is an explicit scope choice and does not preserve the
facts left out. These decisions happen before comparison and again when applying the refresh.

`diff/code.rs` pairs routines by qualified name, triggers by parent and name, and view modules by
view. It compares all recorded properties: kind, implementation, parameters, scalar return type,
returned columns, trigger timing/events/firing order/enabled/replication, view check/indexed
flags, definition and encryption. A readable-to-encrypted transition is an encryption change,
not newly available text. SQL comparison makes line endings LF, removes spaces and tabs at each
line end and removes empty edge lines; it does not rewrite the stored text. It does not parse SQL
or infer semantic equivalence. A first capture has one aggregate line for objects and one for
texts; explicitly leaving a previously recorded family out has an aggregate exclusion line.
Known encrypted or not-visible states retained through a failure still count as previous capture
evidence. Code kept and code newly readable have their own lists, separate from 1.1's
`SnapshotFact`. `CodeDiff.readFailures` also reports an unsuccessful observation when no code was
saved before it: it prevents `isUpToDate` without claiming an object changed. The Rust verdicts
remain the only authority for the review's action and empty state (ADR-016). One bounded
limitation follows from storing only the last capture outcome: a successful empty family followed
by a saved failed read has no retained object or known text to prove its earlier success. When it
recovers, the review records that family again with a zero count and no object change. The same
applies to an all-CLR catalog's empty SQL-text family. Retaining that recovery line lets the user
save the successful outcome; format 3 adds no separate history marker for empty captures.

The connection dialog offers two switches, both on by default: read procedures/functions/triggers,
and save their code. The latter includes view text and explains that it saves business logic in
the project. Retesting the same database preserves the selected schemas, and applying a refresh
keeps that attempt's options and connection, without its password. Disabled code stages are
omitted from progress. A review with partial code coverage limits its no-change verdict to what
the login could read even when table access is full. The access report and
review explain code coverage, encrypted/omitted/unreadable states and failed reads; the review
groups object changes and lists changed properties without a line diff. ADR-044 adds object
browsing and a code viewer. Exports continue to omit code entirely (ADR-042).

Evidence: Microsoft's [metadata visibility rules](https://learn.microsoft.com/en-us/sql/relational-databases/security/metadata-visibility-configuration?view=sql-server-ver16),
[module catalog](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-sql-modules-transact-sql?view=sql-server-ver16),
[parameter catalog](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-parameters-transact-sql?view=sql-server-ver16)
and [trigger event catalog](https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-trigger-events-transact-sql?view=sql-server-ver16)
define the queried columns and permissions; `sqlserver_permissions` and `sqlserver_code` pin the
permission combinations on both tested engine versions instead of inferring them from a general
permission hierarchy. Unit tests cover CLR shapes, timeouts, bound scope limits, normalization,
every compared property, first captures, exclusions and repeated weaker/failing refreshes.

Why: a partial catalog is useful only if it cannot be mistaken for a complete one. Independent
outcomes preserve the table inspection, retained facts preserve the user's saved knowledge and
the review separates database changes from what this attempt could establish. This adds no
connection pool, canvas entity, stored credential, export payload or file-format version.

### ADR-044: Programmable objects are inspected outside the diagram, with a local code viewer

SchemaCraft 1.2 makes the captured procedures, functions and DML triggers browsable without
adding canvas entities or changing saved layouts. `features/schema/modules.ts` owns their
identity and lookup: a routine has its qualified name; a trigger has its parent and its name.
An unknown stored routine kind remains unknown instead of being called a procedure. Views keep
their existing entity identity and selection.

`canvasUiStore.selectedModule` is exclusive with a nonempty entity selection. Selecting a
module clears the entity keys and rule highlight, requests node deselection, opens the Inspector
and optionally requests heading focus. The empty React Flow selection callback preserves that
module, because it can be the acknowledgement of the requested deselection. An explicit pane
click clears both. Loading a new document or removing the selected module clears the selection.
The Inspector derives one target with entity, multiple-entity, module and empty precedence; it
holds no parallel selection. `focusInspectedHome` returns to an entity card, a trigger's parent
card or a routine's Objects row, falling back to the Objects search field when that module home
is not rendered. Closing the Inspector returns focus before it becomes inert.

The Objects panel keeps tables and views and adds Procedures and Functions under each schema.
Routine sections start collapsed and always retain their kind header when present, including
schemas containing only routines of one kind. Section state lasts for the session. Search
temporarily opens matching groups and limits the rendered results; Show more reveals the next
batch. Routine rows show kind, parameter count and CLR/encrypted marks and offer Show details,
without canvas visibility controls. Triggers are found through the palette; each result names its
parent. The palette searches names and kinds of all object types, including off-diagram routines,
without scanning SQL bodies. Incomplete, unrecorded, omitted or failed code reads have a separate
footer so a short list cannot claim that other routines do not exist.

The desktop Inspector uses a separate fact reader (`moduleDetails.ts`) and presentation
(`moduleDetailsView.ts`) for module pages. Trigger event presentation is shared with the
entity sections, whose renderers remain exhaustive.
Procedures show Parameters then Definition; functions insert Returns; triggers show Runs then
Definition. Parameters remain in declaration order and show OUTPUT/READONLY marks. T-SQL
defaults are read only in the module's stored source. Scalar functions show their return type;
table functions reuse the columns renderer for the structural result, without separate internal
DEFAULT expressions (ADR-043). A trigger's parent is a link only when the parent can be shown.
Runs keeps First/Last attached to each event, explains AFTER and INSTEAD OF, and marks disabled
and NOT FOR REPLICATION states. The TRUNCATE note applies only to DELETE triggers on tables;
the bulk-import note applies only to INSERT triggers. View Definition is a shared metadata
section with recorded WITH CHECK OPTION and indexed-view facts; only the desktop renderer
resolves and displays its source.

Every definition has real state text and an icon: readable SQL, not visible to the login with
Why to the Access report, encrypted through WITH ENCRYPTION, CLR assembly, not recorded in an
older project, or not read with its actual option/failure/timeout reason. Unknown definitions are
handled conservatively as not visible. Kept objects and kept definitions carry their last checked
dates; an encrypted or unreadable state retained after a failed read also keeps its date. Missing
text never renders an empty code editor. SQL Server returns an encrypted module's source to no
login through the catalog, including the owner; this statement is about catalog access.

`CodeViewer` is a focused, read-only `pre/code` surface with line numbers, optional wrapping,
Copy, and literal search with next/previous matches. It introduces no editor dependency or
syntax parser. `codeWrap` is a persisted interface setting, false by default. The source remains
literal React text, including hostile markup, and copying uses the exact original string rather
than line-number markup or normalized SQL. A shared CopyButton gives the same success
and failure feedback to the source, rule SQL and access-report script.

The `[data-keyboard-owner="code"]` region owns Ctrl+F, F3 and Shift+F3. Ctrl+A selects only the
source when it is focused; the find field keeps ordinary text selection. Escape closes find
first, then returns to the inspected object's home. Tab is unbound, the source retains its native
context menu, and the global shortcut/browser guard consults the same ownership helper before
handling a key. Outside the viewer Ctrl+F still searches Objects. Copy, wrapping and search never
change the project or the stored source. No export gains SQL text or module pages.

Evidence: Microsoft's [CREATE TRIGGER](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-trigger-transact-sql?view=sql-server-ver16)
defines AFTER, INSTEAD OF, replication and TRUNCATE behavior; [sp_settriggerorder](https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-settriggerorder-transact-sql?view=sql-server-ver16)
defines order per statement; [BULK INSERT](https://learn.microsoft.com/en-us/sql/t-sql/statements/bulk-insert-transact-sql?view=sql-server-ver16)
and [bcp](https://learn.microsoft.com/en-us/sql/tools/bcp/bcp-utility?view=sql-server-ver16) define the
FIRE_TRIGGERS requirement. Focused tests cover target precedence, parameter/return mapping,
conditional trigger notes, definition states and retained dates using the real English and
Spanish catalogues, plus desktop rendering and source escaping. Acceptance of the complete
change also requires the real-app keyboard, focus, theme and language checks in the release
checklist; unit tests alone do not establish them.

Why: code is useful beside the diagram without being a diagram element. Separate module pages
and a plain source surface keep selection, keyboard ownership and export privacy explicit while
reusing the existing column renderer, language system and focus behavior.

### ADR-045: Distribution channels wrap the same application and remain independent

The portable executable and the current-user NSIS installer remain first-class distribution
channels. The tag-driven workflow of ADR-027 builds and publishes their draft GitHub release
without a Microsoft Store account, package identity or Store certificate. Their configuration,
asset names and signing policy remain independent of Store preparation. Store signing applies to
the package distributed by Microsoft; it does not supply a signing certificate for the portable
executable or the NSIS installer (ADR-029).

Microsoft Store packaging is an external adapter in `distribution/microsoft-store/package.mjs`,
invoked by `.github/workflows/microsoft-store.yml`. It consumes an executable from a published
GitHub release and verifies it against that release's SHA-256 checksum before packaging. It does
not rebuild or modify the executable. The Windows SDK's MakeAppx creates a complete MSIX package
containing that executable and the declared visual assets; it does not capture an NSIS
installation or introduce a second application implementation. The package declares
`packagedClassicApp`, `mediumIL`, `Windows.Desktop`, x64 and Windows 10 build 19041 or later, with
`runFullTrust` as its only capability. It requests no elevation, external content or
`unvirtualizedResources` exception.

The package's name and publisher must come from the application's real Partner Center identity;
the packager must reject missing production identity values. Test identities must be explicit
and cannot stand in for Store acceptance. The package version derives from the selected release,
with a fourth numeric component of zero, and updates preserve the package identity. No Store SDK,
account, licensing check, updater or packaging configuration enters the domain, application host
or frontend. The Tauri identifier, `.scraft` format and Windows Credential Manager service name
stay the same across channels. Store manages Store-package updates; the existing direct-download
channels keep their existing update behavior.

Evergreen WebView2 remains a prerequisite, with the existing native bilingual message when it
cannot load (ADR-027). This package does not bundle a runtime or promise that Store will install
one. Microsoft's `ExternalDependency` mechanism applies to App Installer installations and is
not evidence of automatic runtime installation by Store.

The same application code does not imply identical physical data locations. Windows can
virtualize the packaged application's AppData writes, read existing unvirtualized files and
remove virtualized state on package uninstall. There is no automatic migration between channels
and no promise that their preferences, WebView2 profiles or logs are either shared or fully
isolated. User-selected `.scraft` files remain the interchange mechanism. The credential service
is unchanged, but packaged credential access and Windows Authentication require acceptance under
the actual user context; neither is inferred from a matching executable hash.

`scripts/check-distribution.mjs` is the deterministic guard for the boundary: it checks the base
portable/NSIS configuration, channel independence and the absence of Store-specific imports in
product code. Packaging validation must also check the manifest and its content inventory, reject
missing identity or invalid inputs, and verify that the executable extracted from the MSIX has
the input hash. MakeAppx semantic validation remains enabled. These checks establish packaging
properties; they do not establish installation, runtime behavior or Store certification.

Before Store publication, the checklist in [microsoft-store.md](./microsoft-store.md) requires
evidence for the package with its real identity: installation and activation, WebView2 behavior,
SQL and Windows Authentication, remembered synthetic credentials, project open/save and exports,
preferences and logs, update with state preserved, and uninstall without damage to user project
files or the direct-download installation. Every real-app session backs up and restores
preferences. A Store flight must then verify the Store-delivered package and its update path.
Account setup, identity confirmation, package acceptance and publication are separate gates;
preparing the tooling or passing the static checks does not mark any of them complete.

Evidence: Microsoft's [manual MSIX packaging guide](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-manual-conversion)
defines the package model; [MakeAppx](https://learn.microsoft.com/en-us/windows/msix/package/create-app-package-with-makeappx-tool)
provides package validation and extraction; [packaged desktop app behavior](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)
defines data virtualization; [package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
cover Store identity, versioning and signing; and [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
describes runtime prerequisites. Tauri's [Store guide](https://v2.tauri.app/distribute/microsoft-store/)
covers its EXE/MSI output; the separate MakeAppx adapter supplies MSIX without changing those
outputs.

Why: a distribution account must not become a product dependency. Reusing a verified executable,
keeping channel configuration outside the product and enforcing that boundary in CI preserve
direct installation while making Store preparation reviewable. Explicit runtime gates keep
packaging success from being mistaken for compatibility or publication approval.

### ADR-046: Support exports an explicit local preview and opens fixed reporting destinations

The support workflow remains independent of the distribution adapters described in ADR-045.

`features/support` owns an ephemeral dialog store. About and the `help.reportProblem` registry
action open it. It reads a local preview, offers a native text-file save and separately opens
the public bug form or existing security policy. Closing discards the preview; no project or
preferences state is changed. A generation guard drops late reads after close or refresh, and
a pending save cannot open a second picker or dismiss its preview.

`supportBackend.ts` follows the existing IPC backend resolver. A plain browser has no fabricated
diagnostics. The three host commands are `read_diagnostic_report`, `write_diagnostic_report` and
`open_support_page`; blocking work stays on `run_blocking`, failures pass through `logged`, and
`SupportErrorKind` crosses the existing typed error envelope.

The host's `support.rs` reads only the log directory from `AppState`. It recognizes valid daily
logger filenames and the panic file, ignores directories, symlinks and Windows reparse points,
and selects at most seven regular files without recursion. Each file contributes at most
256 KiB of its recent complete lines; truncation and unavailability are visible. Header fields
are build facts, OS family/architecture, a numeric runtime version and UTC time. Projects,
preferences, credentials, connection history, screenshots and arbitrary filesystem paths are
never source inputs. This preserves ADR-041's logger boundary instead of collecting a general
machine dump.

The reviewed text is saved verbatim, atomically, through the user-selected absolute `.txt` path,
with a separate 2 MiB export bound. Saving does not collect newer logs or open a browser.
`SupportPage` is a closed enum resolved to fixed HTTPS destinations in Rust; only the build
version enters the public issue-form query. No report text, log path or user identifier enters
that URL. The user reviews and attaches files and submits the report themselves. Security
reporting remains separate from public bug reports. No window capability, core module, project
format or release-channel dependency is added.

Tests exercise file boundaries, caps, exact-preview saving, cancellation, races and URL payloads.
The [support guide](support.md) records the format and real-app verification scope. The public
issue form must be checked after its template reaches the default branch; an unmerged template
is not evidence of a working public form.

Why: useful bug evidence should be easy to prepare without silently collecting project data
or turning a local desktop tool into an upload client. Plain text makes the bounded report
reviewable and keeps diagnostics independent of a support account or distribution channel.

### ADR-047: Independent project comparison preserves each capture's evidence

The comparison workflow is unreleased. It compares two explicitly chosen `.scraft` files as
Reference and Compared, without connecting, refreshing, merging observations or modifying the
open project. `core/comparison` owns the comparison of immutable snapshots; `core/diff` retains
its separate refresh contract. A comparison rejects different providers, since two engines give
different meanings to types, permissions and constraint states. Identities remain structured:
schema, name, kind, parent for a trigger or foreign key, and native input types for an overloaded
PostgreSQL routine. Names containing dots are never split and renames are not inferred.

Every property carries its own observation: observed, proved absent, excluded, not visible,
not recorded, retained, failed or unknown, with its actual read date when available. A missing
row is an addition or removal only when the other capture's scope and coverage establish
absence; otherwise the result is not comparable. Confirmed differences can coexist with
limitations on other properties. Unknown extensions prevent a whole-project equality claim.
Capture time is not save time, and a retained value is not freshly observed evidence.

The normal result contains no module body. Exact source changes are reported independently of
the legacy whitespace normalization used by refresh. Opening source details calls the separate
bounded line comparator, preserving whitespace and original line endings, without executing SQL
or claiming semantic equivalence. Work and page limits, cancellation and revision checks prevent
a large source or late job from replacing a newer selection. The thin host exposes
`compare_project_snapshots`, `compare_project_source` and `cancel_project_comparison`; blocking
comparison work uses `run_blocking`, and source text never becomes diagnostic content.

`features/comparison` owns transient inputs, filters, selected item, per-side diagram context and
an explicit offline HTML report preview. It has no project, preference or connection-store write
dependency. Report building reconstructs approved fields and the filtered result set; no input
path, server, user, password, raw probe, annotation, module body or unknown extension is embedded.
Schema names outside the included results are counted without being named. Local source review
does not authorize source export. Text and identifiers are escaped before HTML insertion.

Tests distinguish comparable absence from every evidence gap, equal and different values,
provider mismatch, dotted identities, overloaded routines, exact source endings, cancellation and
budget exhaustion. Report sentinels reject private fields, hidden results and executable markup;
store tests ensure stale results cannot change the active project or selection.

Why: a refresh answers how to update one project; independent comparison answers what two
captures can establish. Sharing pure schema facts while keeping those contracts separate avoids
turning uncertainty into database changes or copying private source into a shareable report.

### ADR-048: Catalog dependencies are an independent captured family and directed map

The dependency workflow is unreleased. `snapshot.dependencies` records an optional catalog read,
its scope, completion time, source-level coverage, directed edges and limitations. Missing means
not recorded; a failed or disabled read is not an empty graph. Every retained source and edge
keeps its original observation date. Refresh preserves references it cannot verify, replaces a
successfully observed source's list, and treats deliberate option exclusions separately.
`includeDependencies` is independent of saving module source and defaults on for new reads.

`DependencyObjectRef` distinguishes tables, views, routines with optional overload identity and
triggers qualified by their parent. Targets are either captured objects or explicitly classified
references: external, out of scope, not visible, unsupported, unresolved, ambiguous,
caller-dependent or unknown. SQL Server reads catalog expression dependencies; PostgreSQL reads
its native dependency catalog and trigger-function references. Neither inspector parses bodies,
executes routines, follows external servers or databases, or claims discovery of dynamic SQL,
application references or every string routine body. Completeness describes the observed
catalog list, never all runtime use.

The Inspector shows incoming and outgoing references from these stored facts.
`features/dependencies` builds a separate directed exploration map, with incoming/outgoing/both
direction, bounded traversal and explicit omissions when limits are reached. A dependency arrow
means source references target; it is never an ERD foreign key or a crow's-foot relationship.
Its transient positions and filters do not rewrite the ERD or stored perspectives. Cycles,
self-references, partial evidence and unresolved nodes remain visible as such.

The map and SVG, PNG, PDF and offline HTML exports consume a closed `DependencyGraph`
projection, never a raw snapshot. Only chosen objects and their permitted local labels, closed
statuses, read dates and known references travel. Raw external server/database fields, module
bodies, connection settings, credentials, notes and unknown extension keys remain absent.
Bounds include every projected node and wrapped limitation caption, independently of viewport.
Escaping and safe JSON embedding keep hostile names literal.

Tests cover direction, cycles, duplicate and dotted identities, scope/option/failure retention,
read dates, bounded traversal, external-reference sentinels and offline export escaping. Native
integration fixtures establish what each catalog actually reports. No test may establish
semantic dependency completeness by assuming a query returned all possible runtime references.

Why: catalog references are valuable evidence with a different meaning and completeness model
from foreign keys. An independent family and map expose that evidence without weakening the
ERD's relational semantics or source-code privacy boundary.

### ADR-049: Saved perspectives share a snapshot; annotations have explicit identity and export consent

Saved perspectives and notes are unreleased. `ProjectContent.canvas` remains General. Optional
`perspectives` add stable IDs, names, descriptions and independent `CanvasState` values over the
same snapshot. General cannot be deleted. `activePerspectiveId` is a convenience saved on the
next ordinary write: switching maps alone creates neither an unsaved-change warning nor an undo
entry. Create, duplicate, rename, delete, layout, visibility, viewport and detail changes route
through the active-map helper; they do not copy or alter the shared snapshot.

`annotations.notes` contains shared table and column notes, with stable note IDs, plain text,
structured targets and an explicit linked flag. Both targets refer to base tables; a homonymous
view cannot inherit a table's or column's note. Names are logical bindings, not a claim of
physical database continuity. Observed removal archives a note with its previous target and
text; a later reuse of the name never relinks it automatically. Reassignment is explicit and
cannot overwrite an existing linked note. Unknown note and perspective properties survive save.
Descriptions belong to one perspective; object notes are shared by every perspective.

Refresh reconciles every map, including inactive maps. General places new objects visibly;
curated maps retain their selection and add missing node states hidden. Removed objects leave
the maps, and notes are unlinked only when the effective refreshed snapshot no longer contains
their target; incomplete observations retained by refresh do not imply deletion. A new capture
does not duplicate the old document's maps or notes.

Undo mementos contain the editable workspace: General, perspectives, notes and active map.
They exclude snapshots, connections and credentials. Focus-bounded text edits coalesce into one
undo step. Refresh clears history. Document identity, snapshot and map-state identity guard
asynchronous layouts; save completion preserves edits made while writing, and delayed refresh
application cannot discard a newer workspace revision. Read-only forward files may be explored
but cannot persist or refresh these values.

Normal diagram exports contain only the active map. Descriptions and notes default off on each
export. `projectExportAnnotations` rebuilds only explicitly reviewed description text and checked,
linked notes whose targets are visible on that map; archived, hidden and inactive-map material,
stored IDs and extensions never travel accidentally. SVG text, raster/PDF rendering and offline
HTML share the reviewed literal lines. Notes are neither HTML nor Markdown and are never
evaluated. Comparison and dependency reports do not inherit them.

This change ships together with native-provider semantics as **format 4, minimum reader 4**.
The migration from format 3 changes headers; serde defaults supply new optional content and the
legacy SQL Server provider. Earlier projects remain readable and convert on save, without
inventing evidence. Existing readers must refuse new files rather than silently interpreting
PostgreSQL as SQL Server or discarding map/note semantics. The historic format-3/reader-2
guarantee in ADR-042 applies to published 1.2.0 files, not to format 4.

Tests cover independent maps, non-dirty switching, offline round trips, inactive-map refresh,
orphan retention and reassignment, table/view class separation, punctuation identities, unknown
keys, coalesced undo, stale layout/save/review completion and default-off export sentinels.

Why: perspectives are different explanations of one captured model. Sharing facts and notes
while isolating their layouts prevents divergent copies; explicit identity and export choices
prevent silent note reassignment and accidental disclosure.

### ADR-050: PostgreSQL has a native inspector and native semantics behind the same boundary

PostgreSQL support is unreleased and targets versions 15 through 18. `DatabaseInspector` and
`create_inspector` remain the provider boundary. The new `inspectors/postgresql` owns catalog
queries, typed rows, assembly, native access evidence, session policy and connection settings;
the Tauri connection commands remain provider-agnostic adapters. `snapshot.provider` defaults to
SQL Server only for legacy files. `snapshot.postgresql` carries facts with no truthful shared
SQL Server equivalent, rather than inventing SQL Server flags or type declarations.

TCP endpoints accept host, host:port and IPv6, with 5432 as the default. PostgreSQL role and
database names retain their exact case; overload identity uses input type identities in order.
The default transport is `verifyFull`: TLS with chain and host-name validation, using system
roots and an optional additional public PEM root. Private keys are rejected. Explicit
unverified TLS (`require`) and plaintext (`disable`) are restricted to literal loopback or
localhost for local development, with no fallback from failed strict validation. Password
authentication supports the driver's SCRAM path. Saved connections, history and credential keys
are provider-qualified, and only the operating-system credential store retains opted-in secrets.

Each operation owns its session, aborts its connection task on drop, applies read-only session
policy, fixes the catalog search path and bounds statement/lock waiting. Reads use typed,
parameterized native catalog queries. Optional module or dependency failures do not poison
successful structure reads. No application table rows, routines or trigger functions execute.
Catalog-created view/routine definitions are labeled as reconstructed, never original bytes.

Routine-body dependency evidence is captured independently of storing definitions.
`PostgresqlRoutine.routineBodyTracking` and the matching `DependencySource` carry
`parsedSqlBody`, `signatureOnly` or `unknown`; an absent field on a PostgreSQL routine means
not recorded, while tables and SQL Server omit it as not applicable. `parsedSqlBody` records
that the native catalog holds a parsed SQL body (`prosqlbody IS NOT NULL`), so catalog references
can include body dependencies. `signatureOnly` records that a PL or string body is not tracked
that way. Neither value claims exhaustive runtime or dynamic-SQL discovery. Module details,
routine/reference lists, dependency maps and their explicit export projection show the same
translated evidence and limitation; no parse tree or module text enters this metadata.

Tables and partitions, ordinary/materialized views, formatted types, identity/generated
columns, native index methods/expressions/predicates/validity, constraints and referential
actions, overloaded routines and trigger modes retain native meaning. Native access evidence
records catalog outcomes and schema USAGE; no SQL Server permission probe, GRANT script, DENY
count, clustered-index assertion or replication property is fabricated. Rule readers fall back
to literal SQL where the stored dialect facts cannot justify a sentence. ERD cardinality honors
native uniqueness, match and enforcement facts on every rendering surface.

Refresh, independent comparison, dependency references, offline projects and explicit export
projections consume those provider facts. Exports retain approved native structural metadata
but omit routines and module bodies, raw native access evidence, sensitive trigger-function
references and unknown extensions. The shared schema view-model remains a leaf, importing only
itself and `shared/`; its consumers supply context rather than depending on a product store.

The acceptance matrix includes PostgreSQL 15, 16, 17 and 18, full and restricted roles,
native index/constraint/routine/trigger fixtures, scope and option switches, failure/timeout
retention, strict certificate success, bad-root and host mismatch failures, local-only transport
exceptions, SCRAM and privacy sentinels. SQL Server 2019/2022 and historical project readers keep
their own regression gates. Passing synthetic browser fixtures is not native-inspector evidence.

Why: the existing inspector strategy permits another engine, but honest portability requires
preserving semantic differences. Native facts, strict connection policy and explicit projections
add PostgreSQL without coupling the domain to a Store account, frontend screen or Tauri runtime.

## Milestones

| #   | Scope                                                           | Status |
| --- | --------------------------------------------------------------- | ------ |
| 1   | Workspace, domain model, Tauri host, application shell, tooling | done   |
| 2   | `DatabaseInspector`, SQL Server inspector, connection dialog    | done   |
| 3   | `.scraft` project files and schema diff engine                  | done   |
| 4   | Canvas: table nodes, relationships, layouts, detail levels      | done   |
| 5   | Export: SVG, standalone HTML, single-page PDF                   | done   |
| 6   | Portable executable validation and packaging                    | done   |
