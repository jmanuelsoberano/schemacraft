import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createElkInWorker } from "@/features/canvas/layouts/elkWorker";
import { runLayout } from "@/features/canvas/layouts";
import { useProjectStore } from "@/features/project/projectStore";
import { MAX_RASTER_SIDE } from "@/features/export/exportSizing";
import {
  presentRoutineDependencyTracking,
  ROUTINE_TRACKING_STATES,
} from "@/features/schema/routineDependencyTracking";
import type { ExportFormat, Point, SchemaSnapshot } from "@/shared/contracts";
import { useI18n } from "@/shared/i18n/useI18n";
import { getExportBackend } from "@/shared/ipc/exportBackend";
import { toOperationError } from "@/shared/ipc/operationError";
import { describeOperationError } from "@/shared/errors/describeOperationError";
import { useSettingsStore } from "@/shared/settings/settingsStore";
import { DARK_SCHEME_MEDIA_QUERY, resolveTheme } from "@/shared/settings/theme";
import { Alert } from "@/shared/ui/Alert";
import { Button } from "@/shared/ui/Button";
import { Dialog } from "@/shared/ui/Dialog";
import { Select } from "@/shared/ui/Select";
import { TextField } from "@/shared/ui/TextField";
import type { DependencyObjectRef } from "@/shared/contracts/generated/model/DependencyObjectRef";

import {
  buildDependencyHtml,
  dependencyGraphExtent,
  DEPENDENCY_NODE_HEIGHT,
  DEPENDENCY_NODE_WIDTH,
  renderDependencySvg,
} from "./dependencyExport";
import type { DependencyExportLabels } from "./dependencyExport";
import {
  dependencyObjectKey,
  dependencyObjectLabel,
  dependencyObjects,
  exploreDependencies,
  projectDependencyGraph,
} from "./dependencyGraph";
import type { DependencyDirection, DependencyGraph } from "./dependencyGraph";
import { useDependencyStore } from "./dependencyStore";
import styles from "./DependencyDialog.module.css";

type GraphNode = Node<{ label: React.ReactNode }>;
const FORMATS: ExportFormat[] = ["svg", "png", "pdf", "html"];
const KINDS = ["table", "view", "routine", "trigger", "reference"];
const STATUSES = [
  "complete",
  "partial",
  "notAvailable",
  "notRecorded",
  "read",
  "notRead",
  "unknown",
  "external",
  "outOfScope",
  "notVisible",
  "unsupported",
  "unresolved",
  "ambiguous",
  "callerDependent",
];
const LIMITATIONS = [
  "runtimeReferencesNotTracked",
  "permissionLimited",
  "unsupportedTargets",
  "unresolvedTargets",
  "routineBodiesNotFullyTracked",
  "unknown",
];
const REASONS = ["optionOff", "queryFailed", "timedOut", "permissionDenied", "unknown"];
const EDGE_KINDS = ["catalogReference", "triggerFunction", "unknown"];

/** Independent read-only graph; closing it restores the ordinary diagram without edits. */
export function DependencyDialog() {
  const { t } = useI18n();
  const project = useProjectStore((state) => state.project);
  const isOpen = useDependencyStore((state) => state.isOpen);
  const requested = useDependencyStore((state) => state.root);
  const close = useDependencyStore((state) => state.close);
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t("dependencies.title")}
      description={t("dependencies.description")}
      closeLabel={t("dependencies.close")}
      width={1180}
    >
      {isOpen && project !== null ? (
        <DependencyExplorer
          key={project.loadToken}
          snapshot={project.content.snapshot}
          requested={requested}
        />
      ) : null}
    </Dialog>
  );
}

