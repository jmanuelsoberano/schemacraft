import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function bashExecutable() {
  if (process.platform !== "win32") return "bash";
  // Windows' system bash.exe may be a WSL launcher with no installed distribution.
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
  const candidates = roots.map((root) => join(root, "Git", "bin", "bash.exe"));
  if (process.env.LOCALAPPDATA)
    candidates.push(join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"));
  const executable = candidates.find(existsSync);
  assert.ok(executable, "Git for Windows Bash is required by the CI classification script");
  return executable;
}

function classify(paths, event = "pull_request") {
  const directory = mkdtempSync(join(tmpdir(), "schemacraft-ci-classification-"));
  const output = join(directory, "output.txt");
  try {
    // This shell function replaces git entirely; tests neither access nor change a checkout.
    const result = spawnSync(
      bashExecutable(),
      [
        "-c",
        'git() { printf "%s\\n" "$SCHEMACRAFT_CHANGED_FILES"; }; export -f git; bash scripts/ci-changes.sh',
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: event,
          GITHUB_BASE_REF: "main",
          GITHUB_OUTPUT: output,
          SCHEMACRAFT_CHANGED_FILES: paths.join("\n"),
        },
      },
    );
    assert.equal(
      result.status,
      0,
      result.stderr || String(result.error ?? "classification failed"),
    );
    return readFileSync(output, "utf8").trim().replaceAll("\r", "");
  } finally {
    try {
      unlinkSync(output);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    rmdirSync(directory);
  }
}

test("documentation-only and frontend-only changes keep their intended CI scope", () => {
  assert.equal(classify(["README.md", "docs/architecture/model.json"]), "code=false\ncore=false");
  assert.equal(classify(["src/features/perspectives/NoteEditor.tsx"]), "code=true\ncore=false");
});

test("native fixture, driver and classifier changes require the core and integration gates", () => {
  for (const path of [
    "dev/postgresql/compose.yaml",
    "dev/postgresql/Test-Fixtures.ps1",
    "dev/postgresql/fixtures/init.sql",
    "dev/postgresql/README.md",
    "crates/schemacraft-core/src/model/dependencies.rs",
    "scripts/dev-sqlserver.ps1",
    "scripts/ci-changes.test.mjs",
  ])
    assert.equal(classify([path]), "code=true\ncore=true", path);
});

test("moves out of the core and pushes still require all gates", () => {
  assert.equal(
    classify(["crates/schemacraft-core/src/old.rs", "docs/new.md"]),
    "code=true\ncore=true",
  );
  assert.equal(classify([], "push"), "code=true\ncore=true");
});
