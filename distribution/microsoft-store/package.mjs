import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const validationIdentity = Object.freeze({
  name: "SchemaCraft.Validation",
  publisher: "CN=SchemaCraft.Validation",
  publisherDisplayName: "SchemaCraft validation — not for submission",
});
const assets = { StoreLogo: 50, Square44x44Logo: 44, Square150x150Logo: 150 };
const metadata = new Set([
  "AppxBlockMap.xml",
  "[Content_Types].xml",
  "AppxMetadata/CodeIntegrity.cat",
]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const xml = (value) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character],
  );

export function validateIdentity(identity) {
  const fields = ["name", "publisher", "publisherDisplayName"];
  if (
    !identity ||
    Object.getPrototypeOf(identity) !== Object.prototype ||
    Object.keys(identity).sort().join() !== fields.sort().join()
  ) {
    throw new Error("Identity must contain exactly name, publisher and publisherDisplayName.");
  }
  for (const field of fields) {
    const value = identity[field];
    if (
      typeof value !== "string" ||
      !value ||
      value !== value.trim() ||
      !value.isWellFormed() ||
      /[\x00-\x1f\x7f\ufffe\uffff]/u.test(value)
    ) {
      throw new Error(`Identity ${field} must be a nonempty, unpadded XML string.`);
    }
  }
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(identity.name)) {
    throw new Error("Identity name must contain 3–50 ASCII letters, digits, periods or hyphens.");
  }
  if (!/^CN=\S/u.test(identity.publisher) || identity.publisher.length > 8192) {
    throw new Error("Identity publisher must be an explicit CN distinguished name.");
  }
  if (identity.publisherDisplayName.length > 256) {
    throw new Error("Identity publisherDisplayName must not exceed 256 characters.");
  }
  return { ...identity };
}

export function packageVersion(version) {
  if (
    typeof version !== "string" ||
    !/^[1-9]\d{0,4}\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(version)
  ) {
    throw new Error("Version must be a stable major.minor.patch with major greater than zero.");
  }
  if (version.split(".").some((component) => Number(component) > 65535)) {
    throw new Error("Version components must not exceed 65535.");
  }
  return `${version}.0`;
}

export function normalizeFileVersion(version) {
  if (typeof version !== "string") throw new Error("Executable FileVersion is missing.");
  const parts = version.trim().split(".");
  if (parts.length === 4 && parts[3] === "0") parts.pop();
  return packageVersion(parts.join("."));
}

function selectedIdentity(identity, validation) {
  if (typeof validation !== "boolean") throw new Error("Validation must be a boolean.");
  if (validation && identity !== undefined)
    throw new Error("Use identity or validation, never both.");
  const selected = validateIdentity(validation ? validationIdentity : identity);
  if (!validation && selected.name.toLowerCase() === validationIdentity.name.toLowerCase()) {
    throw new Error("The validation identity requires explicit validation mode.");
  }
  return selected;
}

export function renderManifest({ identity, version, validation = false }) {
  const selected = selectedIdentity(identity, validation);
  const displayName = validation ? validationIdentity.publisherDisplayName : "SchemaCraft";
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap10 rescap">
  <Identity Name="${xml(selected.name)}" Publisher="${xml(selected.publisher)}" Version="${packageVersion(version)}" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>${xml(displayName)}</DisplayName>
    <PublisherDisplayName>${xml(selected.publisherDisplayName)}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
  <Resources><Resource Language="en-US" /><Resource Language="es-ES" /></Resources>
  <Applications>
    <Application Id="SchemaCraft" Executable="schemacraft.exe" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
      <uap:VisualElements DisplayName="${xml(displayName)}" Description="SQL Server schema visualization"
        BackgroundColor="transparent" Square44x44Logo="Assets\\Square44x44Logo.png" Square150x150Logo="Assets\\Square150x150Logo.png" />
    </Application>
  </Applications>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
`;
}

function readRegularFile(filename) {
  if (typeof filename !== "string" || !filename.trim()) throw new Error("A file path is required.");
  const info = lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Input must be a regular file.");
  return readFileSync(filename);
}

function validateExecutable(bytes) {
  const offset = bytes.length >= 64 ? bytes.readUInt32LE(60) : 0;
  if (
    bytes.length < 64 ||
    bytes.toString("ascii", 0, 2) !== "MZ" ||
    offset < 64 ||
    offset + 26 > bytes.length ||
    bytes.readUInt32LE(offset) !== 0x4550 ||
    bytes.readUInt16LE(offset + 4) !== 0x8664 ||
    bytes.readUInt16LE(offset + 24) !== 0x20b
  )
    throw new Error("Executable must have valid AMD64 PE32+ headers.");
}

function inventory(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory())
        return [`${relative}/`, ...inventory(path.join(directory, entry.name), `${relative}/`)];
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new Error("Package contains a nonregular file.");
      return [relative];
    })
    .sort();
}

function verifyPayload(directory, hashes, allowMetadata = false) {
  const actual = inventory(directory).filter(
    (name) => !(allowMetadata && (metadata.has(name) || name === "AppxMetadata/")),
  );
  if (actual.join() !== [...Object.keys(hashes), "Assets/"].sort().join())
    throw new Error("Package inventory mismatch.");
  for (const [name, hash] of Object.entries(hashes)) {
    if (sha256(readRegularFile(path.join(directory, name))) !== hash) {
      throw new Error(`Package payload changed: ${name}`);
    }
  }
}

export function stagePackage({ executable, version, outputDir, identity, validation = false }) {
  const selected = selectedIdentity(identity, validation);
  const manifest = renderManifest({ identity, version, validation });
  const binary = readRegularFile(executable);
  validateExecutable(binary);
  const payload = {
    "schemacraft.exe": binary,
    LICENSE: readRegularFile(path.join(repository, "LICENSE")),
    "SOURCE.txt": Buffer.from(
      `SchemaCraft ${version}\nLicense: AGPL-3.0-only (see LICENSE).\nCorresponding source: https://github.com/jmanuelsoberano/schemacraft/tree/v${version}\nSource archive: https://github.com/jmanuelsoberano/schemacraft/archive/refs/tags/v${version}.tar.gz\n`,
      "utf8",
    ),
  };
  for (const [asset, dimension] of Object.entries(assets)) {
    const png = readRegularFile(path.join(repository, "src-tauri/icons", `${asset}.png`));
    if (
      png.length < 24 ||
      png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      png.readUInt32BE(16) !== dimension ||
      png.readUInt32BE(20) !== dimension
    ) {
      throw new Error(`Invalid package icon: ${asset}`);
    }
    payload[`Assets/${asset}.png`] = png;
  }
  payload["AppxManifest.xml"] = Buffer.from(manifest, "utf8");
  if (typeof outputDir !== "string" || !outputDir.trim())
    throw new Error("Output directory is required.");
  const output = path.resolve(outputDir);
  mkdirSync(output); // Existing output is an error, including an empty directory or symlink.
  const staging = path.join(output, "staging");
  mkdirSync(staging);
  mkdirSync(path.join(staging, "Assets"));
  const hashes = {};
  for (const [name, bytes] of Object.entries(payload)) {
    writeFileSync(path.join(staging, name), bytes, { flag: "wx" });
    hashes[name] = sha256(bytes);
  }
  verifyPayload(staging, hashes);
  return {
    output,
    staging,
    hashes,
    identity: selected,
    version: packageVersion(version),
    validation,
  };
}

