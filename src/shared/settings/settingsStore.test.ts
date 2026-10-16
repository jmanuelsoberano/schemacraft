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
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  mergePersistedSettings,
  useSettingsStore,
} = await import("./settingsStore");

const defaults = {
  themePreference: "system" as const,
  locale: "en" as const,
  isSidebarOpen: true,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  dismissedAccessNotices: [] as readonly string[],
};

beforeEach(() => {
  useSettingsStore.setState({ ...defaults });
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
          dismissedAccessNotices: ["b", "a"],
        },
        defaults,
      ),
    ).toEqual({
      themePreference: "dark",
      locale: "es",
      isSidebarOpen: false,
      sidebarWidth: 300,
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
          dismissedAccessNotices: "all",
        },
        defaults,
      ),
    ).toEqual(defaults);
  });

  it("keeps the panel width within its limits", () => {
    expect(mergePersistedSettings({ sidebarWidth: 9000 }, defaults).sidebarWidth).toBe(
      SIDEBAR_MAX_WIDTH,
    );
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
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    });
    expect(Object.keys(written.state ?? {}).sort()).toEqual([
      "dismissedAccessNotices",
      "isSidebarOpen",
      "locale",
      "sidebarWidth",
      "themePreference",
    ]);
  });
});
