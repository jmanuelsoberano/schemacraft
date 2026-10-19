import { describe, expect, expectTypeOf, it } from "vitest";

import type { DetailsMessageKey } from "@/features/schema/objectDetailsView";
import type { RuleMessageKey } from "@/shared/i18n/messages/rules/en";
import { SUPPORTED_LOCALES } from "@/shared/i18n/locales";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";

import {
  VIEWER_MESSAGE_PREFIXES,
  VIEWER_SHARED_MESSAGE_KEYS,
  isViewerMessageKey,
  viewerMessages,
} from "./viewerMessages";
import type { ViewerMessageKey } from "./viewerMessages";

describe.each(SUPPORTED_LOCALES)("%s viewer messages", (locale) => {
  const catalog = messageCatalogs[locale];
  const embedded = viewerMessages(locale);

  it("picks exactly the prefixed keys and the shared ones", () => {
    const expected = Object.keys(catalog)
      .filter(
        (key) =>
          VIEWER_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
          (VIEWER_SHARED_MESSAGE_KEYS as readonly string[]).includes(key),
      )
      .sort();
    expect(Object.keys(embedded).sort()).toEqual(expected);
    expect(expected).toContain("viewer.footer.exported");
    expect(expected).toContain("details.section.columns");
    expect(expected).toContain("entity.view.label");
    expect(expected).toContain("viewMode.compact");
    expect(expected).toContain("trigger.event.after");
    expect(expected).toContain("details.viewDefinition.notIncluded");
    expect(expected).toContain("entity.triggers.enabled.one");
    expect(expected).toContain("export.triggerLegend");
    expect(expected).toContain("export.triggersNotRead");
    expect(expected).toContain("export.triggersNotChecked");
    expect(expected).toContain("sidebar.search");
    expect(expected).not.toContain("sidebar.title");
    expect(expected).not.toContain("action.connect");
    expect(expected).not.toContain("module.section.definition");
  });

  it("says what the application says, with nothing left blank", () => {
    for (const [key, message] of Object.entries(embedded)) {
      expect(message, `message "${key}"`).toBe(catalog[key as ViewerMessageKey]);
      expect(message.trim(), `message "${key}"`).not.toBe("");
    }
  });
});

describe("isViewerMessageKey", () => {
  it("accepts the prefixes and the shared keys only", () => {
    expect(isViewerMessageKey("viewer.action.fit")).toBe(true);
    expect(isViewerMessageKey("definition.notAvailable")).toBe(true);
    expect(isViewerMessageKey("trigger.event.after")).toBe(true);
    expect(isViewerMessageKey("export.note.partial")).toBe(true);
    expect(isViewerMessageKey("export.dialog.title")).toBe(false);
    expect(isViewerMessageKey("access.chip")).toBe(false);
  });

  it("covers every key the shared object details need", () => {
    // The view-model's translator is a narrowing of the viewer's, so an HTML file can show
    // the same details as the Inspector.
    expectTypeOf<DetailsMessageKey>().toExtend<ViewerMessageKey>();
  });

  it("covers every word of the readable rules", () => {
    // The rules are worded through a narrowing of the viewer's translator too.
    expectTypeOf<RuleMessageKey>().toExtend<ViewerMessageKey>();
    expect(isViewerMessageKey("rule.check.oneOf")).toBe(true);
  });
});
