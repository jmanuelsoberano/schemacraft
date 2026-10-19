// Invoked only by the guarded standard-user worker on a disposable GitHub runner.
import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { assertPortFree, launch, sleep } from "./release-cdp.mjs";

assert.equal(
  process.env.SCHEMACRAFT_ACCEPTANCE_EPHEMERAL,
  "1",
  "The guarded worker must launch this check",
);
if (process.argv[2] === "--html-viewer") {
  await verifyStandaloneHtml(...process.argv.slice(3));
  process.exit(process.exitCode ?? 0);
}
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
    const exportDestination = ${j(join(out, "diagram.html"))};
    const state = window.__windowsAcceptance = { test: null, capture: null, errors: [], nextSave: null, exports: 0 };
    const reply = (value, status = 'ok') => new Response(JSON.stringify(value), {headers:{'Content-Type':'application/json','Tauri-Response':status}});
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.hostname !== 'ipc.localhost') return original(input, options);
      const command = decodeURIComponent(url.pathname.slice(1));
      if (command === 'plugin:dialog|save') {
        if (!state.nextSave) return reply({kind:'acceptanceFileGuard',message:'Unexpected native file picker'}, 'error');
        const path = state.nextSave; state.nextSave = null; return reply(path);
      }
      if (command === 'export_diagram') {
        let request;
        try { request = JSON.parse(options.body).request; } catch { return reply({kind:'acceptanceFileGuard',message:'Unreadable export request'}, 'error'); }
        if (request?.destination !== exportDestination || request.format !== 'html') return reply({kind:'acceptanceFileGuard',message:'Only the owned HTML export is allowed'}, 'error');
        const response = await original(input, options);
        if (response.headers.get('Tauri-Response') === 'ok') state.exports++;
        else state.errors.push({command,kind:(await response.clone().json()).kind});
        return response;
      }
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
  const htmlPath = join(out, "diagram.html");
  const dialogButton = (text) =>
    `[...document.querySelector('[role=dialog]').querySelectorAll('button')].find(e => e.textContent.trim() === ${j(text)})`;
  await key("e", "KeyE", 69, 2);
  await check(
    "Export dialog opens",
    `!!document.querySelector('[role=dialog] [aria-label=Format]')`,
  );
  await press(dialogButton("HTML"));
  await app.evaluate(`window.__windowsAcceptance.nextSave = ${j(htmlPath)}; true`);
  await press(dialogButton("Export"));
  await check(
    "Standalone HTML is written by the actual Rust exporter",
    `window.__windowsAcceptance.exports === 1 && document.querySelector('[role=dialog]')?.textContent.includes('Diagram exported')`,
  );
  await press(dialogButton("Close"));
  const htmlBytes = await readFile(htmlPath);
  const payload = /<script id="schemacraft-data" type="application\/json">(.*?)<\/script>/su.exec(
    htmlBytes.toString("utf8"),
  )?.[1];
  assert(payload, "Export embeds its self-contained schema data");
  const data = JSON.parse(payload);
  assert.deepEqual(data.snapshot.programmability.routines, []);
  assert(
    data.snapshot.programmability.triggers.some(
      (trigger) => trigger.name === "TR_Orders_InsertUpdate",
    ),
  );
  assert(data.snapshot.views.some((view) => view.name.name === "OrderSummary"));
  assert(
    !/CREATE\s+(?:OR\s+ALTER\s+)?(?:PROCEDURE|FUNCTION|TRIGGER|VIEW)\b/iu.test(payload),
    "Export excludes module source",
  );
  report.htmlExport = { path: htmlPath, bytes: htmlBytes.length, sha256: hash(htmlBytes) };
  assert.deepEqual(await app.evaluate("window.__windowsAcceptance.errors"), []);
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

