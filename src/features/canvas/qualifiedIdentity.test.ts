import { describe, expect, it } from "vitest";

import { visibleProjection } from "@/features/export/html/viewerData";
import { renderDiagramSvg } from "@/features/export/svg/renderDiagram";
import {
  displayIdentifier,
  entityKey,
  filterEntityGroups,
  foreignKeyId,
  groupEntities,
  listEntities,
  qualifiedNameLabel,
} from "@/features/schema/entities";
import { describeViewDefinition } from "@/features/schema/moduleDetails";
import { moduleKey } from "@/features/schema/modules";
import { groupObjects, listObjects, searchObjectGroups } from "@/features/schema/objects";
import { describeObjectDetails } from "@/features/schema/objectDetails";
import type { DetailSection, DetailsScope } from "@/features/schema/objectDetails";
import { presentObjectDetails } from "@/features/schema/objectDetailsView";
import type {
  CanvasState,
  Column,
  QualifiedName,
  SchemaSnapshot,
  Table,
  Trigger,
} from "@/shared/contracts";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import { createCatalogTranslator } from "@/shared/i18n/translator";

import {
  ensurePlaced,
  nodeStateFor,
  withCollapsed,
  withHidden,
  withPositions,
} from "./canvasState";
import { describeEntities } from "./geometry";
import { buildEntityNodes, buildRelationEdges, visibleEntityKeys } from "./graph";
import { buildLayoutInput } from "./layouts/layoutGraph";
import { placeRefreshedEntities } from "./refreshPlacement";

const LEFT = { schema: "a.b", name: "Orders" };
const RIGHT = { schema: "a", name: "b.Orders" };
const OTHER_TABLE = { schema: "a.b", name: "Active" };
const VIEW = { schema: "a", name: "b.Active" };
const OLD_DATE = "2026-10-11T08:00:00Z";
const RECENT_DATE = "2026-10-17T08:00:00Z";

function column(name: string, text: string): Column {
  return {
    name,
    ordinalPosition: 1,
    dataType: {
      name: "int",
      length: null,
      precision: null,
      scale: null,
      userDefinedTypeName: null,
    },
    isNullable: false,
    defaultExpression: { status: "readable", text },
    isIdentity: false,
    isComputed: false,
  };
}

function table(name: QualifiedName, columnName: string, defaultText: string): Table {
  return {
    name,
    columns: [column(columnName, defaultText)],
    primaryKey: { name: "PK", columns: [columnName], isClustered: true },
    indexes: [],
    checkConstraints: [],
  };
}

function trigger(parent: QualifiedName, name: string, isEnabled: boolean): Trigger {
  return {
    parent,
    name,
    timing: "after",
    events: [{ event: "insert", order: "unspecified" }],
    isEnabled,
    isNotForReplication: false,
    body: { language: "sql", definition: { status: "readable", text: "PRIVATE_TRIGGER_CODE" } },
  };
}

function snapshot(): SchemaSnapshot {
  return {
    databaseName: "QualifiedIdentifiers",
    serverVersion: null,
    extractedAt: "2026-10-19T08:00:00Z",
    tables: [
      table(LEFT, "LeftId", "(11)"),
      table(RIGHT, "RightId", "(22)"),
      table(OTHER_TABLE, "TableId", "(33)"),
    ],
    views: [{ name: VIEW, columns: [column("ViewId", "(44)")] }],
    foreignKeys: [
      {
        name: "FK.dotted%name",
        referencingTable: LEFT,
        referencedTable: RIGHT,
        columnPairs: [{ referencingColumn: "LeftId", referencedColumn: "RightId" }],
        onDelete: "noAction",
        onUpdate: "noAction",
        isEnabled: true,
      },
    ],
    programmability: {
      capture: { objects: { status: "read" }, definitions: { status: "read" } },
      routines: [],
      triggers: [trigger(LEFT, "LeftAudit", true), trigger(RIGHT, "RightAudit", false)],
      views: [
        {
          view: VIEW,
          definition: { status: "readable", text: "PRIVATE_VIEW_CODE" },
          hasCheckOption: true,
          isIndexed: false,
        },
      ],
    },
    carriedOver: [
      { object: LEFT, fact: { kind: "columnDefault", column: "LeftId" }, readAt: OLD_DATE },
      { object: RIGHT, fact: { kind: "columnDefault", column: "RightId" }, readAt: RECENT_DATE },
    ],
  };
}

