import { MARKER_HEIGHT, MARKER_ORIENT, MARKER_REF_Y, RELATION_MARKER_SHAPES } from "./edgeGeometry";
import type { RelationMarkerKind } from "./edgeGeometry";
import { MARKER_IDS } from "./relationMarkerIds";

const KINDS = Object.keys(RELATION_MARKER_SHAPES) as RelationMarkerKind[];

/**
 * Crow's foot markers shared by every relationship edge, one `<marker>` per shape of
 * {@link RELATION_MARKER_SHAPES}. They take the colour of the path they decorate
 * (`context-stroke`), so hover and selection restyle them for free.
 */
export function RelationMarkers() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {KINDS.map((kind) => {
          const shape = RELATION_MARKER_SHAPES[kind];
          return (
            <marker
              key={kind}
              id={MARKER_IDS[kind]}
              viewBox={`0 0 ${shape.width} ${MARKER_HEIGHT}`}
              markerWidth={shape.width}
              markerHeight={MARKER_HEIGHT}
              refX={shape.refX}
              refY={MARKER_REF_Y}
              orient={MARKER_ORIENT}
              markerUnits="userSpaceOnUse"
            >
              <path d={shape.path} fill="none" stroke="context-stroke" strokeWidth="1.5" />
              {shape.circle ? (
                <circle
                  cx={shape.circle.cx}
                  cy={shape.circle.cy}
                  r={shape.circle.r}
                  fill="var(--color-canvas)"
                  stroke="context-stroke"
                  strokeWidth="1.5"
                />
              ) : null}
            </marker>
          );
        })}
      </defs>
    </svg>
  );
}
