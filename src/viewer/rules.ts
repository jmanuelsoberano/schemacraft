/**
 * The readable rules in the standalone viewer: the DOM twin of the Inspector's rule items,
 * drawn from the same view-model, and the highlight of a rule's columns and relationship on
 * the diagram while the reader points at the rule.
 */
import { ROW_HEIGHT, rowCenterY } from "@/features/canvas/geometry";
import type { RuleNodeView, RuleTargets, RuleView } from "@/features/schema/objectDetailsView";
import type { RulePart, RuleTranslator } from "@/features/schema/rules/ruleText";

import { h } from "./dom";

/** The one table a sentence's table chip may open: the item's other table, when it is drawn. */
export interface TableLink {
  key: string;
  /** Accessible name of the chip, e.g. "Go to dbo.Customers". */
  label: string;
  onFollow: (key: string) => void;
}

/** How far the outline of a card stands off it, as the canvas draws it. */
const OUTLINE_GAP = 4;
/** Width of the accent bar at the start of a highlighted row. */
const BAR_WIDTH = 2;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * The runs of one sentence: text as it is, a column or a table as a chip, a value or keyword
 * as code. A table chip opens its table when it is the item's other table; the item's own link
 * already takes the keyboard there, so the chip stays out of the tab order.
 */
function partNodes(parts: readonly RulePart[], link: TableLink | null): (Node | string)[] {
  return parts.map((part) => {
    switch (part.kind) {
      case "text":
        return part.text;
      case "column":
        return h("span", { class: "sc-chip" }, part.name);
      case "table": {
        if (link?.key !== part.key) {
          return h("span", { class: "sc-chip" }, part.label);
        }
        const chip = h(
          "button",
          {
            class: "sc-chip sc-chip-link",
            type: "button",
            tabindex: "-1",
            "aria-label": link.label,
          },
          part.label,
        );
        chip.addEventListener("click", () => {
          link.onFollow(part.key);
        });
        return chip;
      }
      case "code":
        return h("code", { class: "sc-code" }, part.text);
    }
  });
}

/** The sentences as a list; a group's heading leads a nested list of its own sentences. */
export function ruleSentences(nodes: readonly RuleNodeView[], link: TableLink | null): HTMLElement {
  return h(
    "ul",
    { class: "sc-rule-sentences" },
    ...nodes.map((node) =>
      node.kind === "sentence"
        ? h("li", {}, ...partNodes(node.parts, link))
        : h(
            "li",
            {},
            h("span", { class: "sc-rule-heading" }, ...partNodes(node.heading, link)),
            ruleSentences(node.items, link),
          ),
    ),
  );
}

/** The sentences, or the line that says the rule cannot be put into words. */
export function ruleBody(rule: RuleView, link: TableLink | null): HTMLElement {
  return rule.unread === null
    ? ruleSentences(rule.sentences, link)
    : h("p", { class: "sc-rule-unread" }, rule.unread);
}

/**
 * The rule's SQL behind a disclosure, open from the start when there are no sentences; `null`
 * when the SQL is unknown. Its summary is the item's stop for the keyboard.
 */
export function ruleSql(rule: RuleView, t: RuleTranslator["t"]): HTMLElement | null {
  if (rule.sql === null) {
    return null;
  }
  const summary = h("summary", {}, t(rule.unread === null ? "rule.sql.show" : "rule.sql.hide"));
  const details = h(
    "details",
    { class: "sc-rule-sql", open: rule.unread !== null },
    summary,
    h("pre", { class: "sc-mono" }, rule.sql),
    rule.sqlNote === null ? null : h("p", { class: "sc-rule-sql-note" }, rule.sqlNote),
  );
  details.addEventListener("toggle", () => {
    summary.textContent = t(details.open ? "rule.sql.hide" : "rule.sql.show");
  });
  return details;
}

function svgRect(
  className: string,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 0,
): SVGRectElement {
  const rect = document.createElementNS(SVG_NAMESPACE, "rect");
  rect.setAttribute("class", className);
  rect.setAttribute("x", String(x));
  rect.setAttribute("y", String(y));
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
  if (radius > 0) {
    rect.setAttribute("rx", String(radius));
  }
  return rect;
}

/**
 * Highlights a rule on the diagram as the canvas does: an outline standing off every card it
 * involves, a tint and a bar behind each of its rows the card shows, and its relationship. The
 * rule takes over the emphasis of the selected table, so only its own relationship stands out.
 */
export function paintRuleHighlight(world: Element, targets: RuleTargets): void {
  clearRuleHighlight(world);
  for (const relation of world.querySelectorAll<SVGPathElement>(".sc-relation")) {
    const isRule = targets.relation !== null && relation.dataset.relation === targets.relation;
    relation.classList.toggle("sc-active", isRule);
    relation.classList.toggle("sc-rule-relation", isRule);
  }
  for (const entity of world.querySelectorAll<SVGGElement>(".sc-entity")) {
    entity.classList.remove("sc-related");
    const names = targets.columns.get(entity.dataset.entity ?? "") ?? [];
    const fill = entity.querySelector<SVGRectElement>(".sc-node-fill");
    if (names.length === 0 || fill === null) {
      continue;
    }
    const width = Number(fill.getAttribute("width"));
    const height = Number(fill.getAttribute("height"));
    const radius = Number(fill.getAttribute("rx"));
    entity.prepend(
      svgRect(
        "sc-rule-outline",
        -OUTLINE_GAP,
        -OUTLINE_GAP,
        width + OUTLINE_GAP * 2,
        height + OUTLINE_GAP * 2,
        radius + OUTLINE_GAP,
      ),
    );
    // A card draws one column text per row, in row order, so a text's place is its row's.
    entity.querySelectorAll<SVGTextElement>("text.sc-column").forEach((text, index) => {
      if (!names.includes(text.dataset.column ?? "")) {
        return;
      }
      text.classList.add("sc-rule-column");
      const type = text.previousElementSibling;
      if (type?.classList.contains("sc-type") === true) {
        type.classList.add("sc-rule-type");
      }
      // Clear of the rounded corners, and behind the row's icons and texts.
      const top = rowCenterY(index) - ROW_HEIGHT / 2;
      fill.after(
        svgRect("sc-rule-tint", 1, top, width - 2, ROW_HEIGHT),
        svgRect("sc-rule-bar", 1, top, BAR_WIDTH, ROW_HEIGHT),
      );
    });
  }
}

/** Takes a rule's highlight off the diagram, leaving the classes the viewer sets itself alone. */
export function clearRuleHighlight(world: Element): void {
  for (const element of world.querySelectorAll(".sc-rule-outline, .sc-rule-tint, .sc-rule-bar")) {
    element.remove();
  }
  for (const element of world.querySelectorAll(
    ".sc-rule-column, .sc-rule-type, .sc-rule-relation",
  )) {
    element.classList.remove("sc-rule-column", "sc-rule-type", "sc-rule-relation");
  }
}
