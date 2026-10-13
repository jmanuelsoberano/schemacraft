import { Background, BackgroundVariant, Controls, ReactFlow } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";

import type { ActionsById } from "@/app/actions/action";
import { useSchemaStore } from "@/features/schema/schemaStore";
import { useI18n } from "@/shared/i18n/useI18n";

import styles from "./DiagramCanvas.module.css";
import { WelcomeOverlay } from "./WelcomeOverlay";

// Stable empty collections keep React Flow from re-initialising on every render.
const NO_NODES: Node[] = [];
const NO_EDGES: Edge[] = [];

interface DiagramCanvasProps {
  actions: ActionsById;
}

/** Infinite canvas that will host the entity-relationship diagram. */
export function DiagramCanvas({ actions }: DiagramCanvasProps) {
  const { tCount } = useI18n();
  const entityCount = useSchemaStore((state) =>
    state.snapshot === null ? null : state.snapshot.tables.length + state.snapshot.views.length,
  );

  return (
    <div className={styles.canvas}>
      <ReactFlow
        nodes={NO_NODES}
        edges={NO_EDGES}
        minZoom={0.05}
        maxZoom={2.5}
        nodesConnectable={false}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      {entityCount === null ? (
        <WelcomeOverlay actions={actions} />
      ) : (
        <div className={styles.loadedHint} role="status">
          {tCount("canvas.loaded", entityCount)}
        </div>
      )}
    </div>
  );
}
