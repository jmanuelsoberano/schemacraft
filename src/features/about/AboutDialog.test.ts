import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OperationError } from "@/shared/ipc/operationError";
import type { AppInfoState } from "@/shared/ipc/useAppInfo";

// A server render reads a store's initial state, so the failure a test needs comes from a
// stand-in; English is enough for the words.
const aboutState = vi.hoisted(
  (): { logFolderFailure: unknown; openLogFolder: () => Promise<void> } => ({
    logFolderFailure: null,
    openLogFolder: () => Promise.resolve(),
  }),
);
vi.mock("./aboutStore", () => ({
  useAboutStore: (select: (state: typeof aboutState) => unknown) => select(aboutState),
}));
vi.mock("@/shared/i18n/useI18n", async () => {
  const { createCatalogTranslator } = await import("@/shared/i18n/translator");
  const { englishMessages } = await import("@/shared/i18n/messages/en");
  const translator = createCatalogTranslator(englishMessages, "en");
  return { useI18n: () => translator };
});

const { englishMessages } = await import("@/shared/i18n/messages/en");
const { DiagnosticLog } = await import("./DiagnosticLog");

const LOG_DIRECTORY = "C:\\Users\\ana\\AppData\\Local\\com.jmanuelsoberano.schemacraft\\logs";

function ready(logDirectory: string | null): AppInfoState {
  return {
    status: "ready",
    info: { name: "SchemaCraft", version: "1.2.0", isDebugBuild: false, logDirectory },
  };
}

/** The markup of the row, inside the list it belongs to. */
function rendered(appInfo: AppInfoState): string {
  return renderToString(createElement("dl", null, createElement(DiagnosticLog, { appInfo })));
}

describe("the diagnostic log row of the about dialog", () => {
  it("shows the folder, the button that opens it and what the log holds", () => {
    const markup = rendered(ready(LOG_DIRECTORY));
    expect(markup).toContain(englishMessages["about.log"]);
    expect(markup).toContain(LOG_DIRECTORY);
    expect(markup).toContain(englishMessages["about.log.open"]);
    expect(markup).toContain(englishMessages["about.log.privacy"]);
  });

  it("says why there is no log when this session writes none, without a button", () => {
    const markup = rendered(ready(null));
    expect(markup).toContain(englishMessages["about.log.none"]);
    expect(markup).toContain(englishMessages["about.log.privacy"]);
    expect(markup).not.toContain(englishMessages["about.log.open"]);
    expect(markup).not.toContain("<button");
  });

  it("says that a preview keeps no log", () => {
    const markup = rendered({ status: "unavailable" });
    expect(markup).toContain(englishMessages["about.log.unavailable"]);
    expect(markup).not.toContain("<button");
  });

  it("shows why the folder did not open", () => {
    aboutState.logFolderFailure = new OperationError(
      { type: "unexpected" },
      "the log folder could not be opened",
    );
    try {
      const markup = rendered(ready(LOG_DIRECTORY));
      expect(markup).toContain(englishMessages["error.unexpected.title"]);
      expect(markup).toContain(englishMessages["error.unexpected.hint"]);
      expect(markup).toContain("the log folder could not be opened");
    } finally {
      aboutState.logFolderFailure = null;
    }
  });
});
