import { spawn, execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 60000;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}

export async function launch(exe, port, outDir) {
  let child;
  let ws;
  let ended = false;
  let spawnError = null;
  let terminalError = null;
  let closePromise;
  let markTerminated;
  const terminated = new Promise((resolve) => {
    markTerminated = resolve;
  });
  const pending = new Map();
  const log = [];

  function rejectPending(error) {
    terminalError ??= error;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(terminalError);
    }
    pending.clear();
  }
  function markEnded() {
    ended = true;
    markTerminated();
    rejectPending(new Error("Test app exited"));
  }
  async function waitForTermination(timeoutMs) {
    if (ended) return;
    let timer;
    try {
      await Promise.race([
        terminated,
        new Promise((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function stop() {
    rejectPending(new Error("Test app is closing"));
    try {
      ws?.close();
    } catch {}
    if (!child || ended) return { terminationConfirmed: true };
    let killError;
    try {
      child.kill();
    } catch (error) {
      killError = error;
    }
    await waitForTermination(5000);
    if (!ended && child.pid) {
      try {
        await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          timeout: 5000,
        });
      } catch (error) {
        killError = error;
      }
      await waitForTermination(5000);
    }
    if (!ended) {
      const failure = new Error(
        "Test app termination was not confirmed; preferences must remain untouched until the process is stopped",
        { cause: killError },
      );
      failure.terminationConfirmed = false;
      failure.appPid = child.pid ?? null;
      throw failure;
    }
    return { terminationConfirmed: true };
  }
  function close() {
    return (closePromise ??= stop());
  }

  try {
    await assertPortFree(port);
    const profileDir = await mkdtemp(join(tmpdir(), "schemacraft-e2e-"));
    child = spawn(resolve(exe), [], {
      env: {
        ...process.env,
        SCHEMACRAFT_REMOTE_DEBUGGING_PORT: String(port),
        WEBVIEW2_USER_DATA_FOLDER: profileDir,
        SCHEMACRAFT_LOG: "info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("error", (error) => {
      spawnError = error;
      rejectPending(error);
      // A failed spawn has no running process and emits no exit event.
      if (!child.pid) markEnded();
    });
    child.once("exit", markEnded);
    child.once("close", markEnded);
    child.stdout.on("data", (value) => log.push(String(value)));
    child.stderr.on("data", (value) => log.push(String(value)));
    let page;
    const discoveryDeadline = Date.now() + 60000;
    while (!page && Date.now() < discoveryDeadline) {
      if (spawnError) throw spawnError;
      if (ended) throw new Error("Test app exited before opening its webview");
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json`, {
          signal: AbortSignal.timeout(1000),
        });
        const targets = await response.json();
        page = targets.find((target) => target.type === "page" && !target.url.startsWith("about:"));
      } catch {}
      if (!page) await sleep(500);
    }
    if (!page) throw new Error("No test app webview");
    if (spawnError || ended) throw spawnError ?? new Error("Test app exited");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.addEventListener("close", () => rejectPending(new Error("CDP connection closed")));
    ws.addEventListener("error", () => rejectPending(new Error("CDP connection failed")));
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onFailure);
        ws.removeEventListener("close", onFailure);
        child.removeListener("exit", onFailure);
        child.removeListener("error", onFailure);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onFailure = () => {
        cleanup();
        reject(terminalError ?? new Error("CDP did not open"));
      };
      const timer = setTimeout(onFailure, 15000);
      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onFailure);
      ws.addEventListener("close", onFailure);
      child.once("exit", onFailure);
      child.once("error", onFailure);
    });
    let id = 0;
    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        rejectPending(new Error("Invalid CDP response"));
        return;
      }
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        clearTimeout(request.timer);
        message.error
          ? request.reject(new Error(message.error.message))
          : request.resolve(message.result);
      }
    });
    const send = (method, params = {}, timeoutMs = COMMAND_TIMEOUT_MS) =>
      new Promise((resolve, reject) => {
        if (terminalError || ended || ws.readyState !== WebSocket.OPEN) {
          reject(terminalError ?? new Error("CDP is not open"));
          return;
        }
        const current = ++id;
        const timer = setTimeout(
          () => {
            pending.delete(current);
            reject(new Error(`CDP timed out: ${method}`));
          },
          Math.max(1, timeoutMs),
        );
        pending.set(current, { resolve, reject, timer });
        try {
          ws.send(JSON.stringify({ id: current, method, params }));
        } catch (error) {
          pending.delete(current);
          clearTimeout(timer);
          reject(error);
        }
      });
    const evaluate = async (expression, timeoutMs = COMMAND_TIMEOUT_MS) => {
      const result = await send(
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
        timeoutMs,
      );
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 600));
      return result.result.value;
    };
    const waitFor = async (expression, timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const result = await evaluate(
            expression,
            Math.min(COMMAND_TIMEOUT_MS, deadline - Date.now()),
          );
          if (result) return result;
        } catch (error) {
          if (terminalError || ended) throw error;
        }
        const remaining = deadline - Date.now();
        if (remaining > 0) await sleep(Math.min(150, remaining));
      }
      return false;
    };
    const shot = async (name) => {
      await sleep(400);
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
    };
    return { evaluate, waitFor, shot, close, log, send };
  } catch (error) {
    let shutdownError;
    try {
      await close();
    } catch (failure) {
      shutdownError = failure;
    }
    const failure = new Error(`Could not launch test app: ${error.message ?? error}`, {
      cause: error,
    });
    failure.terminationConfirmed = !child || ended;
    failure.appPid = child?.pid ?? null;
    if (shutdownError) failure.shutdownError = String(shutdownError);
    throw failure;
  }
}
