import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  normalizeFileVersion,
  packageVersion,
  renderManifest,
  stagePackage,
  validateIdentity,
} from "./package.mjs";

const identity = {
  name: "SchemaCraft.PackageTests",
  publisher: 'CN="A & B <C>"',
  publisherDisplayName: "A & B's <Company>",
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "schemacraft-package-test-"));
  t.after(() => {
    assert.ok(
      path.dirname(root) === os.tmpdir() &&
        path.basename(root).startsWith("schemacraft-package-test-"),
    );
    rmSync(root, { recursive: true });
  });
  const executable = path.join(root, "synthetic.exe");
  const binary = Buffer.alloc(256);
  binary.write("MZ");
  binary.writeUInt32LE(128, 60);
  binary.writeUInt32LE(0x4550, 128);
  binary.writeUInt16LE(0x8664, 132);
  binary.writeUInt16LE(0x20b, 152);
  writeFileSync(executable, binary);
  return {
    root,
    executable,
    binary,
    options: { executable, outputDir: path.join(root, "output"), version: "1.2.0", identity },
  };
}

test("identity requires exact nonempty fields and preserves XML-sensitive strings", () => {
  assert.deepEqual(validateIdentity(identity), identity);
  for (const bad of [
    undefined,
    null,
    [],
    {},
    { ...identity, publisher: undefined },
    { ...identity, extra: true },
    { ...identity, name: " x " },
    { ...identity, name: "../invalid/name" },
    { ...identity, publisher: "" },
    { ...identity, publisher: "not-a-DN" },
    { ...identity, publisherDisplayName: "A\nB" },
    { ...identity, publisherDisplayName: "\ud800" },
    { ...identity, publisherDisplayName: "x".repeat(257) },
  ]) {
    assert.throws(() => validateIdentity(bad));
  }
});

test("versions are stable and bounded, and FileVersion cannot disagree silently", () => {
  assert.equal(packageVersion("1.2.0"), "1.2.0.0");
  assert.equal(packageVersion("65535.65535.65535"), "65535.65535.65535.0");
  for (const bad of [
    undefined,
    123,
    "0.1.0",
    "01.2.3",
    "1.2",
    "1.2.0.0",
    "1.2.3-beta",
    "1.2.3+meta",
    "1.65536.0",
    " 1.2.3",
  ]) {
    assert.throws(() => packageVersion(bad));
  }
  assert.equal(normalizeFileVersion("1.2.0"), "1.2.0.0");
  assert.equal(normalizeFileVersion("1.2.0.0\r\n"), "1.2.0.0");
  for (const bad of [undefined, "", "1.2.0.1", "1.2.0 (release)"])
    assert.throws(() => normalizeFileVersion(bad));
});

test("manifest escapes identity and fixes the full-trust desktop contract", () => {
  const manifest = renderManifest({ identity, version: "1.2.0" });
  assert.match(manifest, /Publisher="CN=&quot;A &amp; B &lt;C&gt;&quot;"/);
  assert.match(
    manifest,
    /<PublisherDisplayName>A &amp; B&apos;s &lt;Company&gt;<\/PublisherDisplayName>/,
  );
  assert.match(manifest, /Version="1.2.0.0" ProcessorArchitecture="x64"/);
  assert.match(manifest, /Id="SchemaCraft" Executable="schemacraft.exe"/);
  assert.match(manifest, /uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL"/);
  assert.match(
    manifest,
    /Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0"/,
  );
  assert.deepEqual(manifest.match(/<[^/][^<>]*Capability\b[^>]*\/>/g), [
    '<rescap:Capability Name="runFullTrust" />',
  ]);
  assert.doesNotMatch(
    manifest,
    /EntryPoint=|PackageDependency|Extension\b|allowElevation|unvirtualizedResources/,
  );
});

test("validation identity is explicit and cannot substitute for Store identity", () => {
  assert.throws(() => renderManifest({ version: "1.2.0" }));
  assert.throws(() => renderManifest({ identity, version: "1.2.0", validation: true }));
  assert.throws(() =>
    renderManifest({ identity: { ...identity, name: "SchemaCraft.Validation" }, version: "1.2.0" }),
  );
  assert.throws(() => renderManifest({ version: "1.2.0", validation: "true" }));
  const manifest = renderManifest({ version: "1.2.0", validation: true });
  assert.match(manifest, /Name="SchemaCraft.Validation"/);
  assert.match(manifest, /SchemaCraft validation — not for submission/);
});

test("staging includes only the allowlist and preserves executable bytes", (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.root, "private-unrelated.txt"), "must not be packaged");
  const result = stagePackage(f.options);
  const names = readdirSync(result.staging, { recursive: true })
    .map((name) => name.replaceAll("\\", "/"))
    .sort();
  assert.deepEqual(names, [
    "AppxManifest.xml",
    "Assets",
    "Assets/Square150x150Logo.png",
    "Assets/Square44x44Logo.png",
    "Assets/StoreLogo.png",
    "LICENSE",
    "SOURCE.txt",
    "schemacraft.exe",
  ]);
  assert.equal(result.hashes["schemacraft.exe"], digest(f.binary));
  assert.deepEqual(readFileSync(path.join(result.staging, "schemacraft.exe")), f.binary);
  for (const [name, hash] of Object.entries(result.hashes))
    assert.equal(digest(readFileSync(path.join(result.staging, name))), hash);
  assert.equal(result.version, "1.2.0.0");
  assert.equal(result.validation, false);
  assert.throws(() => stagePackage(f.options), /EEXIST/);
  assert.equal(
    readFileSync(path.join(f.root, "private-unrelated.txt"), "utf8"),
    "must not be packaged",
  );
});

test("invalid inputs fail before creating output", (t) => {
  const f = fixture(t);
  for (const executable of [undefined, path.join(f.root, "missing.exe"), f.root]) {
    assert.throws(() => stagePackage({ ...f.options, executable }));
    assert.equal(existsSync(f.options.outputDir), false);
  }
  for (const binary of [Buffer.alloc(8), Buffer.alloc(256), Buffer.from(f.binary)]) {
    if (binary.length === 256) binary.writeUInt16LE(0x14c, 132);
    writeFileSync(f.executable, binary);
    assert.throws(() => stagePackage(f.options), /AMD64 PE32\+/);
    assert.equal(existsSync(f.options.outputDir), false);
  }
});

test("CLI rejects missing, conflicting, duplicate and unknown options before packaging", () => {
  for (const args of [
    [],
    ["--identity", "", "--validation"],
    ["--identity", ""],
    ["--validation", "--validation"],
    ["--unknown"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./package.mjs", import.meta.url)), ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /Supply exactly one|file path is required|Duplicate options|Unknown option/,
    );
  }
});
