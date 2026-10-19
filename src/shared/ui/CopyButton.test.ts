import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";
import { copyText } from "./copy";

describe("shared copy button", () => {
  it("writes the raw text, preserving line endings and trailing whitespace", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const text = "-- secret-looking example\r\nSELECT N'<script>';  \r\n";
    expect(await copyText(text)).toBe("copied");
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
    vi.unstubAllGlobals();
  });
  it("reports unavailable clipboard access without logging the text or error", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("private text")) },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await copyText("stored SQL")).toBe("failed");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllGlobals();
  });
  it("renders a stable live status and never embeds the copied text", () => {
    const html = renderToString(
      createElement(CopyButton, {
        text: "private SQL",
        label: "Copy code",
        copiedLabel: "Copied",
        failedLabel: "Could not copy",
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Copy code");
    expect(html).not.toContain("private SQL");
  });
});
