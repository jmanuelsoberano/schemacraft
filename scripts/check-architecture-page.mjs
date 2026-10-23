// Keeps docs/architecture/model.json in step with the code. It compares the page's manifest with
// the Tauri commands, the feature folders, the core modules and the IPC backends, checks that every
// component path exists and that the English and Spanish content share the same ids. CI runs it on
// every pull request; a failure names what to update.
//   node scripts/check-architecture-page.mjs
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { importViolation, invokedCommands, moduleReferences } from "./architecture-boundaries.mjs";

const root = process.cwd();
const failures = [];
const read = (path) => readFileSync(join(root, path), "utf8");

const model = JSON.parse(read("docs/architecture/model.json"));
const manifest = model.manifest ?? {};

function compare(label, documented, actual) {
  const want = new Set(actual);
  const have = new Set(documented ?? []);
  const missing = [...want].filter((item) => !have.has(item)).sort();
  const stale = [...have].filter((item) => !want.has(item)).sort();
  if (missing.length > 0) failures.push(`${label}: add to the manifest ${missing.join(", ")}`);
  if (stale.length > 0) failures.push(`${label}: remove from the manifest ${stale.join(", ")}`);
  if (Array.isArray(documented) && have.size !== documented.length)
    failures.push(`${label}: duplicate manifest entries`);
}

// Tauri commands registered in generate_handler!.
const main = read("src-tauri/src/main.rs");
const handler = main.match(/generate_handler!\[([\s\S]*?)\]/u);
const commands = handler
  ? handler[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.split("::").pop())
  : [];
if (commands.length === 0)
  failures.push("could not read generate_handler! in src-tauri/src/main.rs");
compare("commands", manifest.commands, commands);

// Feature folders.
const features = readdirSync(join(root, "src/features")).filter((name) =>
  statSync(join(root, "src/features", name)).isDirectory(),
);
compare("featureFolders", manifest.featureFolders, features);

// Public modules of the core crate.
const lib = read("crates/schemacraft-core/src/lib.rs");
const modules = [...lib.matchAll(/^pub mod (\w+);/gmu)].map((match) => match[1]);
compare("coreModules", manifest.coreModules, modules);

// IPC backends, without their preview twins.
const backends = readdirSync(join(root, "src/shared/ipc")).filter(
  (name) => name.endsWith("Backend.ts") && !name.startsWith("preview"),
);
compare("ipcBackends", manifest.ipcBackends, backends);

function sourceFiles(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/u.test(entry.name) && !path.includes("/contracts/generated/")
        ? [path]
        : [];
  });
}

// Parse source syntax so relative paths, re-exports and dynamic imports obey the same boundary.
const ipcCallers = {};
for (const path of sourceFiles("src")) {
  const source = read(path);
  for (const reference of moduleReferences(path, source)) {
    const violation = importViolation(path, reference);
    if (violation !== null) failures.push(`${path} -> ${reference}: ${violation}`);
  }
  if (path.startsWith("src/shared/ipc/") && !path.endsWith(".test.ts")) {
    const called = invokedCommands(path, source);
    if (called.length > 0) ipcCallers[path.slice("src/shared/ipc/".length)] = called;
  }
}
compare("ipcCallers", Object.keys(manifest.ipcCallers ?? {}), Object.keys(ipcCallers));
for (const [caller, called] of Object.entries(ipcCallers)) {
  compare(`ipcCallers.${caller}`, manifest.ipcCallers?.[caller], called);
  for (const command of called) {
    if (!commands.includes(command))
      failures.push(`${caller}: unregistered IPC command ${command}`);
  }
}
const called = new Set(Object.values(ipcCallers).flat());
for (const command of commands) {
  if (!called.has(command))
    failures.push(`registered command ${command}: no documented IPC caller`);
}