function canvas(data = snapshot()): CanvasState {
  return {
    detailLevel: "full",
    layout: "manual",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [...data.tables, ...data.views].map((entity, index) => ({
      name: entity.name,
      position: { x: index * 300, y: 10 + index * 20 },
      isHidden: false,
      isCollapsed: false,
    })),
  };
}

function details(data: SchemaSnapshot, name: QualifiedName, overrides: Partial<DetailsScope> = {}) {
  const result = describeObjectDetails(data, entityKey(name), {
    hiddenKeys: new Set(),
    coverage: null,
    carriedOver: data.carriedOver ?? [],
    isSchemaFiltered: false,
    isDiagramOnly: false,
    definitions: "included",
    ...overrides,
  });
  if (result === null) throw new Error("Fixture entity missing");
  return result;
}

function section<Kind extends DetailSection["kind"]>(
  data: SchemaSnapshot,
  name: QualifiedName,
  kind: Kind,
) {
  const found = details(data, name).sections.find(
    (item): item is Extract<DetailSection, { kind: Kind }> => item.kind === kind,
  );
  if (found === undefined) throw new Error("Fixture section missing");
  return found;
}

describe("qualified object identity", () => {
  it("separates identifier boundaries, literal escape text, brackets and Unicode", () => {
    const names = [
      LEFT,
      RIGHT,
      { schema: "a%2Eb", name: "Orders" },
      { schema: "a", name: "b%2EOrders" },
      { schema: "[a.b]", name: "Orders" },
      { schema: "a.b", name: "[Orders]" },
      { schema: "中文.á", name: "名%]" },
      { schema: "中文", name: "á.名%]" },
    ];
    expect(new Set(names.map(entityKey)).size).toBe(names.length);
    expect(entityKey({ schema: "dbo", name: "Orders" })).toBe("dbo.Orders");
    const entity = { schema: '["routine","dbo","x', name: '"]' };
    expect(entityKey(entity)).not.toBe(
      moduleKey({ kind: "routine", name: { schema: "dbo", name: "x." } }),
    );
    const keys = [
      { referencingTable: LEFT, name: "FK.name" },
      { referencingTable: RIGHT, name: "FK.name" },
      { referencingTable: LEFT, name: "FK%2Ename" },
      { referencingTable: { schema: "a.b", name: "Orders.FK" }, name: "name" },
    ];
    expect(new Set(keys.map(foreignKeyId)).size).toBe(keys.length);
  });

  it("shows names with unambiguous component boundaries and searches their readable spelling", () => {
    expect(qualifiedNameLabel(LEFT)).toBe("[a.b].Orders");
    expect(qualifiedNameLabel(RIGHT)).toBe("a.[b.Orders]");
    expect(displayIdentifier("odd]name")).toBe("[odd]]name]");
    expect(displayIdentifier("中文%name")).toBe("中文%name");
    const groups = groupEntities(listEntities(snapshot()));
    const found = filterEntityGroups(groups, "b.Orders").flatMap((group) =>
      group.sections.flatMap((item) => item.entities.map((entity) => entity.key)),
    );
    expect(found).toContain(entityKey(RIGHT));
    const objects = groupObjects(listObjects(snapshot()));
    for (const name of [LEFT, RIGHT]) {
      const query = ` ${qualifiedNameLabel(name).toUpperCase()} `;
      expect(
        filterEntityGroups(groups, query).flatMap((group) =>
          group.sections.flatMap((item) => item.entities.map((entity) => entity.key)),
        ),
      ).toEqual([entityKey(name)]);
      const result = searchObjectGroups(objects, query);
      expect(result.totalMatches).toBe(1);
      expect(
        result.groups.flatMap((group) =>
          group.sections.flatMap((item) => item.objects.map((object) => object.key)),
        ),
      ).toEqual([entityKey(name)]);
    }
    expect(searchObjectGroups(objects, "a.b.Orders").totalMatches).toBe(2);
  });

  it("keeps table and view descriptors, defaults, metadata and retained dates with their owner", () => {
    const data = snapshot();
    const entities = describeEntities(data);
    expect(entities.size).toBe(4);
    expect(entities.get(entityKey(LEFT))?.columns[0]?.name).toBe("LeftId");
    expect(entities.get(entityKey(RIGHT))?.columns[0]?.name).toBe("RightId");
    expect(entities.get(entityKey(OTHER_TABLE))?.kind).toBe("table");
    expect(entities.get(entityKey(VIEW))?.kind).toBe("view");
    expect(entities.get(entityKey(LEFT))?.triggers).toMatchObject({ enabled: 1, disabled: 0 });
    expect(entities.get(entityKey(RIGHT))?.triggers).toMatchObject({ enabled: 0, disabled: 1 });
    expect(section(data, LEFT, "columns").items[0]?.defaultValue).toEqual({
      status: "notChecked",
      text: "(11)",
      readAt: OLD_DATE,
    });
    expect(section(data, RIGHT, "columns").items[0]?.defaultValue).toEqual({
      status: "notChecked",
      text: "(22)",
      readAt: RECENT_DATE,
    });
    expect(section(data, LEFT, "triggers").items.map((item) => item.name)).toEqual(["LeftAudit"]);
    expect(section(data, RIGHT, "triggers").items.map((item) => item.name)).toEqual(["RightAudit"]);
    expect(describeViewDefinition(data, entityKey(VIEW))).toMatchObject({
      text: "PRIVATE_VIEW_CODE",
      viewSettings: { hasCheckOption: true, isIndexed: false },
    });
    expect(describeViewDefinition(data, entityKey(OTHER_TABLE))).toBeNull();
  });

  it("draws a real relationship between the colliding names and keeps its layout endpoints", () => {
    const data = snapshot();
    const state = canvas(data);
    const entities = describeEntities(data);
    const nodes = buildEntityNodes(entities, state.nodes, "full");
    expect(nodes).toHaveLength(4);
    expect(nodes.map((node) => node.position)).toEqual(state.nodes.map((node) => node.position));
    const edges = buildRelationEdges(data, nodes);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: entityKey(LEFT),
      target: entityKey(RIGHT),
      ariaLabel: "FK.dotted%name: [a.b].Orders → a.[b.Orders]",
    });
    const input = buildLayoutInput(
      data,
      entities,
      visibleEntityKeys(entities, state.nodes),
      "full",
      new Set(),
      new Map(),
    );
    expect(input.nodes).toHaveLength(4);
    expect(input.edges).toEqual(edges.map(({ id, source, target }) => ({ id, source, target })));
    const rendered = renderDiagramSvg(
      { snapshot: data, canvas: state },
      { detailLevel: "full", theme: "light", labels: { view: "VIEW", triggers: () => "Triggers" } },
    );
    expect(rendered.entityCount).toBe(4);
    expect(rendered.relationCount).toBe(1);
    expect(rendered.svg).toContain(`data-entity="${entityKey(LEFT)}"`);
    expect(rendered.svg).toContain(`data-entity="${entityKey(RIGHT)}"`);
  });

  it("moves, collapses and hides just the requested object without changing its sibling", () => {
    const data = snapshot();
    const original = canvas(data);
    const moved = withPositions(original, new Map([[entityKey(LEFT), { x: 77, y: 88 }]]));
    expect(nodeStateFor(moved, entityKey(LEFT))?.position).toEqual({ x: 77, y: 88 });
    expect(nodeStateFor(moved, entityKey(RIGHT))).toEqual(nodeStateFor(original, entityKey(RIGHT)));
    const collapsed = withCollapsed(moved, [entityKey(LEFT)], true);
    expect(nodeStateFor(collapsed, entityKey(LEFT))?.isCollapsed).toBe(true);
    expect(nodeStateFor(collapsed, entityKey(RIGHT))?.isCollapsed).toBe(false);
    const hidden = withHidden(collapsed, [entityKey(LEFT)], true);
    expect([...visibleEntityKeys(describeEntities(data), hidden.nodes)]).toEqual([
      entityKey(RIGHT),
      entityKey(OTHER_TABLE),
      entityKey(VIEW),
    ]);
    expect(withHidden(hidden, [entityKey(LEFT)], false)).toEqual(collapsed);
    expect(original).toEqual(canvas(data));
  });

  it("restores old structured canvas state and places only the missing sibling after refresh", () => {
    const data = snapshot();
    const original = canvas(data);
    expect(ensurePlaced(original, data)).toBe(original);
    const partial = {
      ...original,
      nodes: original.nodes.filter((node) => entityKey(node.name) !== entityKey(RIGHT)),
    };
    const placed = placeRefreshedEntities(partial, data);
    expect(placed.placed).toEqual([entityKey(RIGHT)]);
    expect(placed.canvas.nodes).toHaveLength(4);
    for (const previous of partial.nodes)
      expect(nodeStateFor(placed.canvas, entityKey(previous.name))).toEqual(previous);
  });

  it("gives relationship links distinct readable labels and correct hidden state", () => {
    const data = snapshot();
    const facts = details(data, LEFT, { hiddenKeys: new Set([entityKey(RIGHT)]) });
    const translator = createCatalogTranslator(messageCatalogs.en, "en");
    const view = presentObjectDetails(facts, translator);
    const references = view.sections.find((item) => item.kind === "references");
    expect(references?.items[0]?.target).toMatchObject({
      state: "hidden",
      label: "a.[b.Orders]",
      key: null,
    });
  });

  it("exports only the visible parent's facts, triggers, view metadata and retained history", () => {
    const data = snapshot();
    const hidden = withHidden(canvas(data), [entityKey(LEFT), entityKey(OTHER_TABLE)], true);
    const projection = visibleProjection(data, hidden);
    expect(projection.snapshot.tables.map((item) => item.name)).toEqual([RIGHT]);
    expect(projection.snapshot.views.map((item) => item.name)).toEqual([VIEW]);
    expect(projection.snapshot.foreignKeys).toEqual([]);
    expect(projection.snapshot.programmability?.triggers.map((item) => item.name)).toEqual([
      "RightAudit",
    ]);
    expect(projection.snapshot.programmability?.views.map((item) => item.view)).toEqual([VIEW]);
    expect(projection.carriedOver).toEqual([data.carriedOver?.[1]]);
    expect(projection.canvas.nodes.map((item) => item.name)).toEqual([RIGHT, VIEW]);
    expect(JSON.stringify(projection)).not.toContain("PRIVATE_");
    const reverse = visibleProjection(
      data,
      withHidden(canvas(data), [entityKey(RIGHT), entityKey(VIEW)], true),
    );
    expect(reverse.snapshot.tables.map((item) => item.name)).toEqual([LEFT, OTHER_TABLE]);
    expect(reverse.snapshot.views).toEqual([]);
    expect(reverse.snapshot.programmability?.views).toEqual([]);
    expect(reverse.snapshot.programmability?.triggers.map((item) => item.name)).toEqual([
      "LeftAudit",
    ]);
    expect(reverse.carriedOver).toEqual([data.carriedOver?.[0]]);
  });

  it("retains one parent's metadata without marking its dotted sibling as stale", () => {
    const data = snapshot();
    data.carriedOver = [{ object: LEFT, fact: { kind: "table" }, readAt: OLD_DATE }];
    const projection = visibleProjection(data, canvas(data));
    expect(describeEntities(data).get(entityKey(LEFT))?.triggers).toBeNull();
    expect(describeEntities(data).get(entityKey(RIGHT))?.triggers).toMatchObject({ count: 1 });
    expect(section(data, LEFT, "triggers").completeness).toEqual({
      status: "notChecked",
      readAt: OLD_DATE,
    });
    expect(section(data, RIGHT, "triggers").completeness).toEqual({ status: "complete" });
    expect(projection.snapshot.programmability?.triggers.map((item) => item.name)).toEqual([
      "RightAudit",
    ]);
  });
});
