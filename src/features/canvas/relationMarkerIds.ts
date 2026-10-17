import type { RelationMarkerKind } from "./edgeGeometry";

/**
 * Ids of the canvas markers, one per crow's foot shape of `RELATION_MARKER_SHAPES`, named by
 * what the end says. Declared by `RelationMarkers` and referenced by every `RelationEdge`; the
 * SVG exporter uses its own `sc-` ids for the same shapes.
 */
export const MARKER_IDS: Readonly<Record<RelationMarkerKind, string>> = {
  many: "schemacraft-relation-many",
  one: "schemacraft-relation-one",
  zeroOrOne: "schemacraft-relation-zero-or-one",
};
