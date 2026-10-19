import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Tooltip } from "radix-ui";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/settings/settingsStore", () => ({
  useSettingsStore: (select: (value: object) => unknown) =>
    select({ codeWrap: false, setCodeWrap: () => undefined }),
}));
vi.mock("@/shared/i18n/useI18n", async () => {
  const { createCatalogTranslator } = await import("@/shared/i18n/translator");
  const { englishMessages } = await import("@/shared/i18n/messages/en");
  return { useI18n: () => createCatalogTranslator(englishMessages, "en") };
});
const { CodeViewer } = await import("./CodeViewer");
describe("read-only code surface", () => {
  it("escapes SQL as text, exposes line numbers and keeps a keyboard stop", () => {
    const html = renderToString(
      createElement(
        Tooltip.Provider,
        null,
        createElement(CodeViewer, { text: "-- <script>alert(1)</script>\r\nSELECT 1;  " }),
      ),
    );
    expect(html).toContain('data-keyboard-owner="code"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-line="2"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("\r\n");
    expect(html).not.toContain("contenteditable");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Copy code");
  });
});