if (
  /^\s*(?:tauri(?:-[\w-]+)?\s*=|\[.*dependencies\.tauri)/mu.test(
    read("crates/schemacraft-core/Cargo.toml"),
  ) ||
  /package\s*=\s*"tauri(?:-[\w-]+)?"/u.test(read("crates/schemacraft-core/Cargo.toml"))
)
  failures.push("schemacraft-core must remain free of Tauri dependencies");

// Decision records.
const adrCount = (read("docs/architecture.md").match(/^### ADR-\d+/gmu) ?? []).length;
if (manifest.adrCount !== adrCount) {
  failures.push(
    `adrCount: the manifest says ${manifest.adrCount}, docs/architecture.md has ${adrCount}`,
  );
}

// Every documented command appears in the commands table of both languages.
for (const language of ["en", "es"]) {
  const documented = new Set((model[language]?.commands ?? []).map((command) => command.name));
  const missing = commands.filter((command) => !documented.has(command));
  if (missing.length > 0) failures.push(`${language}.commands: describe ${missing.join(", ")}`);
}

// Component paths exist. A path may list several entries separated by commas.
function pathExists(path) {
  const clean = path
    .replace(/:\d+(-\d+)?$/u, "")
    .replace(/\/\*.*$/u, "")
    .trim();
  if (clean.length === 0 || /\s/u.test(clean) || clean.includes("%")) return true;
  return existsSync(join(root, clean));
}
for (const layer of model.en?.layers ?? []) {
  for (const component of layer.components ?? []) {
    for (const path of String(component.path ?? "").split(/,\s*/u)) {
      if (!pathExists(path)) failures.push(`component ${component.id}: path not found ${path}`);
    }
  }
}

// English and Spanish share their ids.
function ids(language) {
  const content = model[language] ?? {};
  return {
    layers: (content.layers ?? []).map((layer) => layer.id),
    components: (content.layers ?? []).flatMap((layer) =>
      (layer.components ?? []).map((c) => c.id),
    ),
    flows: (content.flows ?? []).map((flow) => flow.id),
    edges: (content.edges ?? []).map((edge) => `${edge.from}>${edge.to}`),
  };
}
const english = ids("en");
const spanish = ids("es");
for (const key of Object.keys(english)) {
  if (JSON.stringify(english[key]) !== JSON.stringify(spanish[key])) {
    failures.push(`${key}: English and Spanish ids differ`);
  }
}

// Edges point at known components.
const known = new Set(english.components);
const components = (model.en?.layers ?? []).flatMap((layer) => layer.components ?? []);
function componentMapping(label, mappings, names, pathFor) {
  compare(label, Object.keys(mappings ?? {}), names);
  for (const name of names) {
    const component = components.find((item) => item.id === mappings?.[name]);
    const expected = pathFor(name);
    if (
      component === undefined ||
      !String(component.path)
        .split(/,\s*/u)
        .some(
          (path) =>
            path === expected || path === `${expected}.rs` || path.startsWith(`${expected}/`),
        )
    )
      failures.push(`${label}.${name}: map to a component at ${expected}`);
  }
}
componentMapping(
  "featureComponents",
  manifest.featureComponents,
  features,
  (name) => `src/features/${name}`,
);
componentMapping(
  "coreComponents",
  manifest.coreComponents,
  modules,
  (name) => `crates/schemacraft-core/src/${name}`,
);
for (const edge of model.en?.edges ?? []) {
  if (!known.has(edge.from) || !known.has(edge.to)) {
    failures.push(`edge ${edge.from} -> ${edge.to}: unknown component`);
  }
}

// Every section has the shape the page renders: a changed shape fails here, not on the live page.
// "text" is a string, ["x"] a list of x, { ... } an object with those fields (all required).
const SHAPE = {
  overview: { title: "text", oneLiner: "text", paragraphs: ["text"] },
  layers: [
    {
      id: "text",
      name: "text",
      summary: "text",
      path: "text",
      technologies: ["text"],
      components: [
        { id: "text", name: "text", path: "text", responsibility: "text", patterns: ["text"] },
      ],
    },
  ],
  edges: [{ id: "text", from: "text", to: "text", label: "text", kind: "text" }],
  dataStores: [
    {
      name: "text",
      location: "text",
      format: "text",
      owner: "text",
      contents: "text",
      notes: "text",
    },
  ],
  flows: [
    {
      id: "text",
      name: "text",
      summary: "text",
      steps: [{ actor: "text", action: "text", detail: "text" }],
    },
  ],
  commands: [{ name: "text", purpose: "text", streamsEvents: "flag" }],
  patterns: [{ name: "text", where: "text", why: "text" }],
  recipes: {
    featureTypes: [
      { kind: "text", example: "text", steps: [{ layer: "text", step: "text", files: ["text"] }] },
    ],
    crossCutting: [{ concern: "text", touches: "text" }],
    definitionOfDone: ["text"],
  },
  conventions: [{ topic: "text", rule: "text" }],
  conformance: {
    verdict: "text",
    deviations: [{ what: "text", where: "text", fix: "text", severity: "text", status: "text" }],
  },
  keepingInSync: {
    rules: ["text"],
    automatedCheck: { name: "text", script: "text", how: ["text"] },
  },
  glossary: [{ id: "text", term: "text", meaning: "text" }],
};
function checkShape(value, shape, where) {
  if (shape === "text") {
    if (typeof value !== "string") failures.push(`${where}: expected text`);
    return;
  }
  if (shape === "flag") {
    if (typeof value !== "boolean") failures.push(`${where}: expected true or false`);
    return;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) {
      failures.push(`${where}: expected a list`);
      return;
    }
    value.forEach((item, index) => checkShape(item, shape[0], `${where}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${where}: expected an object with ${Object.keys(shape).join(", ")}`);
    return;
  }
  for (const [key, child] of Object.entries(shape)) {
    if (!(key in value)) failures.push(`${where}.${key}: missing`);
    else checkShape(value[key], child, `${where}.${key}`);
  }
}
for (const language of ["en", "es"]) checkShape(model[language], SHAPE, language);

// The page's own script must parse; new Function compiles it without running it.
const page = read("docs/architecture/index.html");
const pageScript = page.match(/<script>([\s\S]*?)<\/script>/u);
if (!pageScript) {
  failures.push("docs/architecture/index.html: inline script not found");
} else {
  try {
    new Function(pageScript[1]);
  } catch (error) {
    failures.push(`docs/architecture/index.html: the script does not parse (${error.message})`);
  }
}

if (failures.length > 0) {
  console.error("docs/architecture/model.json is out of date:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `Architecture page in step: ${commands.length} commands, ${features.length} feature folders, ${modules.length} core modules, ${backends.length} backends, ${adrCount} ADRs.`,
);