function DependencyExplorer({
  snapshot,
  requested,
}: {
  snapshot: SchemaSnapshot;
  requested: DependencyObjectRef | null;
}) {
  const translator = useI18n();
  const { t, locale } = translator;
  const objects = useMemo(() => dependencyObjects(snapshot), [snapshot]);
  const graph = useMemo(
    () => projectDependencyGraph(snapshot.dependencies, objects, snapshot.provider),
    [snapshot, objects],
  );
  const initial =
    requested === null
      ? (graph.edges[0]?.source ?? graph.nodes[0]?.id ?? "")
      : dependencyObjectKey(requested);
  const [root, setRoot] = useState(initial);
  const [direction, setDirection] = useState<DependencyDirection>("outgoing");
  const [depth, setDepth] = useState("1");
  const [search, setSearch] = useState("");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [format, setFormat] = useState<ExportFormat>("svg");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>([]);
  const [arranged, setArranged] = useState<{
    graph: DependencyGraph;
    labels: DependencyExportLabels;
  } | null>(null);
  const operation = useRef(0);
  const selectionChanged = useCallback(({ nodes }: { nodes: GraphNode[] }) => {
    setSelected(nodes[0]?.id ?? null);
  }, []);
  const job = useRef<string | null>(null);
  const currentTheme = useSettingsStore((state) => state.themePreference);
  const theme = resolveTheme(currentTheme, window.matchMedia(DARK_SCHEME_MEDIA_QUERY).matches);
  const visible = useMemo(
    () => exploreDependencies(graph, root, direction, Number(depth), hidden),
    [graph, root, direction, depth, hidden],
  );
  const labels: DependencyExportLabels = useMemo(
    () => ({
      title: t("dependencies.title"),
      limitation: t("dependencies.description"),
      direction: t("dependencies.arrow"),
      capture: t("dependencies.capture"),
      retained: t("dependencies.retained"),
      search: t("dependencies.search"),
      fit: t("dependencies.fit"),
      zoomIn: t("dependencies.zoomIn"),
      zoomOut: t("dependencies.zoomOut"),
      kinds: Object.fromEntries(
        KINDS.map((kind) => [kind, t(`dependencies.kind.${kind}` as "dependencies.kind.table")]),
      ),
      statuses: Object.fromEntries(
        STATUSES.map((status) => [
          status,
          t(`dependencies.status.${status}` as "dependencies.status.complete"),
        ]),
      ),
      limitations: Object.fromEntries(
        LIMITATIONS.map((limit) => [
          limit,
          t(`dependencies.limit.${limit}` as "dependencies.limit.unknown"),
        ]),
      ),
      reasons: Object.fromEntries(
        REASONS.map((reason) => [
          reason,
          t(`dependencies.reason.${reason}` as "dependencies.reason.unknown"),
        ]),
      ),
      edgeKinds: Object.fromEntries(
        EDGE_KINDS.map((kind) => [
          kind,
          t(`dependencies.edge.${kind}` as "dependencies.edge.unknown"),
        ]),
      ),
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
      ...(visible.omitted > 0
        ? { omitted: t("dependencies.limited", { count: visible.omitted }) }
        : visible.discoveryIncomplete
          ? { omitted: t("dependencies.limitedUnknown") }
          : {}),
    }),
    [t, translator, visible.omitted, visible.discoveryIncomplete],
  );

  const exportExtent = dependencyGraphExtent(
    visible,
    new Map(nodes.map((node) => [node.id, node.position])),
    labels,
  );
  const pngScale = Math.max(exportExtent.width, exportExtent.height) * 2 <= MAX_RASTER_SIDE ? 2 : 1;
  const pngTooLarge =
    format === "png" && Math.max(exportExtent.width, exportExtent.height) > MAX_RASTER_SIDE;

  useEffect(() => {
    const elk = createElkInWorker();
    let alive = true;
    const input = {
      nodes: visible.nodes.map((node) => ({
        id: node.id,
        width: DEPENDENCY_NODE_WIDTH,
        height: DEPENDENCY_NODE_HEIGHT,
      })),
      // The shared ERD layout puts referenced parents first by reversing its input edges.
      // Adapt only the layout input so this viewer's reference arrows flow left to right.
      edges: visible.edges
        .filter((edge) => edge.source !== edge.target)
        .map((edge) => ({ ...edge, source: edge.target, target: edge.source })),
      positions: new Map<string, Point>(),
    };
    void runLayout({ kind: "layered", direction: "right" }, input, () => elk)
      .then((positions) => {
        if (!alive) return;
        setNodes(
          visible.nodes.map((node, index) => ({
            id: node.id,
            position: positions.get(node.id) ?? {
              x: 40 + (index % 4) * 360,
              y: 80 + Math.floor(index / 4) * 150,
            },
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
            style: { width: DEPENDENCY_NODE_WIDTH, height: DEPENDENCY_NODE_HEIGHT },
            className: styles.node,
            data: {
              label: (
                <div className={styles.nodeBody}>
                  <span>
                    {labels.kinds[node.kind]} ·{" "}
                    {node.retained
                      ? labels.retained
                      : (labels.statuses[node.status] ?? node.status)}
                  </span>
                  <strong title={node.label}>{node.label}</strong>
                  {node.routineBodyTracking === undefined ? null : (
                    <span>{labels.routineTracking[node.routineBodyTracking]}</span>
                  )}
                </div>
              ),
            },
          })),
        );
        setArranged({ graph: visible, labels });
      })
      .catch(() => {
        if (alive) setMessage(t("dependencies.layoutFailed"));
      });
    return () => {
      alive = false;
      elk.terminateWorker();
    };
  }, [visible, labels, t, setNodes]);

  useEffect(
    () => () => {
      operation.current += 1;
      if (job.current !== null)
        void getExportBackend()
          .then((backend) => backend.cancelExport(job.current ?? ""))
          .catch(() => undefined);
    },
    [],
  );

  const edges: Edge[] = useMemo(
    () =>
      visible.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: edge.retained ? { strokeDasharray: "6 4" } : undefined,
      })),
    [visible],
  );
  const selectedNode = visible.nodes.find((node) => node.id === selected);
  const outgoing =
    selected === null ? [] : visible.edges.filter((edge) => edge.source === selected);
  const incoming =
    selected === null ? [] : visible.edges.filter((edge) => edge.target === selected);
  const matchingObjects = objects.filter((object) =>
    dependencyObjectLabel(object)
      .toLocaleLowerCase(locale)
      .includes(search.toLocaleLowerCase(locale)),
  );
  const selectedObject = objects.find((object) => dependencyObjectKey(object) === root);
  const offeredObjects = matchingObjects.slice(0, 200);
  if (selectedObject !== undefined && !offeredObjects.includes(selectedObject))
    offeredObjects.unshift(selectedObject);
  const options = offeredObjects.map((object) => ({
    value: dependencyObjectKey(object),
    label: `${labels.kinds[object.kind]} · ${dependencyObjectLabel(object)}`,
  }));
  const selectRoot = (value: string) => {
    setRoot(value);
    setHidden(new Set());
    setSelected(null);
  };
  const exportGraph = async () => {
    const revision = ++operation.current;
    const frozen = visible;
    const positions = new Map(nodes.map((node) => [node.id, node.position]));
    setBusy(true);
    setMessage(null);
    try {
      const backend = await getExportBackend();
      const destination = await backend.pickDestination(
        t("dependencies.export"),
        `SchemaCraft-dependencies.${format}`,
        { name: format.toUpperCase(), extension: format },
      );
      if (destination === null || revision !== operation.current) return;
      const svg = renderDependencySvg(frozen, positions, labels, theme);
      const document =
        format === "html" ? buildDependencyHtml(frozen, svg, labels, locale, theme) : svg;
      await backend.exportDiagram({ format, destination, document, scale: pngScale }, (event) => {
        if (event.event === "started") {
          if (revision !== operation.current) {
            void backend.cancelExport(event.data.jobId).catch(() => undefined);
            return;
          }
          job.current = event.data.jobId;
        }
      });
      if (revision === operation.current) setMessage(t("dependencies.exported"));
    } catch (error) {
      if (revision === operation.current)
        setMessage(describeOperationError(toOperationError(error), translator).detail);
    } finally {
      job.current = null;
      if (revision === operation.current) setBusy(false);
    }
  };

  return (
    <div className={styles.explorer}>
      <div className={styles.filters}>
        <TextField
          label={t("dependencies.search")}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <Select
          label={t("dependencies.start")}
          value={root}
          options={options}
          placeholder={t("dependencies.start")}
          onValueChange={selectRoot}
        />
        <Select
          label={t("dependencies.direction")}
          value={direction}
          placeholder={t("dependencies.direction")}
          options={["outgoing", "incoming", "both"].map((value) => ({
            value: value as DependencyDirection,
            label: t(`dependencies.direction.${value}` as "dependencies.direction.both"),
          }))}
          onValueChange={(value) => {
            setDirection(value);
            setHidden(new Set());
          }}
        />
        <Select
          label={t("dependencies.depth")}
          value={depth}
          placeholder={t("dependencies.depth")}
          options={[
            { value: "1", label: t("dependencies.direct") },
            { value: "2", label: "2" },
            { value: "3", label: "3" },
            { value: "0", label: t("dependencies.transitive") },
          ]}
          onValueChange={(value) => {
            setDepth(value);
            setHidden(new Set());
          }}
        />
      </div>
      <p className={styles.notice}>
        {t("dependencies.arrow")} · {t("dependencies.capture")}:{" "}
        {labels.statuses[graph.capture] ?? graph.capture}
      </p>
      {snapshot.dependencies?.capture.status === "notRead" ? (
        <Alert
          variant="warning"
          title={t("dependencies.notRead")}
          detail={t(`dependencies.reason.${snapshot.dependencies.capture.reason}`)}
        />
      ) : null}
      {snapshot.dependencies === undefined ? (
        <Alert variant="warning" title={t("dependencies.unrecorded")} />
      ) : null}
      {graph.limitations.length > 0 ? (
        <details className={styles.notice}>
          <summary>{t("dependencies.coverage")}</summary>
          <ul>
            {graph.limitations.map((limit) => (
              <li key={limit}>{labels.limitations[limit] ?? limit}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {matchingObjects.length > 200 ? (
        <p className={styles.notice}>{t("dependencies.searchMore")}</p>
      ) : null}
      {visible.omitted > 0 ? (
        <Alert variant="warning" title={t("dependencies.limited", { count: visible.omitted })} />
      ) : visible.discoveryIncomplete ? (
        <Alert variant="warning" title={t("dependencies.limitedUnknown")} />
      ) : null}
      <div className={styles.workspace}>
        <div className={styles.graph}>
          <ReactFlow
            key={JSON.stringify([root, direction, depth, [...hidden]])}
            nodes={arranged?.graph === visible && arranged.labels === labels ? nodes : []}
            edges={edges}
            onNodesChange={onNodesChange}
            onSelectionChange={selectionChanged}
            onNodeClick={(_event, node) => {
              setSelected(node.id);
            }}
            nodesConnectable={false}
            deleteKeyCode={null}
            fitView
            minZoom={0.05}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside className={styles.details} aria-label={t("dependencies.details")}>
          {selectedNode === undefined ? (
            <p>{t("dependencies.select")}</p>
          ) : (
            <>
              <h3>{selectedNode.label}</h3>
              <p>
                {labels.kinds[selectedNode.kind]} ·{" "}
                {selectedNode.retained
                  ? labels.retained
                  : (labels.statuses[selectedNode.status] ?? selectedNode.status)}
              </p>
              {selectedNode.routineBodyTracking === undefined ? null : (
                <p>
                  <strong>
                    {labels.routineTrackingTitle}:{" "}
                    {labels.routineTracking[selectedNode.routineBodyTracking]}.
                  </strong>{" "}
                  {labels.routineTrackingHints[selectedNode.routineBodyTracking]}
                </p>
              )}
              {selectedNode.readAt !== null ? (
                <time dateTime={selectedNode.readAt}>
                  {new Date(selectedNode.readAt).toLocaleString(locale)}
                </time>
              ) : null}
              <h4>{t("dependencies.dependsOn")}</h4>
              {outgoing.map((edge) => (
                <button
                  className={styles.link}
                  key={edge.id}
                  onClick={() => {
                    setSelected(edge.target);
                  }}
                >
                  {visible.nodes.find((node) => node.id === edge.target)?.label}
                </button>
              ))}
              <h4>{t("dependencies.usedBy")}</h4>
              {incoming.map((edge) => (
                <button
                  className={styles.link}
                  key={edge.id}
                  onClick={() => {
                    setSelected(edge.source);
                  }}
                >
                  {visible.nodes.find((node) => node.id === edge.source)?.label}
                </button>
              ))}
              {selectedNode.object !== null ? (
                <Button
                  onClick={() => {
                    selectRoot(selectedNode.id);
                  }}
                >
                  {t("dependencies.exploreFrom")}
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  setHidden(new Set([...hidden, selectedNode.id]));
                  setSelected(null);
                }}
              >
                {t("dependencies.hide")}
              </Button>
            </>
          )}
        </aside>
      </div>
      <div className={styles.export}>
        <span>
          {t("dependencies.visible", { nodes: visible.nodes.length, edges: visible.edges.length })}
        </span>
        {hidden.size > 0 ? (
          <Button
            onClick={() => {
              setHidden(new Set());
            }}
          >
            {t("dependencies.restore")}
          </Button>
        ) : null}
        <Select
          label={t("dependencies.format")}
          value={format}
          options={FORMATS.map((value) => ({ value, label: value.toUpperCase() }))}
          placeholder={t("dependencies.format")}
          onValueChange={setFormat}
        />
        <Button
          variant="primary"
          disabled={
            busy ||
            pngTooLarge ||
            arranged?.graph !== visible ||
            arranged.labels !== labels ||
            visible.nodes.length === 0
          }
          onClick={() => {
            void exportGraph();
          }}
        >
          {busy ? t("dependencies.exporting") : t("dependencies.export")}
        </Button>
      </div>
      {pngTooLarge ? (
        <Alert
          variant="warning"
          title={t("export.warning.tooLarge", {
            scale: pngScale,
            width: exportExtent.width,
            height: exportExtent.height,
            limit: MAX_RASTER_SIDE,
          })}
        />
      ) : null}
      {message !== null ? <p role="status">{message}</p> : null}
    </div>
  );
}
