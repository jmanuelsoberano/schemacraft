# Unreleased schema exploration: verification record

This record covers the combined implementation of PRD 3.11–3.14 and ADR-047–050 on
`feat/schema-exploration`. All four features belong to one pull request and one future release.
It is implementation evidence, not maintainer acceptance or authorization to publish.
The source version remains 1.2.0 until acceptance; local preview builds are not replacements
for the published executable, release assets, tag or Microsoft Store package.

## Architecture and contracts

Domain capture, evidence, comparison, reconciliation and persistence remain in the core crate.
The Tauri host adapts commands and bounded jobs. Feature modules own their UI and projections;
native IPC stays behind shared backends. Comparison never replaces the active project.
Perspectives share one snapshot, while General and named maps keep separate canvas state.
PostgreSQL uses its own inspector and native metadata rather than SQL Server permission facts.

`npm run docs:check` checks the architecture model, command registration, IPC mappings and
frontend module boundaries; the core manifest is checked for Tauri dependencies. Its negative
tests reject forbidden aliases, relative imports, re-exports,
dynamic imports and misplaced IPC. The CI classifier tests also cover the PostgreSQL fixture
and guard scripts. These checks enforce the declared boundaries; they do not prove every
future design is cohesive or every runtime flow correct.

New files use format 4 and minimum reader 4. Historical formats 1–3 migrate in memory, and
supported extension fields survive persistence. Export projections are explicit allowlists.
Unknown extensions, connection details, raw access probes and SQL module bodies are excluded.
The comparison report also excludes off-report trigger-function references and database names
from embedded diagram titles. Notes require a fresh, reviewed consent for each export.

## Local execution on 2026-10-23

Only dedicated synthetic fixtures were used. Cargo commands ran sequentially. App sessions
used fresh WebView profiles; original preferences and profiles were backed up opaquely and
restored after confirmed process termination, with preference SHA-256 equality checked.

The verification commands are:

```text
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace -- --test-threads=1
cargo test --workspace -- --test-threads=1
cargo test -p schemacraft-core --test sqlserver_integration --test sqlserver_permissions --test diagnostics_privacy --test sqlserver_code -- --test-threads=1 --nocapture
./dev/postgresql/Test-Fixtures.ps1
npm run format:check
npm run lint
npm run typecheck
npm test
npm run docs:check
npm run distribution:check
npm run distribution:test
npm run tauri build -- --no-bundle -- --profile ci
```

Database suites require their server, expected major version and fixture credentials; an
unset optional integration environment in a workspace run is not live-database evidence.
The PostgreSQL fixture README documents its isolated setup and verified-TLS matrix.
Generated TypeScript contracts are regenerated serially and checked against the committed
files. The two required CI check names remain unchanged.

All listed local gates passed: 936 frontend tests in 100 files; 448 core and 36 host tests in
each of two workspace runs; 65 live SQL tests on each major; and the comprehensive PostgreSQL
suite on each of the four majors. Architecture checks include six negative/classifier tests;
all 14 distribution/packaging tests passed. Workspace-only integration skips are not included
in the live counts. Development watchers were closed before the final serial contract writes
after Windows reported an open mapped file during an earlier generation attempt.

The embedded-frontend executable passed 22 production smoke checks, including language/theme,
keyboard/focus, support preview, reload protection and absence of development hooks. A
validation-only MSIX was packed and unpacked with MakeAppx 10.0.28000.1839. Input and extracted
executable SHA-256 were both
`5875ce684be04c32bcb75458e9b2e4746ca8bf5b9948fbf5b542e17f160c7988`.
The validation identity was not installed or submitted. The same verified executable is the
local acceptance preview; its source-version label does not assign a new public release.

