// Enforces the distribution boundary in ADR-045 without requiring a Store account or SDK.
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const storeDependency =
  /microsoft-store|Windows\.Services\.Store|windows::Services::Store|Microsoft\.Store\.Services|@microsoft\/store/iu;

export function checkDistribution({ config, releaseWorkflow, ciWorkflow, sources }) {
  const failures = [];
  if (config.bundle?.active !== true) {
    failures.push("The independent installer bundler must remain enabled.");
  }
  if (config.identifier !== "com.jmanuelsoberano.schemacraft") {
    failures.push("Keep the application identifier independent of the Store package identity.");
  }
  if (!config.bundle?.targets?.includes("nsis")) {
    failures.push("The independent NSIS installer must remain a default build target.");
  }
  if (config.bundle?.windows?.nsis?.installMode !== "currentUser") {
    failures.push("The independent installer must continue to install for the current user.");
  }
  if (config.bundle?.windows?.webviewInstallMode?.type !== "skip") {
    failures.push(
      "Do not change the independent channel's WebView2 policy through Store packaging.",
    );
  }
  if (storeDependency.test(JSON.stringify(config))) {
    failures.push(
      "Store configuration belongs to distribution/, not the base Tauri configuration.",
    );
  }
  if (
    storeDependency.test(releaseWorkflow) ||
    /STORE_(?:IDENTITY|PUBLISHER)|PARTNER_CENTER/iu.test(releaseWorkflow)
  ) {
    failures.push("The portable/NSIS release must not depend on a Store account or packaging job.");
  }
  for (const asset of [
    "target/release/schemacraft.exe",
    "target/release/bundle/nsis/",
    "SHA256SUMS.txt",
  ]) {
    if (!releaseWorkflow.includes(asset))
      failures.push(`Keep the independent release asset: ${asset}`);
  }
  for (const [label, workflow] of [
    ["CI", ciWorkflow],
    ["Release", releaseWorkflow],
  ]) {
    if (!workflow.includes("npm run distribution:check")) {
      failures.push(`${label} must run the distribution boundary check.`);
    }
  }
  for (const { path, text } of sources) {
    if (
      storeDependency.test(text) ||
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*|\binclude(?:_str|_bytes)?!\s*\(\s*)["'][^"']*distribution\//u.test(
        text,
      )
    ) {
      failures.push(`${path}: keep Store-specific dependencies and identity outside the product.`);
    }
  }
  return failures;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Do not follow source symlinks: ${entry.name}`);
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(?:rs|tsx?|toml)$/u.test(entry.name)) {
      files.push({ path, text: await readFile(path, "utf8") });
    }
  }
  return files;
}

export async function inspectDistribution(root = process.cwd()) {
  const read = (path) => readFile(join(root, path), "utf8");
  const sources = (
    await Promise.all(
      ["src", "src-tauri/src", "crates/schemacraft-core/src"].map((path) =>
        sourceFiles(join(root, path)),
      ),
    )
  ).flat();
  for (const path of [
    "Cargo.toml",
    "src-tauri/Cargo.toml",
    "crates/schemacraft-core/Cargo.toml",
    "package.json",
  ]) {
    sources.push({ path, text: await read(path) });
  }
  // package.json contains the packaging commands, but its product dependencies cannot depend on Store.
  const packageSource = sources.find((source) => source.path === "package.json");
  const packageJson = JSON.parse(packageSource.text);
  packageSource.text = JSON.stringify({
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
  });
  return checkDistribution({
    config: JSON.parse(await read("src-tauri/tauri.conf.json")),
    releaseWorkflow: await read(".github/workflows/release.yml"),
    ciWorkflow: await read(".github/workflows/ci.yml"),
    sources,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const failures = await inspectDistribution();
  for (const failure of failures) console.error(failure);
  if (failures.length) process.exitCode = 1;
  else
    console.log(
      "Distribution boundary passed: portable and NSIS remain independent of Store packaging.",
    );
}
