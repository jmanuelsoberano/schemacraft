import { createElement } from "react";
import { Tooltip } from "radix-ui";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const options = vi.hoisted(() => ({ code: true, texts: true }));
vi.mock("./connectionStore", async () => {
  const { emptyConnectionDraft } = await import("./connectionDraft");
  return {
    useConnectionStore: (select: (state: object) => unknown) =>
      select({
        draft: {
          ...emptyConnectionDraft,
          database: "Shop",
          includeProgrammability: options.code,
          includeModuleDefinitions: options.texts,
        },
        mode: "connect",
        phase: "idle",
        tested: {
          databases: ["Shop"],
          schemas: ["sales"],
          programmabilityOnlySchemas: ["code_only"],
          access: null,
          server: { serverName: "preview", product: "SQL Server", edition: "Developer" },
        },
        failure: null,
        validation: null,
        blockedInspection: null,
      }),
  };
});
vi.mock("@/features/preferences/preferencesStore", () => ({
  usePreferencesStore: (select: (state: object) => unknown) => select({ recentConnections: [] }),
}));
vi.mock("@/shared/i18n/useI18n", async () => {
  const { createCatalogTranslator } = await import("@/shared/i18n/translator");
  const { englishMessages } = await import("@/shared/i18n/messages/en");
  return { useI18n: () => createCatalogTranslator(englishMessages, "en") };
});
const { ConnectionForm } = await import("./ConnectionForm");
const rendered = () =>
  renderToString(
    createElement(
      Tooltip.Provider,
      null,
      createElement(ConnectionForm, {
        serverFieldRef: { current: null },
        passwordFieldRef: { current: null },
      }),
    ),
  );

describe("connection code options", () => {
  it("offers code-only schemas with a hint when objects are included", () => {
    const markup = rendered();
    expect(markup).toContain("code_only");
    expect(markup).toContain("Procedures and functions only");
    expect(markup).toContain("Read procedures, functions and triggers");
    expect(markup).toContain("Saved code can contain business logic and credentials");
  });
  it("hides code-only schemas and disables saving text when objects are off", () => {
    options.code = false;
    try {
      const markup = rendered();
      expect(markup).not.toContain("code_only");
      expect(markup).toMatch(/disabled=""[^>]*[^]*?Save their code in the project/u);
    } finally {
      options.code = true;
    }
  });
});