/** Opens the unmodified exported file after uninstall, without launching SchemaCraft. */
async function verifyStandaloneHtml(edgeExecutable, htmlFile, outputDirectory) {
  assert(edgeExecutable && htmlFile && outputDirectory);
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const fileUrl = pathToFileURL(resolve(htmlFile)).href;
  const result = {
    browser: resolve(edgeExecutable),
    htmlSha256: createHash("sha256")
      .update(await readFile(htmlFile))
      .digest("hex"),
    checks: [],
    passed: false,
    terminationConfirmed: true,
  };
  const pending = new Map();
  let child;
  let socket;
  let exited = false;
  let nextId = 0;
  const send = (method, params = {}) =>
    new Promise((resolveRequest, rejectRequest) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`Browser CDP timed out: ${method}`));
      }, 15000);
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        rejectRequest(error);
      }
    });
  const evaluate = async (expression) => {
    const answer = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    assert(!answer.exceptionDetails, "Standalone viewer expression completes");
    return answer.result.value;
  };
  const check = async (name, expression) => {
    let passed = false;
    const deadline = Date.now() + 20000;
    while (!passed && Date.now() < deadline) {
      passed = !!(await evaluate(expression));
      if (!passed) await sleep(100);
    }
    result.checks.push({ name, passed });
    assert(passed, name);
  };
  const screenshot = async (name) => {
    const capture = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(output, name), Buffer.from(capture.data, "base64"));
  };
  try {
    await assertPortFree(9396);
    child = spawn(
      resolve(edgeExecutable),
      [
        "--headless=new",
        "--disable-gpu",
        "--disable-background-networking",
        "--disable-component-update",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1440,1000",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9396",
        `--user-data-dir=${join(output, "edge-profile")}`,
        fileUrl,
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    result.terminationConfirmed = false;
    child.once("exit", () => {
      exited = true;
    });
    let spawnFailure;
    child.once("error", (error) => {
      spawnFailure = error;
      if (!child.pid) exited = true;
    });
    let page;
    const deadline = Date.now() + 60000;
    while (!page && Date.now() < deadline) {
      if (spawnFailure) throw spawnFailure;
      assert(!exited, "The owned browser remains running");
      try {
        const targets = await (
          await fetch("http://127.0.0.1:9396/json", { signal: AbortSignal.timeout(1000) })
        ).json();
        page = targets.find((target) => target.type === "page" && target.url === fileUrl);
      } catch {
        /* The owned browser may still be starting. */
      }
      if (!page) await sleep(200);
    }
    assert(page, "The owned browser opened the exact exported local file");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveSocket, rejectSocket) => {
      const timer = setTimeout(() => rejectSocket(new Error("Browser CDP did not open")), 10000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolveSocket();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          rejectSocket(new Error("Browser CDP failed"));
        },
        { once: true },
      );
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    await send("Network.enable");
    await send("Network.setBlockedURLs", { urls: ["http://*", "https://*", "ws://*", "wss://*"] });
    await send("Page.reload", { ignoreCache: true });
    await check(
      "Standalone viewer renders tables and views with network access blocked",
      `document.readyState === 'complete' && document.querySelectorAll('.sc-world [data-entity]').length === 8 && document.querySelector('.sc-summary')?.textContent.includes('4 tables') && document.querySelector('.sc-summary')?.textContent.includes('4 views') && document.querySelector('.sc-world').textContent.includes('Orders')`,
    );
    assert.equal(await evaluate("typeof window.__TAURI_INTERNALS__"), "undefined");
    result.checks.push({ name: "Standalone browser has no Tauri runtime", passed: true });
    await screenshot("01-diagram.png");
    const select = async (name) => {
      await evaluate(
        `(() => { const search = document.querySelector('.sc-search'); search.focus(); search.value = ${JSON.stringify(name)}; search.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`,
      );
      await check(
        `Search finds ${name}`,
        `[...document.querySelectorAll('.sc-result-name')].some(e => e.textContent === ${JSON.stringify(name)})`,
      );
      await evaluate(
        `(() => { const item = [...document.querySelectorAll('.sc-result')].find(e => e.querySelector('.sc-result-name')?.textContent === ${JSON.stringify(name)}); item.dispatchEvent(new MouseEvent('mousedown', {bubbles:true,button:0})); return true; })()`,
      );
      await check(
        `Details open for ${name}`,
        `!!document.querySelector('.sc-panel:not([hidden])') && document.querySelector('.sc-panel').textContent.includes(${JSON.stringify(name)})`,
      );
    };
    await select("app.Orders");
    await check(
      "Table details expose trigger metadata",
      `document.querySelector('.sc-panel .sc-triggers')?.textContent.includes('TR_Orders_InsertUpdate')`,
    );
    await screenshot("02-table-triggers.png");
    await select("app.OrderSummary");
    await check(
      "View details expose trigger metadata and exclude its SQL definition",
      `document.querySelector('.sc-panel .sc-triggers')?.textContent.includes('TR_OrderSummary_Insert') && document.querySelector('.sc-panel .sc-view-definition')?.textContent.includes('Not included in this file')`,
    );
    await screenshot("03-view-definition.png");
    result.passed = true;
  } catch (error) {
    result.error = String(error);
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      // Browser.close can terminate the connection before its response arrives.
      try {
        socket.send(JSON.stringify({ id: ++nextId, method: "Browser.close" }));
      } catch {
        /* The browser may already have closed. */
      }
    }
    if (child?.pid && !exited) {
      const deadline = Date.now() + 10000;
      while (!exited && Date.now() < deadline) await sleep(100);
      if (!exited) {
        try {
          await promisify(execFile)("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            timeout: 5000,
          });
        } catch (error) {
          result.shutdownError = String(error);
        }
        const stopDeadline = Date.now() + 5000;
        while (!exited && Date.now() < stopDeadline) await sleep(100);
      }
    }
    socket?.close();
    for (const request of pending.values()) clearTimeout(request.timer);
    result.terminationConfirmed = !child?.pid || exited;
    result.passed = result.passed && result.terminationConfirmed;
    await writeFile(join(output, "report.json"), JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
  }
}
