import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { entityKey } from "@/features/schema/entities";
import { presentRoutineDependencyTracking } from "@/features/schema/routineDependencyTracking";
import type { SchemaSnapshot } from "@/shared/contracts";
import type { DependencyObjectRef } from "@/shared/contracts/generated/model/DependencyObjectRef";
import { useI18n } from "@/shared/i18n/useI18n";
import { Button } from "@/shared/ui/Button";

import {
  dependencyObjectKey,
  dependencyObjectLabel,
  dependencyObjects,
  projectDependencyGraph,
} from "./dependencyGraph";
import { useDependencyStore } from "./dependencyStore";
import styles from "./DependencyDialog.module.css";

function navigate(object: DependencyObjectRef): void {
  const ui = useCanvasUiStore.getState();
  if (object.kind === "table" || object.kind === "view") {
    const key = entityKey(object.name);
    ui.setSelectedKeys([key]);
    ui.focusEntity(key);
    ui.openInspector({ focus: true });
  } else if (object.kind === "routine") {
    ui.selectModule(
      object.identityArguments == null
        ? { kind: "routine", name: object.name }
        : { kind: "routineOverload", name: object.name, argumentTypes: object.identityArguments },
      { focus: true },
    );
  } else
    ui.selectModule({ kind: "trigger", parent: object.parent, name: object.name }, { focus: true });
}

/** Lists are based on recorded references; empty lists always retain the coverage caveat. */
export function DependencySection({
  snapshot,
  object,
}: {
  snapshot: SchemaSnapshot;
  object: DependencyObjectRef | null;
}) {
  const translator = useI18n();
  const { t } = translator;
  if (object === null) return null;
  const graph = projectDependencyGraph(
    snapshot.dependencies,
    dependencyObjects(snapshot),
    snapshot.provider,
  );
  const key = dependencyObjectKey(object);
  const currentNode = graph.nodes.find((node) => node.id === key);
  const tracking =
    currentNode?.routineBodyTracking === undefined
      ? null
      : presentRoutineDependencyTracking(currentNode.routineBodyTracking, translator);
  const outgoing = graph.edges.filter((edge) => edge.source === key);
  const incoming = graph.edges.filter((edge) => edge.target === key);
  const renderEndpoint = (id: string) => {
    const node = graph.nodes.find((node) => node.id === id);
    const endpointTracking =
      node?.routineBodyTracking === undefined
        ? null
        : presentRoutineDependencyTracking(node.routineBodyTracking, translator);
    return node === undefined ? null : node.object === null ? (
      <span>
        {node.label} · {t(`dependencies.status.${node.status}` as "dependencies.status.unknown")}
      </span>
    ) : (
      <span>
        <button
          className={styles.link}
          onClick={() => {
            if (node.object !== null) navigate(node.object);
          }}
        >
          {dependencyObjectLabel(node.object)}
        </button>
        {endpointTracking === null ? null : (
          <small title={endpointTracking.explanation}>{endpointTracking.label}</small>
        )}
      </span>
    );
  };
  return (
    <section className={styles.inspectorSection} aria-label={t("dependencies.title")}>
      <h3>{t("dependencies.title")}</h3>
      <p className={styles.notice}>{t("dependencies.description")}</p>
      {tracking === null ? null : (
        <p className={styles.notice}>
          <strong>
            {tracking.title}: {tracking.label}.
          </strong>{" "}
          {tracking.explanation}
        </p>
      )}
      {snapshot.dependencies === undefined ? <p>{t("dependencies.unrecorded")}</p> : null}
      {snapshot.dependencies?.capture.status === "notRead" ? (
        <p>
          {t("dependencies.notRead")}{" "}
          {t(`dependencies.reason.${snapshot.dependencies.capture.reason}`)}
        </p>
      ) : null}
      <h4>{t("dependencies.dependsOn")}</h4>
      <ul>
        {outgoing.map((edge) => (
          <li key={edge.id}>
            {renderEndpoint(edge.target)}
            {edge.retained ? <small>{t("dependencies.retained")}</small> : null}
          </li>
        ))}
      </ul>
      <h4>{t("dependencies.usedBy")}</h4>
      <ul>
        {incoming.map((edge) => (
          <li key={edge.id}>
            {renderEndpoint(edge.source)}
            {edge.retained ? <small>{t("dependencies.retained")}</small> : null}
          </li>
        ))}
      </ul>
      <Button
        onClick={() => {
          useDependencyStore.getState().open(object);
        }}
      >
        {t("action.dependencies")}
      </Button>
    </section>
  );
}
