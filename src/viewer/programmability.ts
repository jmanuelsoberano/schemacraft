import type {
  TriggersSectionView,
  ViewDefinitionSectionView,
} from "@/features/schema/objectDetailsView";

import { h } from "./dom";

/** Trigger names and event sentences are text nodes, including identifiers that look like HTML. */
export function triggerList(section: TriggersSectionView): HTMLElement {
  return h(
    "ul",
    { class: "sc-list sc-triggers" },
    ...section.items.map((item) =>
      h(
        "li",
        {},
        h(
          "div",
          { class: "sc-trigger-head" },
          h("span", { class: "sc-mono" }, item.name),
          ...item.badges.map((badge) => h("span", { class: "sc-badge" }, badge)),
        ),
        h(
          "ul",
          { class: "sc-trigger-events" },
          ...item.events.map((event) =>
            h(
              "li",
              {},
              ...event.parts.map((part) =>
                part.kind === "text" ? part.text : h("span", { class: "sc-chip" }, part.value),
              ),
              event.order === null ? null : h("span", { class: "sc-badge" }, event.order),
            ),
          ),
        ),
        item.hint === null ? null : h("p", { class: "sc-hint" }, item.hint),
        ...(item.nativeNotes ?? []).map((note) => h("p", { class: "sc-hint" }, note)),
      ),
    ),
  );
}

/** The shared view-model supplies the exclusion state; an HTML export never offers SQL source. */
export function viewDefinition(section: ViewDefinitionSectionView): HTMLElement {
  return h(
    "div",
    { class: "sc-view-definition" },
    section.badges.length === 0
      ? null
      : h(
          "div",
          { class: "sc-definition-badges" },
          ...section.badges.map((badge) =>
            h("span", { class: "sc-badge", title: badge.hint }, badge.label),
          ),
        ),
    section.stateLabel === null ? null : h("p", { class: "sc-state" }, section.stateLabel),
    section.explanation === null ? null : h("p", { class: "sc-hint" }, section.explanation),
  );
}