| Area          | Evidence and scope                                                                                                                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL Server    | Real 2022 (16.0.4305.5) and 2019 (15.0.4500.2): all four integration binaries, including dependency, restricted-login and diagnostic privacy cases. Dependency reads also work with module-text storage off.                                                                |
| PostgreSQL    | Real 15.19, 16.15, 17.11 and 18.6: native catalog/code, overloads, scope, limited roles, optional-stage failures, retained evidence, dependencies, SCRAM and verified TLS.                                                                                                  |
| Comparison    | 69 real-app assertions: independent files, swap/filter, before/after context, literal paged code, cancellation/stale work and retained evidence. Four localized reports were scanned for excluded fields. Original files and active document stayed unchanged.              |
| Dependencies  | 54 real-app checks and 16 exports across both languages/themes: keyboard selection, edge direction, cycles, visible projection and all four formats. Backspace cannot silently remove a graph node.                                                                         |
| Perspectives  | 58 real-app assertions: independent maps, shared notes, undo/redo, save/reopen, refresh, explicit unlink/reassign and no automatic relinking after name reuse.                                                                                                              |
| Note export   | 170 real-app assertions and 16 files: consent off/on, reviewed text only, long and hostile literal text, hidden/unlinked/unchecked content absent. Four PDFs each have one page; text extraction and rendered layout were inspected.                                        |
| Native app    | Both SQL Server majors captured through real Tauri IPC. PostgreSQL strict TLS accepted the trusted hostname and rejected wrong host/root; source storage off preserved dependency evidence. An unchanged native refresh reported up to date.                                |
| Compatibility | Historical format-1/2 fixtures and a format-3 project saved by published 1.2.0 were read, saved as format 4 and reopened through native IPC. Original file hashes stayed unchanged. The actual published 1.2.0 executable refused format 4 with `unsupportedFormatVersion`. |
| Diagnostics   | The closed log from the isolated app session was scanned for private-name, password, certificate, source-text and note sentinels; none appeared. Diagnostic privacy tests additionally exercise the closed event fields.                                                    |

The final review additionally covers optional table-trigger scope, PostgreSQL applicability
of native facts, unsupported dependency classes, expression/predicate index references and
SQL-standard versus string routine-body tracking. Availability changes of a dependency target
are not confirmed additions/removals: incomplete target identity is a separate not-comparable
fact, while positively established topology changes remain detectable, including a retarget
with the same count. Another 60 real-app assertions covered both directions of resolution
loss, original evidence dates, immutable inputs, stable repeated capture and known retargeting
alongside an anonymous unsupported endpoint. Unchanged incomplete evidence does not force an
unnecessary refresh review.

### Bounded performance and offline evidence

With 1,200 synthetic objects, expanding all known paths rendered and arranged the bounded
500-node graph in 1,307 ms from activation to two animation frames after completion. This is
one local debug sample, including worker layout and React rendering. A 5,000-object pure
projection took 7.4 ms; five bounded traversal samples after one warm-up took 0.9–1.0 ms.
The visible omission notice remained present. These are scoped measurements, not an SLO or
a promise about other machines or database latency.

Self-contained HTML was opened in an isolated browser from a loopback server and then used
with networking disabled. Dependency search/selection still worked, hostile notes stayed
literal, and no external resource was loaded. Direct local-file navigation was unavailable in
that test environment. Opening a copied HTML file on another computer without SchemaCraft is
still a separate release gate; this test does not claim it passed.

## Remaining acceptance before one release

- Maintainer review of Spanish and the complete four-feature workflows using the prepared
  preview, then selection of the final version and dated release entry.
- Green required checks on the final pull-request commit before merge.
- Build and verify the final versioned portable and installer, checksums and downloaded assets;
  repeat installation, activation, state/credential behavior and uninstallation on the actual
  distribution artifacts.
- Channel-specific Microsoft Store update acceptance with the same package family, including
  existing data and credentials. Validation-only MSIX packing does not prove installation or
  updates and must never be uploaded as the product package.
- Clean Windows/standard-account, missing-WebView2, Windows Authentication and cross-machine
  offline HTML checks remain explicit gates. The previous 1.2.0 publication exception does not
  waive them for this release; any deferral needs a new conscious release decision.

No new release or Store submission is created by this implementation record.
