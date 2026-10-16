import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Preferences, SavedConnection } from "@/shared/contracts";
import { OperationError } from "@/shared/ipc/operationError";

const preferencesBackend = vi.hoisted(() => ({
  readPreferences: vi.fn<() => Promise<Preferences>>(),
  rememberConnection: vi.fn<(connection: SavedConnection) => Promise<Preferences>>(),
  forgetConnection: vi.fn<(connection: SavedConnection) => Promise<Preferences>>(),
  rememberProject: vi.fn<(path: string) => Promise<Preferences>>(),
  forgetProject: vi.fn<(path: string) => Promise<Preferences>>(),
}));

vi.mock("@/shared/ipc/preferencesBackend", () => ({
  getPreferencesBackend: () => Promise.resolve(preferencesBackend),
}));

const { usePreferencesStore } = await import("./preferencesStore");

const connection: SavedConnection = {
  provider: "sqlServer",
  host: "db",
  instance: null,
  port: null,
  database: "Shop",
  authentication: { mode: "integrated" },
  encryption: "mandatory",
  trustServerCertificate: false,
};

function preferences(paths: string[], connections: SavedConnection[] = []): Preferences {
  return {
    formatVersion: 1,
    recentConnections: connections.map((entry) => ({
      connection: entry,
      lastUsedAt: "2026-10-15T09:00:00Z",
    })),
    recentProjects: paths.map((path) => ({ path, lastOpenedAt: "2026-10-15T09:00:00Z" })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  usePreferencesStore.setState({ recentConnections: [], recentProjects: [], isLoaded: false });
});

describe("usePreferencesStore", () => {
  it("mirrors what the Rust side answers to every operation", async () => {
    preferencesBackend.readPreferences.mockResolvedValue(preferences(["C:\\a.scraft"]));
    await usePreferencesStore.getState().load();
    expect(usePreferencesStore.getState().isLoaded).toBe(true);
    expect(usePreferencesStore.getState().recentProjects.map((entry) => entry.path)).toEqual([
      "C:\\a.scraft",
    ]);

    preferencesBackend.rememberConnection.mockResolvedValue(
      preferences(["C:\\a.scraft"], [connection]),
    );
    await usePreferencesStore.getState().rememberConnection(connection);
    expect(preferencesBackend.rememberConnection).toHaveBeenCalledWith(connection);
    expect(usePreferencesStore.getState().recentConnections).toHaveLength(1);

    preferencesBackend.forgetProject.mockResolvedValue(preferences([], [connection]));
    await usePreferencesStore.getState().forgetProject("C:\\a.scraft");
    expect(preferencesBackend.forgetProject).toHaveBeenCalledWith("C:\\a.scraft");
    expect(usePreferencesStore.getState().recentProjects).toEqual([]);
  });

  it("logs a failure and keeps the history it had, without throwing", async () => {
    preferencesBackend.rememberProject.mockResolvedValue(preferences(["C:\\a.scraft"]));
    await usePreferencesStore.getState().rememberProject("C:\\a.scraft");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    preferencesBackend.rememberProject.mockRejectedValue(
      new OperationError({ type: "preferences", value: "write" }, "disk full"),
    );

    await expect(usePreferencesStore.getState().rememberProject("C:\\b.scraft")).resolves.toBe(
      undefined,
    );

    expect(warn).toHaveBeenCalledOnce();
    expect(usePreferencesStore.getState().recentProjects.map((entry) => entry.path)).toEqual([
      "C:\\a.scraft",
    ]);
    warn.mockRestore();
  });

  it("stays unloaded when the file cannot be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    preferencesBackend.readPreferences.mockRejectedValue(
      new OperationError({ type: "preferences", value: "read" }, "locked"),
    );

    await usePreferencesStore.getState().load();

    expect(usePreferencesStore.getState().isLoaded).toBe(false);
    expect(usePreferencesStore.getState().recentProjects).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
