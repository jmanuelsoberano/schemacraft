import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import type { SchemaSnapshot } from "@/shared/contracts";
import type { RoutineListItem } from "@/features/schema/objects";
import { listObjects } from "@/features/schema/objects";

const state = vi.hoisted((): { snapshot: SchemaSnapshot | null; locale: "en" | "es" } => ({
  snapshot: null,
  locale: "en",
}));
const selectModule = vi.hoisted(() => vi.fn());
vi.mock("@/features/project/projectStore", () => ({
  useProjectStore: (select: (value: object) => unknown) =>
    select({
      project:
        state.snapshot === null
          ? null
          : {
              content: {
                snapshot: state.snapshot,
                inspection: {
                  schemas: [],
                  includeViews: true,
                  includeProgrammability: true,
                  includeModuleDefinitions: true,
                },
                canvas: { nodes: [] },
              },
            },
    }),
}));
vi.mock("./canvasUiStore", () => ({
  useCanvasUiStore: (select: (value: object) => unknown) =>
    select({ selectedKeys: [], selectedModule: null, selectModule }),
}));
vi.mock("./canvasActions", () => ({ setHidden: vi.fn() }));
vi.mock("./entitiesSearch", () => ({ ENTITIES_SEARCH_INPUT_ID: "entities-search-input" }));
vi.mock("@/shared/i18n/useI18n", async () => {
  const { createCatalogTranslator } = await import("@/shared/i18n/translator");
  const { messageCatalogs } = await import("@/shared/i18n/messages/catalogs");
  return { useI18n: () => createCatalogTranslator(messageCatalogs[state.locale], state.locale) };
});

const { EntitiesSidebar, RoutineRow } = await import("./EntitiesSidebar");

function codeOnly(): SchemaSnapshot {
  return {
    databaseName: "Shop",
    serverVersion: null,
    extractedAt: "2026-10-19T12:00:00Z",
    tables: [],
    views: [],
    foreignKeys: [],
    programmability: {
      capture: { objects: { status: "read" }, definitions: { status: "read" } },
      views: [],
      triggers: [],
      routines: [
        {
          name: { schema: "sales", name: "VisibleRows" },
          kind: "inlineTableFunction",
          parameters: [],
          returns: null,
          columns: [],
          body: { language: "sql", definition: { status: "encrypted" } },
        },
      ],
    },
  };
}

beforeEach(() => {
  state.snapshot = codeOnly();
  state.locale = "en";
  selectModule.mockClear();
});

describe("Objects panel", () => {
  it("shows a collapsed routine section in a code-only project and a truthful partial-coverage footer", () => {
    const markup = renderToString(createElement(EntitiesSidebar));
    expect(markup).toContain("Objects");
    expect(markup).toContain("Functions");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("Other procedures and functions may exist");
    expect(markup).not.toContain("No objects recorded");
    expect(markup).not.toContain("No tables or views visible");
    expect(markup).not.toContain("VisibleRows");
  });

  it("states why routines were not captured without claiming a permissions problem", () => {
    assert(state.snapshot?.programmability);
    state.snapshot.programmability.capture.objects = { status: "notRead", reason: "optionOff" };
    state.snapshot.programmability.routines = [];
    let markup = renderToString(createElement(EntitiesSidebar));
    expect(markup).toContain("the connection options left them out");
    expect(markup).not.toContain("this login can&#x27;t see");
    state.snapshot.programmability.capture.objects = { status: "notRead", reason: "queryFailed" };
    markup = renderToString(createElement(EntitiesSidebar));
    expect(markup).toContain("because the read failed");
    expect(markup).not.toContain("this login can&#x27;t see");
    delete state.snapshot.programmability;
    markup = renderToString(createElement(EntitiesSidebar));
    expect(markup).toContain("were not recorded in this project");
  });

  it("uses the real Spanish catalogue for the renamed panel and its coverage notice", () => {
    state.locale = "es";
    const markup = renderToString(createElement(EntitiesSidebar));
    expect(markup).toContain("Objetos");
    expect(markup).toContain("Funciones");
    expect(markup).toContain("Puede haber otros procedimientos y funciones");
  });

  it("keeps routine rows outside the canvas visibility and context-menu gestures", () => {
    assert(state.snapshot);
    const routine = listObjects(state.snapshot)[0] as RoutineListItem;
    const markup = renderToString(
      createElement(RoutineRow, { routine, isSelected: false, index: 0 }),
    );
    expect(markup).toContain("0 parameters");
    expect(markup).toContain("Encrypted");
    expect(markup).toContain("data-module-key");
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).not.toContain("Hide ");

    let row: ReactNode;
    function Probe() {
      row = RoutineRow({ routine, isSelected: false, index: 0 });
      return null;
    }
    renderToString(createElement(Probe));
    assert(
      isValidElement<{
        children: ReactElement<{ onClick: (event: { detail: number }) => void }>;
        onContextMenu?: unknown;
      }>(row),
    );
    expect(row.props.onContextMenu).toBeUndefined();
    const click = row.props.children.props.onClick;
    click({ detail: 1 });
    expect(selectModule).toHaveBeenLastCalledWith(routine.ref, { focus: false });
    click({ detail: 0 });
    expect(selectModule).toHaveBeenLastCalledWith(routine.ref, { focus: true });
    expect(
      renderToString(
        createElement(RoutineRow, {
          routine: { ...routine, isEncrypted: false, implementation: "clr" },
          isSelected: false,
          index: 0,
        }),
      ),
    ).toContain("CLR");
  });
});
