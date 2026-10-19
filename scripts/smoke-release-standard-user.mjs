// Invoked only by the guarded standard-user worker on a disposable GitHub runner.
import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { launch, sleep } from "./release-cdp.mjs";

assert.equal(
  process.env.SCHEMACRAFT_ACCEPTANCE_EPHEMERAL,
  "1",
  "The guarded worker must launch this check",
);
const [executable, directory, version = "1.2.0"] = process.argv.slice(2);
assert(executable && directory);
const out = resolve(directory);
await mkdir(out, { recursive: true });
const preferenceFile = join(
  process.env.APPDATA,
  "com.jmanuelsoberano.schemacraft",
  "preferences.json",
);
const backup = join(out, "preferences.backup");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let original = null;
try {
  original = await readFile(preferenceFile);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (original !== null) {
  await copyFile(preferenceFile, backup);
  assert.equal(hash(await readFile(backup)), hash(original));
}
const report = {
  executable: resolve(executable),
  version,
  checks: [],
  passed: false,
  terminationConfirmed: true,
  preferencesRestored: false,
};
let app;
async function check(name, expression) {
  const passed = !!(await app.waitFor(expression, 20000));
  report.checks.push({ name, passed });
  assert(passed, name);
}
async function key(key, code, keyCode, modifiers = 0) {
  const event = {
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers,
  };
  await app.send("Input.dispatchKeyEvent", { type: "keyDown", ...event });
  await app.send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
  await sleep(200);
}
async function windowsAuthentication() {
  const port = Number(process.env.SCHEMACRAFT_ACCEPTANCE_SQL_PORT);
  assert.equal(port, 14335, "Only the owned local SQL fixture endpoint is allowed");
  const j = JSON.stringify;
  const field = (label) =>
    `document.getElementById([...document.querySelectorAll('label')].find(e => e.textContent.trim() === ${j(label)} || e.firstElementChild?.textContent.trim() === ${j(label)})?.htmlFor)`;
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${j(text)})`;
  async function press(expression) {
    assert(
      await app.evaluate(
        `(() => { const e = ${expression}; if (!e || e.disabled) return false; e.focus(); return document.activeElement === e; })()`,
      ),
    );
    await key("Enter", "Enter", 13);
  }
  // Observe actual Rust responses. No connection, schema or authentication response is mocked.
  await app.evaluate(`(() => {
    const original = window.fetch.bind(window);
    const state = window.__windowsAcceptance = { test: null, capture: null, errors: [] };
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.hostname !== 'ipc.localhost') return original(input, options);
      const command = decodeURIComponent(url.pathname.slice(1));
      const settingsCommands = ['test_connection', 'list_databases', 'describe_database', 'inspect_database'];
      if (!settingsCommands.includes(command)) return original(input, options);
      const args = JSON.parse(options.body);
      const s = args.settings;
      if (s.host !== 'localhost' || s.port !== 14335 || s.instance !== null || s.authentication.mode !== 'integrated' || ![null, 'master', 'SchemaCraftCode'].includes(s.database)) {
        state.errors.push('Unexpected connection settings');
        return new Response(JSON.stringify({kind:'acceptanceEndpointGuard',message:'Only the owned local Windows Authentication fixture is allowed'}), {headers:{'Content-Type':'application/json','Tauri-Response':'error'}});
      }
      const response = await original(input, options);
      const answer = await response.clone().json();
      if (response.headers.get('Tauri-Response') !== 'ok') state.errors.push({command,kind:answer.kind});
      else if (command === 'test_connection') state.test = {productVersion: answer.productVersion, authentication: s.authentication.mode};
      else if (command === 'inspect_database') state.capture = {tables: answer.tables.map(t => t.name.name), tableCount: answer.tables.length, authentication: s.authentication.mode};
      return response;
    };
    return true;
  })()`);
  await key("n", "KeyN", 78, 2);
  await check("Connection form opens for Windows Authentication", `!!${field("Server")}`);
  await app.evaluate(
    `(() => { const e = ${field("Server")}; e.focus(); e.select(); return true; })()`,
  );
  await app.send("Input.insertText", { text: `localhost,${port}` });
  await press(button("Windows"));
  const trust = `document.getElementById([...document.querySelectorAll('label')].find(e => e.textContent.trim() === 'Trust the server certificate')?.htmlFor)`;
  await app.evaluate(
    `(() => { const e = ${trust}; if (!e) throw new Error('Trust-certificate checkbox missing'); if (e.getAttribute('aria-checked') !== 'true') e.click(); return true; })()`,
  );
  await press(button("Test connection"));
  await check(
    "Actual SQL Server 2022 accepts integrated authentication",
    `window.__windowsAcceptance.test?.productVersion.startsWith('16.') && window.__windowsAcceptance.test.authentication === 'integrated'`,
  );
  const combo = `[...document.querySelectorAll('[role=combobox]')].find(e => e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.textContent.trim() === 'Database')`;
  const database = combo;
  await check("Database selector is ready", `!!${database} && !${database}.disabled`);
  await press(database);
  await check(
    "Owned fixture database is listed",
    `[...document.querySelectorAll('[role=option]')].some(e => e.textContent.trim() === 'SchemaCraftCode')`,
  );
  await press(
    `[...document.querySelectorAll('[role=option]')].find(e => e.textContent.trim() === 'SchemaCraftCode')`,
  );
  await check(
    "Read schema is enabled",
    `!!${button("Read schema")} && !${button("Read schema")}.disabled`,
  );
  await press(button("Read schema"));
  await check(
    "Integrated capture returns the public fixture tables",
    `window.__windowsAcceptance.capture?.authentication === 'integrated' && window.__windowsAcceptance.capture.tables.includes('Orders') && window.__windowsAcceptance.capture.tables.includes('OrderLines')`,
  );
  await check(
    "Actual diagram renders captured tables",
    `!document.querySelector('[role=dialog]') && document.querySelectorAll('.react-flow__node').length > 0 && document.body.textContent.includes('Orders')`,
  );
  report.windowsAuthentication = await app.evaluate("window.__windowsAcceptance");
  assert.deepEqual(report.windowsAuthentication.errors, []);
  await app.shot("04-windows-auth-capture");
}
async function menu(label, item) {
  const selector = `button[aria-label=${JSON.stringify(label)}]`;
  assert(
    await app.evaluate(
      `(() => {const b = document.querySelector(${JSON.stringify(selector)}); b?.focus(); return !!b;})()`,
    ),
  );
  await key("Enter", "Enter", 13);
  await check(
    `Menu ${label} opens`,
    `document.querySelectorAll('[role=menuitemradio]').length > 0`,
  );
  assert(
    await app.evaluate(
      `(() => {const b = [...document.querySelectorAll('[role=menuitemradio]')].find(e => e.textContent.includes(${JSON.stringify(item)})); b?.focus(); return !!b;})()`,
    ),
  );
  await key("Enter", "Enter", 13);
}
try {
  await mkdir(dirname(preferenceFile), { recursive: true });
  await writeFile(
    preferenceFile,
    JSON.stringify({ formatVersion: 1, recentConnections: [], recentProjects: [] }),
  );
  report.terminationConfirmed = false;
  const start = performance.now();
  app = await launch(executable, 9395, out);
  report.startupMilliseconds = Math.round(performance.now() - start);
  await check(
    "Embedded frontend loads",
    `document.readyState === 'complete' && !!window.__TAURI_INTERNALS__`,
  );
  await app.evaluate(
    `localStorage.setItem('schemacraft.settings', JSON.stringify({version:1,state:{locale:'en',themePreference:'light',isSidebarOpen:true,inspectorWidth:500}})); location.reload(); true`,
  );
  await check(
    "English light welcome screen",
    `document.documentElement.lang === 'en' && document.documentElement.dataset.theme === 'light' && [...document.querySelectorAll('button')].some(e => e.textContent.includes('Connect'))`,
  );
  const info = await app.evaluate(`window.__TAURI_INTERNALS__.invoke('get_app_info')`);
  assert.equal(info.version, version);
  assert.equal(info.isDebugBuild, false);
  report.checks.push({
    name: "Actual release backend reports exact version and production build",
    passed: true,
  });
  await app.shot("01-welcome-en-light");
  await key("F1", "F1", 112);
  await check(
    "About shows exact version",
    `document.querySelector('[role=dialog]')?.textContent.includes(${JSON.stringify(`Version ${version}`)})`,
  );
  await app.shot("02-about");
  await key("Escape", "Escape", 27);
  await check("Escape closes About", `!document.querySelector('[role=dialog]')`);
  await app.evaluate(`window.__acceptanceNavigationMarker = 'retained'; true`);
  await key("F5", "F5", 116);
  await sleep(750);
  assert.equal(await app.evaluate(`window.__acceptanceNavigationMarker`), "retained");
  report.checks.push({ name: "F5 does not reload the release page", passed: true });
  await menu("Language", "Español");
  await check(
    "Spanish welcome screen",
    `document.documentElement.lang === 'es' && document.body.textContent.includes('Conectar')`,
  );
  await menu("Tema", "Oscuro");
  await check("Dark theme applies", `document.documentElement.dataset.theme === 'dark'`);
  await app.shot("03-welcome-es-dark");
  if (process.env.SCHEMACRAFT_ACCEPTANCE_SQL_PORT) {
    await menu("Idioma", "English");
    await menu("Theme", "Light");
    await windowsAuthentication();
  }
  report.passed = true;
} catch (error) {
  if (!app && error.terminationConfirmed === true) report.terminationConfirmed = true;
  report.error = String(error);
  report.appPid = error.appPid ?? null;
} finally {
  if (app) {
    try {
      report.terminationConfirmed = (await app.close()).terminationConfirmed;
    } catch (error) {
      report.error = String(error);
      report.appPid = error.appPid ?? null;
    }
  }
  if (report.terminationConfirmed) {
    if (original !== null) {
      await copyFile(backup, preferenceFile);
      assert.equal(hash(await readFile(preferenceFile)), hash(original));
      await rm(backup);
    } else {
      await rm(preferenceFile, { force: true });
    }
    report.preferencesRestored = true;
  }
  report.passed = report.passed && report.terminationConfirmed && report.preferencesRestored;
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  // The profile and any recovery backup are deliberately excluded from uploaded evidence.
  process.exitCode = report.passed ? 0 : 1;
}
