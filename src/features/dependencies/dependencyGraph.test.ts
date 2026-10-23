import { describe, expect, it } from "vitest";
import type { DependencyObjectRef, DependencySnapshot } from "@/shared/contracts";
import { createCatalogTranslator } from "@/shared/i18n/translator";
import { messageCatalogs } from "@/shared/i18n/messages/catalogs";
import {
  presentRoutineDependencyTracking,
  ROUTINE_TRACKING_STATES,
} from "@/features/schema/routineDependencyTracking";

import {
  buildDependencyHtml,
  dependencyGraphExtent,
  renderDependencySvg,
} from "./dependencyExport";
import type { DependencyExportLabels } from "./dependencyExport";
import {
  dependencyObjectKey,
  exploreDependencies,
  projectDependencyGraph,
} from "./dependencyGraph";

const readAt = "2026-10-23T12:00:00Z";
const table = (schema: string, name: string): DependencyObjectRef => ({
  kind: "table",
  name: { schema, name },
});
const a = table("odd.schema", "Orders");
const b = table("odd", "schema.Orders");
const c = table("sales", "Customers");
const hidden = table("sales", "ExcludedSentinel");
const objects = [a, b, c, hidden];
const key = dependencyObjectKey;

function family(): DependencySnapshot {
  return {
    capture: { status: "read" },
    scope: {
      schemas: [],
      includeViews: true,
      includeProgrammability: true,
      includeModuleDefinitions: false,
    },
    observedAt: readAt,
    sources: objects.map((object) => ({ object, coverage: "complete", readAt, retained: false })),
    limitations: ["runtimeReferencesNotTracked"],
    edges: [
      ...[
        [a, b],
        [b, c],
        [c, a],
      ].map(([source, target]) => {
        if (source === undefined || target === undefined) throw new Error("invalid fixture");
        return {
          source,
          target: { kind: "object" as const, object: target },
          kind: "catalogReference" as const,
          isSchemaBound: false,
          readAt,
          retained: false,
        };
      }),
      {
        source: c,
        target: {
          kind: "reference",
          status: "external",
          server: "ServerSentinel",
          database: "DatabaseSentinel",
          schema: "remote",
          name: "Customers",
          objectClass: "OBJECT_OR_COLUMN",
        },
        kind: "catalogReference",
        isSchemaBound: false,
        readAt,
        retained: true,
      },
    ],
  };
}

function labels(locale: "en" | "es" = "en"): DependencyExportLabels {
  const translator = createCatalogTranslator(messageCatalogs[locale], locale);
  const { t } = translator;
  return {
    title: t("dependencies.title"),
    limitation: t("dependencies.description"),
    direction: t("dependencies.arrow"),
    capture: t("dependencies.capture"),
    retained: t("dependencies.retained"),
    search: t("dependencies.search"),
    fit: t("dependencies.fit"),
    zoomIn: t("dependencies.zoomIn"),
    zoomOut: t("dependencies.zoomOut"),
    kinds: {},
    statuses: {},
    limitations: {},
    reasons: {},
    edgeKinds: {},
    routineTrackingTitle: t("module.native.tracking.title"),
    routineTracking: Object.fromEntries(
      ROUTINE_TRACKING_STATES.map((state) => [
        state,
        presentRoutineDependencyTracking(state, translator).label,
      ]),
    ),
    routineTrackingHints: Object.fromEntries(
      ROUTINE_TRACKING_STATES.map((state) => [
        state,
        presentRoutineDependencyTracking(state, translator).explanation,
      ]),
    ),
  };
}

