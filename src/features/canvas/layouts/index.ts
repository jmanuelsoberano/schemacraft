import type { LayoutKind } from "@/shared/contracts";

import { layeredLayout } from "./layered";
import type { ElkFactory, LayeredDirection } from "./layered";
import type { LayoutInput, LayoutResult } from "./layoutGraph";
import { organicLayout } from "./organic";
import { radialLayout } from "./radial";

/** A layout the user can run: the saved kind plus the options that do not persist. */
export type LayoutRequest =
  | { kind: "layered"; direction: LayeredDirection }
  | { kind: "organic" }
  | { kind: "radial"; focusId: string | null };

export function layoutKindOf(request: LayoutRequest): Exclude<LayoutKind, "manual"> {
  return request.kind;
}

/** Runs a layout; the layered engine is injected so tests can use the bundled ELK. */
export function runLayout(
  request: LayoutRequest,
  input: LayoutInput,
  createElk: ElkFactory,
): Promise<LayoutResult> {
  switch (request.kind) {
    case "layered":
      return layeredLayout(input, request.direction, createElk);
    case "organic":
      return Promise.resolve(organicLayout(input));
    case "radial":
      return Promise.resolve(radialLayout(input, request.focusId));
  }
}

export { buildLayoutInput } from "./layoutGraph";
export type { LayoutInput, LayoutResult } from "./layoutGraph";
export { placeNearRelated } from "./placement";
export type { LayeredDirection } from "./layered";
