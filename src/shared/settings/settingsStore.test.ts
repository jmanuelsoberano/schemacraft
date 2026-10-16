import { beforeEach, describe, expect, it, vi } from "vitest";

// The store persists to local storage, which the test environment lacks; an in-memory stand-in
// lets the round trip through the persist middleware be checked as well.
const storage = vi.hoisted(() => {
  const items = new Map<string, string>();
  const stub = {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
  // The persist middleware reads `window.localStorage`.
  vi.stubGlobal("window", { localStorage: stub });
  return stub;
});

const {
  DISMISSED_ACCESS_NOTICES_LIMIT,
  INSPECTOR_WIDTH_LIMITS,
  SIDEBAR_WIDTH_LIMITS,
  clampPanelWidth,
  mergePersistedSettings,
  useSettingsStore,
} = await import("./settingsStore");

const defaults = {
  themePreference: "system" as const,
  locale: "en" as const,
  isSidebarOpen: true,
  sidebarWidth: SIDEBAR_WIDTH_LIMITS.default,
  inspectorWidth: INSPECTOR_WIDTH_LIMITS.default,
  dismissedAccessNotices: [] as readonly string[],
};

beforeEach(() => {
  useSettingsStore.setState({ ...defaults });
});

describe("clampPanelWidth", () => {
  it("keeps a width within the limits of its panel, in whole pixels", () => {
    expect(clampPanelWidth(300, SIDEBAR_WIDTH_LIMITS)).toBe(300);
    expect(clampPanelWidth(300.4, SIDEBAR_WIDTH_LIMITS)).toBe(300);
    expect(clampPanelWidth(10, SIDEBAR_WIDTH_LIMITS)).toBe(SIDEBAR_WIDTH_LIMITS.min);
    expect(clampPanelWidth(9000, SIDEBAR_WIDTH_LIMITS)).toBe(SIDEBAR_WIDTH_LIMITS.max);
    expect(clampPanelWidth(10, INSPECTOR_WIDTH_LIMITS)).toBe(INSPECTOR_WIDTH_LIMITS.min);
    expect(clampPanelWidth(9000, INSPECTOR_WIDTH_LIMITS)).toBe(INSPECTOR_WIDTH_LIMITS.max);
  });

  it("falls back to the default for a width that is not a number", () => {
    expect(clampPanelWidth(Number.NaN, SIDEBAR_WIDTH_LIMITS)).toBe(SIDEBAR_WIDTH_LIMITS.default);
    expect(clampPanelWidth(Number.POSITIVE_INFINITY, INSPECTOR_WIDTH_LIMITS)).toBe(
      INSPECTOR_WIDTH_LIMITS.default,
    );
  });
});

describe("mergePersistedSettings", () => {
  it("adopts every stored value of the right shape", () => {
    expect(
      mergePersistedSettings(
        {
          themePreference: "dark",
          locale: "es",
          isSidebarOpen: false,
          sidebarWidth: 300,
          inspectorWidth: 420,
          dismissedAccessNotices: ["b", "a"],
        },
        defaults,
      ),
    ).toEqual({
      themePreference: "dark",
      locale: "es",
      isSidebarOpen: false,
      sidebarWidth: 300,
      inspectorWidth: 420,
      dismissedAccessNotices: ["b", "a"],
    });
  });

  it("falls back to the defaults for missing or malformed values", () => {
    expect(mergePersistedSettings(undefined, defaults)).toEqual(defaults);
    expect(mergePersistedSettings("garbage", defaults)).toEqual(defaults);
    expect(
      mergePersistedSettings(
        {
          themePreference: "sepia",
          locale: "fr",
          isSidebarOpen: "yes",
          sidebarWidth: "wide",
          inspectorWidth: "wider",
          dismissedAccessNotices: "all",
        },
        defaults,
      ),
    ).toEqual(defaults);
  });

  it("gives the Inspector its default width when storage predates it", () => {
    const stored = { themePreference: "light", sidebarWidth: 240 };
    expect(mergePersistedSettings(stored, defaults)).toMatchObject({
      sidebarWidth: 240,
      inspectorWidth: INSPECTOR_WIDTH_LIMITS.default,
    });
  });

  it("keeps the panel widths within their limits", () => {
    const merged = mergePersistedSettings({ sidebarWidth: 9000, inspectorWidth: 10 }, defaults);
    expect(merged.sidebarWidth).toBe(SIDEBAR_WIDTH_LIMITS.max);
    expect(merged.inspectorWidth).toBe(INSPECTOR_WIDTH_LIMITS.min);
  });

  it("keeps the dismissed notices unique, most recent first and within the limit", () => {
    const stored = ["c", 7, "b", "c", ...Array.from({ length: 60 }, (_, index) => `old-${index}`)];
    const merged = mergePersistedSettings({ dismissedAccessNotices: stored }, defaults);
    expect(merged.dismissedAccessNotices).toHaveLength(DISMISSED_ACCESS_NOTICES_LIMIT);
    expect(merged.dismissedAccessNotices.slice(0, 3)).toEqual(["c", "b", "old-0"]);
  });

  it("leaves the rest of the state alone", () => {
    const current = { ...defaults, setLocale: () => undefined };
    expect(mergePersistedSettings({ locale: "es" }, current).setLocale).toBe(current.setLocale);
  });
});

describe("the panel widths", () => {
  it("are clamped as they are set", () => {
    const { setSidebarWidth, setInspectorWidth } = useSettingsStore.getState();
    setSidebarWidth(1);
    setInspectorWidth(1e6);
    expect(useSettingsStore.getState()).toMatchObject({
      sidebarWidth: SIDEBAR_WIDTH_LIMITS.min,
      inspectorWidth: INSPECTOR_WIDTH_LIMITS.max,
    });
  });
});

describe("dismissAccessNotice", () => {
  it("remembers a signature once, most recent first", () => {
    const { dismissAccessNotice } = useSettingsStore.getState();
    dismissAccessNotice("first");
    dismissAccessNotice("second");
    dismissAccessNotice("first");
    expect(useSettingsStore.getState().dismissedAccessNotices).toEqual(["first", "second"]);
  });

  it("forgets the oldest signature beyond the limit", () => {
    const { dismissAccessNotice } = useSettingsStore.getState();
    for (let index = 0; index <= DISMISSED_ACCESS_NOTICES_LIMIT; index += 1) {
      dismissAccessNotice(`notice-${index}`);
    }
    const remembered = useSettingsStore.getState().dismissedAccessNotices;
    expect(remembered).toHaveLength(DISMISSED_ACCESS_NOTICES_LIMIT);
    expect(remembered[0]).toBe(`notice-${DISMISSED_ACCESS_NOTICES_LIMIT}`);
    expect(remembered).not.toContain("notice-0");
  });

  it("is written to local storage with the other settings", () => {
    useSettingsStore.getState().dismissAccessNotice("server|db|partial");
    const written = JSON.parse(storage.items.get("schemacraft.settings") ?? "{}") as {
      state?: Record<string, unknown>;
    };
    expect(written.state).toMatchObject({
      dismissedAccessNotices: ["server|db|partial"],
      sidebarWidth: SIDEBAR_WIDTH_LIMITS.default,
      inspectorWidth: INSPECTOR_WIDTH_LIMITS.default,
    });
    expect(Object.keys(written.state ?? {}).sort()).toEqual([
      "dismissedAccessNotices",
      "inspectorWidth",
      "isSidebarOpen",
      "locale",
      "sidebarWidth",
      "themePreference",
    ]);
  });
});