describe("known dependency graph", () => {
  it("preserves per-routine PostgreSQL tracking evidence without calling the runtime graph complete", () => {
    const parsed: DependencyObjectRef = {
      kind: "routine",
      name: { schema: "sales", name: "total" },
      identityArguments: [{ schema: "pg_catalog", name: "int4" }],
    };
    const textBody: DependencyObjectRef = {
      kind: "routine",
      name: parsed.name,
      identityArguments: [{ schema: "pg_catalog", name: "uuid" }],
    };
    const legacy: DependencyObjectRef = {
      kind: "routine",
      name: { schema: "sales", name: "legacy" },
      identityArguments: [],
    };
    const evidence = family();
    evidence.edges = [];
    evidence.sources = [
      {
        object: parsed,
        coverage: "complete",
        readAt,
        retained: false,
        routineBodyTracking: "parsedSqlBody",
      },
      {
        object: textBody,
        coverage: "complete",
        readAt,
        retained: false,
        routineBodyTracking: "signatureOnly",
      },
      { object: legacy, coverage: "complete", readAt, retained: false },
    ];
    const graph = projectDependencyGraph(evidence, [parsed, textBody, legacy, a], "postgreSql");
    expect(graph.nodes.map((node) => node.routineBodyTracking)).toEqual([
      "parsedSqlBody",
      "signatureOnly",
      "notRecorded",
      undefined,
    ]);
    expect(graph.nodes.slice(0, 3).map((node) => node.status)).toEqual([
      "complete",
      "complete",
      "complete",
    ]);
    for (const locale of ["en", "es"] as const) {
      const words = labels(locale);
      const svg = renderDependencySvg(graph, new Map(), words, "light");
      const html = buildDependencyHtml(graph, svg, words, locale);
      for (const output of [svg, html]) {
        expect(output).toContain(words.routineTracking.parsedSqlBody);
        expect(output).toContain(words.routineTracking.signatureOnly);
        expect(output).toContain(words.routineTracking.notRecorded);
        expect(output).toContain(words.routineTrackingHints.signatureOnly);
        expect(output).toContain(words.routineTrackingHints.parsedSqlBody);
      }
      expect(html).not.toContain("prosqlbody");
    }
    const sqlGraph = projectDependencyGraph(
      undefined,
      [{ kind: "routine", name: parsed.name }],
      "sqlServer",
    );
    expect(sqlGraph.nodes[0]).not.toHaveProperty("routineBodyTracking");
  });

  it("keeps dotted identities distinct and follows direct, reverse and cycle-safe transitive paths", () => {
    const graph = projectDependencyGraph(family(), objects);
    expect(key(a)).not.toBe(key(b));
    expect(exploreDependencies(graph, key(a), "outgoing", 1).nodes.map((node) => node.id)).toEqual([
      key(a),
      key(b),
    ]);
    expect(exploreDependencies(graph, key(a), "incoming", 1).nodes.map((node) => node.id)).toEqual([
      key(a),
      key(c),
    ]);
    expect(exploreDependencies(graph, key(a), "outgoing", 0).nodes).toHaveLength(4);
    expect(
      exploreDependencies(graph, key(a), "outgoing", 0).nodes.some(
        (node) => node.id === key(hidden),
      ),
    ).toBe(false);
  });

  it("projects hidden objects and dangling edges out of the complete exported bytes", () => {
    const graph = exploreDependencies(
      projectDependencyGraph(family(), objects),
      key(a),
      "both",
      0,
      new Set([key(b)]),
    );
    expect(graph.edges.every((edge) => edge.source !== key(b) && edge.target !== key(b))).toBe(
      true,
    );
    const svg = renderDependencySvg(
      graph,
      new Map(graph.nodes.map((node, i) => [node.id, { x: i * 400, y: 100 }])),
      labels(),
      "light",
    );
    const html = buildDependencyHtml(graph, svg, labels(), "en");
    for (const output of [svg, html]) {
      expect(output).not.toContain("ServerSentinel");
      expect(output).not.toContain("DatabaseSentinel");
      expect(output).not.toContain("ExcludedSentinel");
      expect(output).not.toContain(key(b));
    }
    expect(html).toContain("remote.Customers");
    expect(html).toContain("application/json");
  });

  it("escapes hostile identifiers as text and does not serialize unknown endpoint extensions", () => {
    const hostile = Object.assign(table("sales", "</script><img src=x onerror=alert(1)>"), {
      privateSentinel: "UnknownSentinel",
    });
    const graph = projectDependencyGraph(undefined, [hostile]);
    const svg = renderDependencySvg(graph, new Map(), labels(), "dark");
    const html = buildDependencyHtml(graph, svg, labels(), "es");
    expect(svg).toContain("&lt;/script&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("UnknownSentinel");
    expect(graph.capture).toBe("notRecorded");
    expect(graph.nodes[0]?.status).toBe("notRecorded");
  });

  it("discloses bounded display omissions and exports only included endpoints", () => {
    const graph = exploreDependencies(
      projectDependencyGraph(family(), objects),
      key(a),
      "outgoing",
      0,
      new Set(),
      2,
    );
    expect(graph.nodes).toHaveLength(2);
    // Only c was encountered beyond the scheduling budget; its unresolved child was not
    // explored. Reporting two as an exact reachable count would require unbounded traversal.
    expect(graph.omitted).toBe(1);
    expect(graph.discoveryIncomplete).toBe(true);
    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(graph.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
  });

  it("caps scheduled exploration on long chains without claiming an exact descendant count", () => {
    const chain = Array.from({ length: 2_000 }, (_, index) =>
      table("scale", `Node${String(index)}`),
    );
    const first = chain[0];
    if (first === undefined) throw new Error("empty chain");
    const value = family();
    value.sources = chain.map((object) => ({
      object,
      coverage: "complete",
      readAt,
      retained: false,
    }));
    value.edges = chain.slice(1).map((target, index) => {
      const source = chain[index];
      if (source === undefined) throw new Error("missing source");
      return {
        source,
        target: { kind: "object", object: target },
        kind: "catalogReference",
        isSchemaBound: false,
        readAt,
        retained: false,
      };
    });
    const graph = exploreDependencies(
      projectDependencyGraph(value, chain),
      key(first),
      "outgoing",
      0,
    );
    expect(graph.nodes).toHaveLength(500);
    expect(graph.omitted).toBe(1);
    expect(graph.discoveryIncomplete).toBe(true);
    expect(graph.nodes.some((node) => node.label.endsWith("Node500"))).toBe(false);
    expect(graph.edges).toHaveLength(499);
  });

  it("bounds high-degree frontiers and duplicate/cyclic paths while retaining hidden-data privacy", () => {
    const center = table("scale", "Center");
    const leaves = Array.from({ length: 3_000 }, (_, index) =>
      table("scale", `Leaf${String(index)}`),
    );
    const value = family();
    value.sources = [center, ...leaves].map((object) => ({
      object,
      coverage: "complete",
      readAt,
      retained: false,
    }));
    value.edges = leaves.flatMap((leaf) => [
      {
        source: center,
        target: { kind: "object" as const, object: leaf },
        kind: "catalogReference" as const,
        isSchemaBound: false,
        readAt,
        retained: false,
      },
      {
        source: leaf,
        target: { kind: "object" as const, object: center },
        kind: "catalogReference" as const,
        isSchemaBound: false,
        readAt,
        retained: false,
      },
    ]);
    const firstLeaf = leaves[0];
    if (firstLeaf === undefined) throw new Error("empty star");
    const graph = exploreDependencies(
      projectDependencyGraph(value, [center, ...leaves]),
      key(center),
      "both",
      0,
      new Set([key(firstLeaf)]),
    );
    expect(graph.nodes).toHaveLength(499);
    expect(graph.omitted).toBe(500);
    expect(graph.discoveryIncomplete).toBe(true);
    expect(graph.nodes.every((node) => node.id !== key(firstLeaf))).toBe(true);
    expect(
      graph.edges.every((edge) => edge.source !== key(firstLeaf) && edge.target !== key(firstLeaf)),
    ).toBe(true);
  });

  it("preserves closed failed/excluded capture reasons without adding raw driver text", () => {
    for (const reason of [
      "permissionDenied",
      "queryFailed",
      "timedOut",
      "optionOff",
      "unknown",
    ] as const) {
      const value = family();
      value.capture = { status: "notRead", reason };
      Object.assign(value.capture, { message: "RAW_DRIVER_SENTINEL" });
      const graph = projectDependencyGraph(value, objects);
      expect(graph.captureReason).toBe(reason);
      const output = buildDependencyHtml(
        graph,
        renderDependencySvg(graph, new Map(), labels(), "light"),
        labels(),
        "en",
      );
      expect(output).not.toContain("RAW_DRIVER_SENTINEL");
    }
  });

  it("grows export bounds for long translated coverage captions without dropping text", () => {
    const graph = projectDependencyGraph(undefined, [a]);
    const short = dependencyGraphExtent(graph, new Map(), labels());
    const longLabels = labels();
    longLabels.limitation = "Información sobre cobertura y límites de observación. ".repeat(16);
    const extent = dependencyGraphExtent(graph, new Map(), longLabels);
    expect(extent.height).toBeGreaterThan(short.height);
    expect(extent.footer.join("")).toContain(longLabels.limitation);
    const svg = renderDependencySvg(graph, new Map(), longLabels, "light");
    expect(svg).toContain(`height="${String(extent.height)}"`);
    expect(svg).toContain(
      `viewBox="${String(extent.minX)} ${String(extent.minY)} ${String(extent.width)} ${String(extent.height)}"`,
    );
  });

  it("keeps complete reverse curves, self-loops and arrow markers inside the exported bounds", () => {
    const scenarios = [
      {
        name: "reverse",
        positions: [
          [key(a), { x: 1_600, y: 90 }],
          [key(b), { x: -700, y: -450 }],
        ] as const,
        links: [[a, b]],
      },
      { name: "self-loop", positions: [[key(a), { x: 2_200, y: -180 }]] as const, links: [[a, a]] },
      {
        name: "negative coordinates",
        positions: [
          [key(a), { x: -420, y: -380 }],
          [key(b), { x: -1_300, y: -900 }],
        ] as const,
        links: [
          [a, a],
          [a, b],
          [b, a],
        ],
      },
    ];
    for (const scenario of scenarios) {
      const evidence = family();
      evidence.edges = scenario.links.map(([source, target]) => {
        if (source === undefined || target === undefined) throw new Error("edge fixture required");
        return {
          source,
          target: { kind: "object" as const, object: target },
          kind: "catalogReference",
          isSchemaBound: false,
          readAt,
          retained: false,
        };
      });
      const graph = projectDependencyGraph(evidence, [a, b]);
      const positions = new Map<string, { x: number; y: number }>(scenario.positions);
      const extent = dependencyGraphExtent(graph, positions, labels());
      const svg = renderDependencySvg(graph, positions, labels(), "dark");
      const paths = [...svg.matchAll(/<path d="(M[^"]+ C[^"]+)"/gu)];
      expect(paths.length, scenario.name).toBe(scenario.links.length);
      const inside = (x: number, y: number) => {
        expect(x, scenario.name).toBeGreaterThanOrEqual(extent.minX);
        expect(x, scenario.name).toBeLessThanOrEqual(extent.minX + extent.width);
        expect(y, scenario.name).toBeGreaterThanOrEqual(extent.minY);
        expect(y, scenario.name).toBeLessThanOrEqual(extent.maxY);
      };
      for (const path of paths) {
        const coordinates = path[1]?.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gu)?.map(Number);
        if (coordinates?.length !== 8) throw new Error("cubic path expected");
        const points = [0, 2, 4, 6].map((index) => ({
          x: coordinates[index] ?? NaN,
          y: coordinates[index + 1] ?? NaN,
        }));
        const [start, first, second, end] = points;
        if (!start || !first || !second || !end) throw new Error("cubic controls expected");
        // Evaluate the actual serialized curve independently of the implementation helper.
        for (let sample = 0; sample <= 100; sample += 1) {
          const t = sample / 100;
          const u = 1 - t;
          inside(
            u ** 3 * start.x +
              3 * u ** 2 * t * first.x +
              3 * u * t ** 2 * second.x +
              t ** 3 * end.x,
            u ** 3 * start.y +
              3 * u ** 2 * t * first.y +
              3 * u * t ** 2 * second.y +
              t ** 3 * end.y,
          );
        }
        for (const point of points) inside(point.x, point.y);
        const angle = Math.atan2(end.y - second.y, end.x - second.x);
        for (const [x, y] of [
          [-9, -3],
          [-9, 3],
          [0, 0],
        ]) {
          if (x === undefined || y === undefined) throw new Error("marker vertex expected");
          inside(
            end.x + (x * Math.cos(angle) - y * Math.sin(angle)) * 1.5,
            end.y + (x * Math.sin(angle) + y * Math.cos(angle)) * 1.5,
          );
        }
      }
      const unrelated = new Map(positions);
      unrelated.set(key(hidden), { x: 1_000_000, y: -1_000_000 });
      expect(dependencyGraphExtent(graph, unrelated, labels())).toEqual(extent);
      expect(svg).not.toContain("ExcludedSentinel");
      expect(svg).toContain(
        `viewBox="${String(extent.minX)} ${String(extent.minY)} ${String(extent.width)} ${String(extent.height)}"`,
      );
    }
  });
});
