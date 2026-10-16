#!/usr/bin/env bash
# Tells a CI job which areas a pull request touches, so a docs-only change skips the Rust build
# and the smoke test, and a change outside the core skips the SQL Server integration tests.
# Writes code=true|false and core=true|false to $GITHUB_OUTPUT. Pushes to main run everything.
# Any failure stops the job: an unclassified change must never pass as one that needs no checks.
set -euo pipefail

if [ "${GITHUB_EVENT_NAME:-}" != "pull_request" ]; then
  code=true
  core=true
else
  # --no-renames lists a moved file under its old path too, so moving code out of crates/ or
  # into docs/ still counts as a code change.
  changed=$(git diff --name-only --no-renames "origin/${GITHUB_BASE_REF}...HEAD")
  code=false
  core=false
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    case "$file" in
      docs/* | *.md) ;;
      *) code=true ;;
    esac
    case "$file" in
      crates/* | Cargo.toml | Cargo.lock | rust-toolchain.toml | .github/workflows/ci.yml | scripts/ci-changes.sh)
        core=true
        ;;
    esac
  done <<< "$changed"
fi

echo "code=$code core=$core"
echo "code=$code" >> "$GITHUB_OUTPUT"
echo "core=$core" >> "$GITHUB_OUTPUT"
