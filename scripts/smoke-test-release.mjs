// Starts a built SchemaCraft executable with a remote debugging port (the application opens it
// when SCHEMACRAFT_REMOTE_DEBUGGING_PORT is set), checks the first screen
// and a few interactions through the Chrome DevTools Protocol, saves screenshots and a JSON report
// and exits with a non-zero code on any failure. It needs an optimised build (`npm run tauri
// build -- --no-bundle`, or `-- --no-bundle -- --profile ci` as CI does): debug builds load the
// Vite development server instead of the embedded frontend. The machine needs the WebView2 runtime, like any user's machine; without it the test
// fails right away instead of waiting for a window that never comes.
//   node scripts/smoke-test-release.mjs <path-to-exe> [output-dir]
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const [exePath, outputDir = "smoke-test"] = process.argv.slice(2);
if (!exePath) {
  console.error("usage: node scripts/smoke-test-release.mjs <path-to-exe> [output-dir]");
  process.exit(2);
}
const PORT = 9333;
// Where the Evergreen WebView2 runtime registers itself: per machine (64-bit Windows) and per user.
const WEBVIEW2_CLIENT_KEYS = [
  "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
  "HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
];
const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const report = { exe: resolve(exePath), checks: {} };

function check(name, condition, detail) {
  report.checks[name] = condition;
  if (!condition) {
    failures.push(`${name}${detail === undefined ? "" : `: ${detail}`}`);
  }
}

async function webview2RuntimeVersion() {
  for (const key of WEBVIEW2_CLIENT_KEYS) {
    try {
      const { stdout } = await execFileAsync("reg.exe", ["query", key, "/v", "pv"]);
      const match = /pv\s+REG_SZ\s+(\S+)/u.exec(stdout);
      if (match) return match[1];
    } catch {
      // The key does not exist: try the next location.
    }
  }
  return null;
}

/**
 * Explains a page that never answered: the windows on the desktop, the WebView2 browser process
 * command line (which shows whether the port switch reached it), who listens on the port, and a
 * screenshot of the whole desktop.
 */
async function describeMachine(screenshotPath) {
  const target = screenshotPath.replaceAll("\\", "/").replaceAll("'", "''");
  const script = [
    "Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + ': ' + $_.MainWindowTitle }",
    "Get-CimInstance Win32_Process -Filter \"Name = 'msedgewebview2.exe'\" | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object { 'webview2 browser: ' + (($_.CommandLine -split ' --' | Where-Object { $_ -match 'webview-exe-name|user-data-dir|disable-features|remote-debugging' } | ForEach-Object { '--' + $_ }) -join ' ') }",
    `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { 'listening on ${PORT}: pid ' + $_.OwningProcess }`,
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
    "$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
    "$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)",
    `$bitmap.Save('${target}')`,
  ].join("; ");
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    return stdout.trim().split(/\r?\n/u).filter(Boolean);
  } catch (error) {
    return [
      `desktop diagnostics failed: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}

async function finish() {
  report.failures = failures;
  await writeFile(join(outputDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(failures.length === 0 ? 0 : 1);
}

await mkdir(outputDir, { recursive: true });
report.exeBytes = (await stat(exePath)).size;
report.webview2Version = await webview2RuntimeVersion();
if (report.webview2Version === null) {
  failures.push(
    "the WebView2 runtime is not installed on this machine; the application cannot start",
  );
  await finish();
}

const startedAt = Date.now();
// A private WebView2 profile outside the output directory: no clash with a running instance, no
// leftover settings and no cache in the artifacts.
const profileDir = await mkdtemp(join(tmpdir(), "schemacraft-smoke-"));
const child = spawn(resolve(exePath), [], {
  env: {
    ...process.env,
    SCHEMACRAFT_REMOTE_DEBUGGING_PORT: String(PORT),
    WEBVIEW2_USER_DATA_FOLDER: profileDir,
    SCHEMACRAFT_LOG: "info",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let exited = null;
child.on("exit", (code, signal) => {
  exited = { code, signal };
});
// The application logs through tracing on stdout; keep its lines next to the test output.
child.stdout.on("data", (chunk) => process.stdout.write(chunk));
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
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    ...base,
    ...(key === "Enter" && modifiers === 0 ? { text: "\r" } : {}),
  });
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

/** Checks the local support preview without opening an external page or uploading evidence. */
async function checkSupportPreview(locale) {
  await press("F1", "F1", 112);
  const label = locale === "es" ? "Reportar un problema…" : "Report a problem…";
  const focused = await waitFor(
    `(() => {
    const button = [...document.querySelectorAll('[role="dialog"] button')].find(item => item.textContent.trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.focus(); return document.activeElement === button;
  })()`,
    5000,
  );
  check(`support action available in About (${locale})`, focused);
  if (!focused) return;
  await press("Enter", "Enter", 13);
  check(
    `support preview is real read-only diagnostic text (${locale})`,
    await waitFor(
      `(() => {
    const preview = document.querySelector('[role="dialog"] textarea');
    return preview?.readOnly === true && preview.value.startsWith('SchemaCraft diagnostic report');
  })()`,
      10000,
    ),
  );
  check(
    `support keeps keyboard focus in its dialog (${locale})`,
    await evaluate(`!!document.activeElement?.closest('[role="dialog"]')`),
  );
  const notice =
    locale === "es" ? "No se envía nada automáticamente." : "Nothing is submitted automatically.";
  check(
    `support explains manual sharing (${locale})`,
    await evaluate(
      `document.querySelector('[role="dialog"]').textContent.includes(${JSON.stringify(notice)})`,
    ),
  );
  await screenshot(`support-${locale}.png`);
  await press("Escape", "Escape", 27);
  check(
    `support closes with Escape (${locale})`,
    await waitFor(`!document.querySelector('[role="dialog"]')`, 5000),
  );
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

  await checkSupportPreview("en");

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

  await checkSupportPreview("es");

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
  if (failures.length > 0) {
    // Taken while the application is still running, so a stray dialog shows up in both.
    report.machine = await describeMachine(resolve(outputDir, "99-desktop-on-failure.png"));
  }
  if (exited === null) {
    child.kill();
  }
}

await finish();
