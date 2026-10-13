/**
 * Crow's foot markers shared by every relationship edge. They take the colour of the path they
 * decorate (`context-stroke`), so hover and selection restyle them for free.
 */
export const MARKER_MANY = "schemacraft-relation-many";
export const MARKER_MANY_OPTIONAL = "schemacraft-relation-many-optional";
export const MARKER_ONE = "schemacraft-relation-one";

const MARKER_SIZE = 14;

export function RelationMarkers() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <marker
          id={MARKER_MANY}
          viewBox="0 0 14 14"
          markerWidth={MARKER_SIZE}
          markerHeight={MARKER_SIZE}
          refX="1"
          refY="7"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M13,7 L1,1 M13,7 L1,7 M13,7 L1,13"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
          />
        </marker>
        <marker
          id={MARKER_MANY_OPTIONAL}
          viewBox="0 0 22 14"
          markerWidth="22"
          markerHeight={MARKER_SIZE}
          refX="1"
          refY="7"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M13,7 L1,1 M13,7 L1,7 M13,7 L1,13"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
          />
          <circle
            cx="17"
            cy="7"
            r="3"
            fill="var(--color-canvas)"
            stroke="context-stroke"
            strokeWidth="1.5"
          />
        </marker>
        <marker
          id={MARKER_ONE}
          viewBox="0 0 14 14"
          markerWidth={MARKER_SIZE}
          markerHeight={MARKER_SIZE}
          refX="13"
          refY="7"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M6,1 L6,13 M1,7 L13,7" fill="none" stroke="context-stroke" strokeWidth="1.5" />
        </marker>
      </defs>
    </svg>
  );
}
