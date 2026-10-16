# Contributing to SchemaCraft

Thanks for taking the time to contribute. This page covers what you need to get a change merged.

## Before you start

- Bugs and feature requests go in
  [GitHub issues](https://github.com/jmanuelsoberano/schemacraft/issues). For a bug, include the
  SchemaCraft version (Help, About), the Windows version, the SQL Server version and the steps
  that reproduce it. Never paste connection strings or passwords.
- For anything beyond a small fix, open an issue first so the approach can be agreed before you
  write code.
- Security problems have their own channel: see [SECURITY.md](SECURITY.md).

## Development setup

Follow the prerequisites and the getting-started section of the [README](README.md).
`npm run tauri dev` runs the desktop application with hot reload; `npm run dev` serves the
frontend alone in a browser with simulated backends.

## Quality gates

CI runs these on every pull request, and they must pass. The Rust gates below run as well
unless the change only touches `docs/` and Markdown files (ADR-033):

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run docs:check
```

```bash
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
```

`cargo test` regenerates the TypeScript contracts under `src/shared/contracts/generated`; commit
them when they change. The SQL Server integration tests need a database: see the README section
on integration tests.

## Conventions

- Code, comments, commit messages and documentation are written in English. User-facing text
  lives in the i18n catalogues under `src/shared/i18n/messages`, in English and Spanish.
- Production Rust code does not `unwrap`, `expect` or `panic`; errors are typed with `thiserror`.
- Commit messages follow Conventional Commits: `feat(canvas): ...`, `fix(export): ...`,
  `docs: ...`, `chore(ci): ...`.
- Decisions that shape the architecture are recorded as ADRs in
  [docs/architecture.md](docs/architecture.md). The
  [architecture page](https://jmanuelsoberano.github.io/schemacraft/architecture/) shows the
  layers, flows and recipes for adding a feature; follow the recipe for the kind of change you
  make, so every feature is built the same way. UX work follows
  [docs/ux-principles.md](docs/ux-principles.md), including its definition of done: both
  languages, both themes, keyboard access.

## Pull requests

- Branch from `main`, keep the pull request focused, and describe what changed and how it was
  verified.
- Keep the documentation in the same pull request as the code it describes:
  `docs/architecture/model.json` when a component, command, data store, flow or recipe changes
  (`npm run docs:check` names what is missing; `npm run docs:serve` previews the page), an ADR
  for a new decision, and the PRD when the scope of the product changes.
- `main` only accepts merge commits through pull requests with green CI; nobody pushes to it
  directly.
- A maintainer reviews and merges. Releases are cut by tagging `main`; see the README section on
  distribution.

## License

By contributing you agree that your contributions are licensed under the GNU Affero General
Public License v3.0, like the rest of the project. There is no contributor license agreement.
