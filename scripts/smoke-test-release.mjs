// Starts a built SchemaCraft executable with WebView2 remote debugging, checks the first screen
// and a few interactions through the Chrome DevTools Protocol, saves screenshots and exits with
// a non-zero code on any failure. It needs a release build (`npm run tauri build -- --no-bundle`):
// debug builds load the Vite development server instead of the embedded frontend.
//   node scripts/smoke-test-release.mjs <path-to-exe> [output-dir]
import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [exePath, outputDir = "smoke-test"] = process.argv.slice(2);
if (!exePath) {
  console.error("usage: node scripts/smoke-test-release.mjs <path-to-exe> [output-dir]");
  process.exit(2);
}
const PORT = 9333;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const report = { exe: resolve(exePath), checks: {} };

function check(name, condition, detail) {
  report.checks[name] = condition;
  if (!condition) {
    failures.push(`${name}${detail === undefined ? "" : `: ${detail}`}`);
  }
}

await mkdir(outputDir, { recursive: true });
report.exeBytes = (await stat(exePath)).size;

const startedAt = Date.now();
// A private WebView2 profile: no clash with a running instance, no leftover settings.
const profileDir = resolve(outputDir, "webview2-profile");
await mkdir(profileDir, { recursive: true });
const child = spawn(resolve(exePath), [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    WEBVIEW2_USER_DATA_FOLDER: profileDir,
    SCHEMACRAFT_LOG: "info",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let exited = null;
child.on("exit", (code, signal) => {
  exited = { code, signal };
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

async function findPage() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (exited !== null) {
      throw new Error(
        `the application exited early (code ${exited.code}, signal ${exited.signal})`,
      );
    }
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page;
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  throw new Error("the application did not expose its page within 60 seconds");
}

let ws = null;
let nextId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
  return result.result.value;
}
async function waitFor(expression, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let value = false;
    try {
      value = await evaluate(expression);
    } catch {
      value = false;
    }
    if (value) return value;
    await sleep(150);
  }
  return false;
}
async function screenshot(name, delay = 600) {
  await sleep(delay);
  const capture = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(outputDir, name), Buffer.from(capture.data, "base64"));
}
async function press(key, code, keyCode, modifiers = 0) {
  const base = {
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers,
  };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(250);
}
/** Opens a top bar menu by keyboard and picks the item whose text contains `itemText`. */
async function chooseFromMenu(buttonLabel, itemText) {
  const focused = await evaluate(
    `(() => { const button = document.querySelector('button[aria-label=${JSON.stringify(buttonLabel)}]'); if (!button) return false; button.focus(); return document.activeElement === button; })()`,
  );
  if (!focused) return false;
  await press("Enter", "Enter", 13);
  const items = await waitFor(
    `document.querySelectorAll('[role="menuitemradio"]').length > 0`,
    5000,
  );
  if (!items) return false;
  const index = await evaluate(
    `[...document.querySelectorAll('[role="menuitemradio"]')].findIndex((item) => item.textContent.includes(${JSON.stringify(itemText)}))`,
  );
  if (index < 0) return false;
  await evaluate(`document.querySelectorAll('[role="menuitemradio"]')[${index}].focus()`);
  await press("Enter", "Enter", 13);
  return true;
}

try {
  const page = await findPage();
  report.startupMs = Date.now() - startedAt;
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });

  // The page target exists before the app URL replaces about:blank; wait for the real origin.
  check(
    "page loads",
    await waitFor(`location.protocol.startsWith("http") && document.readyState === "complete"`),
    "the application page never completed",
  );
  // Start from a known state: English, light theme.
  await evaluate(`localStorage.removeItem("schemacraft.settings"); location.reload(); "reloaded"`);
  await sleep(1500);
  check(
    "welcome screen",
    await waitFor(
      `document.body.textContent.includes("SchemaCraft") && [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Connect"))`,
    ),
    "no welcome screen or Connect button",
  );
  report.navigation = JSON.parse(
    await evaluate(
      `(() => { const n = performance.getEntriesByType("navigation")[0]; return JSON.stringify(n ? { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), loadMs: Math.round(n.loadEventEnd) } : null); })()`,
    ),
  );
  check("window title", (await evaluate(`document.title`)) === "SchemaCraft", "unexpected title");
  await screenshot("01-welcome-light-en.png");

  await press("F1", "F1", 112);
  const about = await waitFor(`!!document.querySelector('[role="dialog"]')`, 5000);
  const aboutText = about
    ? await evaluate(`document.querySelector('[role="dialog"]').textContent`)
    : "";
  check("about dialog opens with F1", about, "no dialog");
  check(
    "about dialog shows the version",
    /\d+\.\d+\.\d+/u.test(aboutText),
    aboutText.slice(0, 120),
  );
  report.aboutVersion = aboutText.match(/\d+\.\d+\.\d+/u)?.[0] ?? null;
  await screenshot("02-about.png", 300);
  await press("Escape", "Escape", 27);
  check(
    "escape closes the dialog",
    await waitFor(`!document.querySelector('[role="dialog"]')`, 5000),
  );

  check("language menu switches to Spanish", await chooseFromMenu("Language", "Español"));
  check(
    "spanish strings appear",
    await waitFor(
      `document.documentElement.lang === "es" && document.body.textContent.includes("Conectar")`,
      5000,
    ),
  );
  check("theme menu switches to dark", await chooseFromMenu("Tema", "Oscuro"));
  check(
    "dark theme applies",
    await waitFor(`document.documentElement.dataset.theme === "dark"`, 5000),
  );
  await screenshot("03-welcome-dark-es.png");

  check(
    "F5 does not reload",
    await (async () => {
      await evaluate(`window.__smokeSentinel = true`);
      await press("F5", "F5", 116);
      await sleep(500);
      return (await evaluate(`window.__smokeSentinel === true`)) === true;
    })(),
  );
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  if (ws) ws.close();
  if (exited === null) {
    child.kill();
  }
}

report.failures = failures;
console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