function findMakeAppx(explicit) {
  if (explicit) {
    if (path.basename(explicit).toLowerCase() !== "makeappx.exe")
      throw new Error("Expected makeappx.exe.");
    readRegularFile(explicit);
    return path.resolve(explicit);
  }
  const sdk = path.join(
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
    "Windows Kits/10/bin",
  );
  const versions = readdirSync(sdk)
    .filter((name) => /^\d+\.\d+\.\d+\.\d+$/.test(name))
    .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
  for (const version of versions) {
    const candidate = path.join(sdk, version, "x64/makeappx.exe");
    try {
      readRegularFile(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("Windows SDK x64 MakeAppx was not found; supply --makeappx.");
}

export function buildPackage(options) {
  if (process.platform !== "win32") throw new Error("Building MSIX requires Windows and its SDK.");
  const tool = findMakeAppx(options.makeappx);
  const staged = stagePackage(options);
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error("SystemRoot is required to read the executable FileVersion.");
  const versions = execFileSync(
    path.join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:SCHEMACRAFT_PACKAGE_INPUT).FileVersion; [System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:SCHEMACRAFT_PACKAGE_TOOL).FileVersion",
    ],
    {
      encoding: "utf8",
      timeout: 90000,
      windowsHide: true,
      env: {
        ...process.env,
        SCHEMACRAFT_PACKAGE_INPUT: path.join(staged.staging, "schemacraft.exe"),
        SCHEMACRAFT_PACKAGE_TOOL: tool,
      },
    },
  )
    .trim()
    .split(/\r?\n/u);
  const [fileVersion, makeAppxVersion] = versions;
  if (versions.length !== 2 || !makeAppxVersion)
    throw new Error("Could not read packaging tool version.");
  if (normalizeFileVersion(fileVersion) !== staged.version)
    throw new Error("Executable FileVersion does not match package version.");
  const filename = `SchemaCraft-${staged.validation ? "validation-" : ""}${staged.version}-x64.msix`;
  const packagePath = path.join(staged.output, filename);
  const extracted = path.join(staged.output, "extracted");
  const run = (args) =>
    execFileSync(tool, args, { timeout: 120000, windowsHide: true, stdio: "pipe" });
  run(["pack", "/d", staged.staging, "/p", packagePath, "/h", "SHA256", "/no"]);
  run(["unpack", "/p", packagePath, "/d", extracted, "/no"]);
  verifyPayload(staged.staging, staged.hashes);
  verifyPayload(extracted, staged.hashes, true);
  const report = {
    version: staged.version,
    fileVersion,
    makeAppxVersion,
    identity: staged.identity,
    validation: staged.validation,
    inputSha256: staged.hashes["schemacraft.exe"],
    extractedSha256: sha256(readRegularFile(path.join(extracted, "schemacraft.exe"))),
    package: filename,
    packageSha256: sha256(readRegularFile(packagePath)),
    payloadSha256: staged.hashes,
  };
  writeFileSync(path.join(staged.output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
  });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, tokens } = parseArgs({
      options: {
        executable: { type: "string" },
        version: { type: "string" },
        "output-dir": { type: "string" },
        identity: { type: "string" },
        validation: { type: "boolean" },
        makeappx: { type: "string" },
      },
      tokens: true,
    });
    if (new Set(tokens.map((token) => token.name)).size !== tokens.length)
      throw new Error("Duplicate options are not allowed.");
    if ((values.identity !== undefined) === (values.validation === true))
      throw new Error("Supply exactly one of --identity or --validation.");
    const identity =
      values.identity !== undefined
        ? JSON.parse(readRegularFile(values.identity).toString("utf8"))
        : undefined;
    const report = buildPackage({
      executable: values.executable,
      version: values.version,
      outputDir: values["output-dir"],
      identity,
      validation: values.validation ?? false,
      makeappx: values.makeappx,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
