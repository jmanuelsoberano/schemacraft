/**
 * Standalone viewer embedded in exported HTML files. It renders the schema with the same SVG
 * renderer as the application, adds pan and zoom, the three detail levels, search, neighbour
 * highlighting and a detail panel that reads `CHECK`s and keys out as the Inspector does, and
 * depends on nothing outside the file.
 */
import "./viewer.css";

import { spreadForDetailLevel, withPositions } from "@/features/canvas/canvasState";
import { describeEntities } from "@/features/canvas/geometry";
import type { EntityDescriptor } from "@/features/canvas/geometry";
import { triggerBadgeLabel } from "@/features/canvas/triggerBadgeText";
import {
  VIEWER_DATA_ELEMENT_ID,
  VIEWER_ROOT_ELEMENT_ID,
  carriesAccessNote,
} from "@/features/export/html/viewerData";
import type { ViewerData } from "@/features/export/html/viewerData";
import type { ViewerMessageKey } from "@/features/export/html/viewerMessages";
import { renderDiagramSvg } from "@/features/export/svg/renderDiagram";
import type { ExportTheme } from "@/features/export/svg/palette";
import { createCanvasMeasurer } from "@/features/export/svg/text";
import {
  displayIdentifier,
  entityKey,
  matchesQualifiedName,
  qualifiedNameLabel,
} from "@/features/schema/entities";
import { describeObjectDetails } from "@/features/schema/objectDetails";
import type { DetailsScope } from "@/features/schema/objectDetails";
import { triggerCapture } from "@/features/schema/triggerDetails";
import { hasRuleTargets, presentObjectDetails } from "@/features/schema/objectDetailsView";
import type {
  BadgeView,
  ColumnsSectionView,
  ConstraintSectionView,
  DetailsView,
  RelationSectionView,
  RelationTargetView,
  RuleTargets,
  SectionView,
  ValueView,
} from "@/features/schema/objectDetailsView";
import type { DetailLevel } from "@/shared/contracts";
import { createCatalogTranslator } from "@/shared/i18n/translator";
import type { CatalogTranslator } from "@/shared/i18n/translator";

import { h } from "./dom";
import { triggerList, viewDefinition } from "./programmability";
import { clearRuleHighlight, paintRuleHighlight, ruleBody, ruleSql } from "./rules";
import type { TableLink } from "./rules";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const FIT_MARGIN = 40;
const DETAIL_LEVELS: readonly DetailLevel[] = ["compact", "keys", "full"];

/** The badges with a colour of their own; the rest are plain. */
const BADGE_TONES: Partial<Record<BadgeView["kind"], string>> = {
  primaryKey: "sc-badge-key",
  foreignKey: "sc-badge-link",
};

/** The words of the file, translated as the application translates its own. */
type ViewerTranslator = CatalogTranslator<ViewerMessageKey>;

interface Transform {
  x: number;
  y: number;
  k: number;
}

/** The rule item the reader points at in the panel, and what it involves. */
interface PointedRule {
  item: HTMLElement;
  targets: RuleTargets;
}

function readData(): ViewerData | null {
  const text = document.getElementById(VIEWER_DATA_ELEMENT_ID)?.textContent;
  if (!text) {
    return null;
  }
  return JSON.parse(text) as ViewerData;
}

function badgeElement(badge: BadgeView): HTMLElement {
  return h("span", { class: `sc-badge ${BADGE_TONES[badge.kind] ?? ""}`.trim() }, badge.label);
}

/** A `CHECK` or `DEFAULT` text; a missing or unchecked one is marked and explains itself on hover. */
function valueElement(value: ValueView): HTMLElement {
  return h(
    "div",
    {
      class: value.state === "readable" ? "sc-value sc-mono" : "sc-value sc-mono sc-state",
      title: value.hint ?? undefined,
    },
    value.text,
  );
}

class Viewer {
  private readonly data: ViewerData;
  private readonly translator: ViewerTranslator;
  private readonly t: ViewerTranslator["t"];
  /** What the panel knows beyond the snapshot: only the diagram, with the capture's verdicts. */
  private readonly scope: DetailsScope;
  private readonly entities: Map<string, EntityDescriptor>;
  private readonly measure = createCanvasMeasurer() ?? undefined;
  private readonly stage: HTMLElement;
  private readonly world: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly results: HTMLUListElement;
  private readonly search: HTMLInputElement;
  private readonly levelButtons = new Map<DetailLevel, HTMLButtonElement>();
  private detailLevel: DetailLevel;
  private theme: ExportTheme;
  private transform: Transform = { x: 0, y: 0, k: 1 };
  private selected: string | null = null;
  /** The rule pointed at in the panel, which holds the diagram's emphasis while it lasts. */
  private pointed: PointedRule | null = null;
  private diagramSize = { width: 1, height: 1 };
  private resultKeys: string[] = [];
  private activeResult = -1;

  constructor(root: HTMLElement, data: ViewerData) {
    this.data = data;
    this.translator = createCatalogTranslator(data.messages, data.locale);
    this.t = this.translator.t;
    this.scope = {
      hiddenKeys: new Set(),
      coverage: data.access?.coverage ?? null,
      carriedOver: data.carriedOver,
      isSchemaFiltered: false,
      isDiagramOnly: true,
      definitions: "excluded",
    };
    this.entities = describeEntities(data.snapshot);
    this.detailLevel = data.detailLevel;
    this.theme = data.theme;

    this.search = h("input", {
      class: "sc-search",
      type: "search",
      placeholder: this.t("sidebar.search"),
      "aria-label": this.t("sidebar.search"),
      autocomplete: "off",
    });
    this.results = h("ul", { class: "sc-results", role: "listbox", hidden: true });
    this.stage = h("main", { class: "sc-stage" });
    this.world = h("div", { class: "sc-world" });
    this.panel = h("aside", {
      class: "sc-panel",
      hidden: true,
      "aria-label": this.t("viewer.panel.label"),
    });
    this.stage.append(this.world, this.panel);

    const levelGroup = h("div", {
      class: "sc-segment",
      role: "group",
      "aria-label": this.t("viewMode.label"),
    });
    for (const level of DETAIL_LEVELS) {
      const button = h(
        "button",
        { class: "sc-button", type: "button", "aria-pressed": String(level === this.detailLevel) },
        this.t(`viewMode.${level}`),
      );
      button.addEventListener("click", () => {
        this.setDetailLevel(level);
      });
      this.levelButtons.set(level, button);
      levelGroup.append(button);
    }
    const fitButton = h(
      "button",
      { class: "sc-button sc-button-outline", type: "button" },
      this.t("viewer.action.fit"),
    );
    fitButton.addEventListener("click", () => {
      this.fit();
    });
    const themeButton = h(
      "button",
      {
        class: "sc-button sc-button-outline",
        type: "button",
        "aria-label": this.t("viewer.action.theme"),
      },
      "◐",
    );
    themeButton.addEventListener("click", () => {
      this.setTheme(this.theme === "light" ? "dark" : "light");
    });

    const { snapshot } = data;
    // The file holds the keys between the entities on the diagram, so that is what it counts.
    const summary = [
      this.translator.tCount("viewer.summary.tables", snapshot.tables.length),
      this.translator.tCount("viewer.summary.views", snapshot.views.length),
      this.translator.tCount("viewer.summary.relations", snapshot.foreignKeys.length),
    ].join(" · ");
    const bar = h(
      "header",
      { class: "sc-bar" },
      h(
        "div",
        { class: "sc-brand" },
        h("span", { class: "sc-logo" }, "SchemaCraft"),
        h("span", { class: "sc-database", title: snapshot.databaseName }, snapshot.databaseName),
        h("span", { class: "sc-summary" }, summary),
      ),
      h("div", { class: "sc-spacer" }),
      h("div", { class: "sc-search-box" }, this.search, this.results),
      levelGroup,
      fitButton,
      themeButton,
    );
    const exportedAt = new Date(data.exportedAt);
    const footer = h(
      "footer",
      { class: "sc-footer" },
      h(
        "span",
        {},
        this.t("viewer.footer.exported", {
          date: Number.isNaN(exportedAt.getTime())
            ? data.exportedAt
            : exportedAt.toLocaleString(data.locale),
          generator: data.generator,
        }),
      ),
      h("span", { class: "sc-spacer" }),
      h("span", { class: "sc-zoom" }),
    );
    // The file travels without the application, so it says itself when the login that read
    // the schema could not see all of it.
    const notes: string[] = [];
    if (carriesAccessNote(data.access)) {
      notes.push(this.t("export.note.partial"));
    }
    if ([...this.entities.values()].some((entity) => entity.triggers !== null)) {
      notes.push(this.t("export.triggerLegend"));
    }
    if (snapshot.programmability?.capture.objects.status !== "read") {
      notes.push(this.t("export.triggersNotRead"));
    } else if (
      [...this.entities.values()].some(
        (entity) => triggerCapture(snapshot, entity.name, data.carriedOver).status !== "complete",
      )
    ) {
      notes.push(this.t("export.triggersNotChecked"));
    }
    const note =
      notes.length === 0
        ? null
        : h("div", { class: "sc-note", role: "note" }, ...notes.map((text) => h("p", {}, text)));
    root.replaceChildren(
      h(
        "div",
        { class: note === null ? "sc-app" : "sc-app sc-has-note" },
        bar,
        note,
        this.stage,
        footer,
      ),
    );

    this.bindStage();
    this.bindSearch();
    document.addEventListener("keydown", (event) => {
      this.onKeyDown(event);
    });
    this.render();
    this.fit();
  }

  /** Draws the diagram again, keeping the view; used once the embedded fonts have loaded. */
  refresh(): void {
    this.render();
  }

  private render(): void {
    // Positions were laid out for the exported level; taller levels spread nodes apart.
    const canvas = withPositions(
      this.data.canvas,
      spreadForDetailLevel(this.data.snapshot, this.data.canvas, this.detailLevel),
    );
    const rendered = renderDiagramSvg(
      { snapshot: this.data.snapshot, canvas },
      {
        detailLevel: this.detailLevel,
        theme: this.theme,
        labels: {
          view: this.t("entity.view.label"),
          triggers: (badge) => triggerBadgeLabel(badge, this.translator),
        },
        background: false,
        measureText: this.measure,
        noteLines: this.data.noteLines,
      },
    );
    this.diagramSize = { width: rendered.width, height: rendered.height };
    // The markup is produced by the renderer from escaped data, never from the page.
    this.world.innerHTML = rendered.svg;
    // The new drawing gets the selection and a rule pointed at back; the panel is left as it is,
    // so a theme, a detail level or the late fonts never take the keyboard's place in it.
    this.paintSelection();
    for (const [level, button] of this.levelButtons) {
      button.setAttribute("aria-pressed", String(level === this.detailLevel));
    }
  }

  private setDetailLevel(level: DetailLevel): void {
    if (level !== this.detailLevel) {
      this.detailLevel = level;
      this.render();
    }
  }

  private setTheme(theme: ExportTheme): void {
    this.theme = theme;
    document.documentElement.dataset.theme = theme;
    this.render();
  }

  private applyTransform(): void {
    const { x, y, k } = this.transform;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    const zoom = this.stage.parentElement?.querySelector(".sc-zoom");
    if (zoom !== null && zoom !== undefined) {
      zoom.textContent = `${Math.round(k * 100)} %`;
    }
  }

  private fit(): void {
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    const k = Math.min(
      (width - FIT_MARGIN) / this.diagramSize.width,
      (height - FIT_MARGIN) / this.diagramSize.height,
      1.5,
    );
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));
    this.transform = {
      k: clamped,
      x: (width - this.diagramSize.width * clamped) / 2,
      y: (height - this.diagramSize.height * clamped) / 2,
    };
    this.applyTransform();
  }

  private zoomAt(factor: number, pointX: number, pointY: number): void {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.transform.k * factor));
    const ratio = next / this.transform.k;
    this.transform = {
      k: next,
      x: pointX - (pointX - this.transform.x) * ratio,
      y: pointY - (pointY - this.transform.y) * ratio,
    };
    this.applyTransform();
  }

  private centerOn(key: string): void {
    const element = this.world.querySelector<SVGGElement>(`[data-entity="${CSS.escape(key)}"]`);
    if (element === null) {
      return;
    }
    const box = element.getBBox();
    const matrix = element.transform.baseVal.consolidate()?.matrix;
    const centerX = (matrix?.e ?? 0) + box.x + box.width / 2;
    const centerY = (matrix?.f ?? 0) + box.y + box.height / 2;
    const k = Math.max(this.transform.k, 0.8);
    this.transform = {
      k,
      x: this.stage.clientWidth / 2 - centerX * k,
      y: this.stage.clientHeight / 2 - centerY * k,
    };
    this.applyTransform();
  }

  private bindStage(): void {
    let pointer: {
      id: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      moved: boolean;
      /** The entity pressed on; the release goes to the stage, which captures the pointer. */
      entity: string | null;
    } | null = null;
    this.stage.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || this.panel.contains(event.target as Node)) {
        return;
      }
      pointer = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: this.transform.x,
        originY: this.transform.y,
        moved: false,
        entity:
          (event.target as Element).closest<SVGGElement>("[data-entity]")?.dataset.entity ?? null,
      };
      this.stage.setPointerCapture(event.pointerId);
    });
    this.stage.addEventListener("pointermove", (event) => {
      if (pointer?.id !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - pointer.startX;
      const deltaY = event.clientY - pointer.startY;
      if (!pointer.moved && Math.hypot(deltaX, deltaY) < 4) {
        return;
      }
      pointer.moved = true;
      this.stage.classList.add("sc-dragging");
      this.transform = {
        ...this.transform,
        x: pointer.originX + deltaX,
        y: pointer.originY + deltaY,
      };
      this.applyTransform();
    });
    const release = (event: PointerEvent) => {
      if (pointer?.id !== event.pointerId) {
        return;
      }
      const { moved, entity } = pointer;
      pointer = null;
      this.stage.classList.remove("sc-dragging");
      if (!moved) {
        this.select(entity);
      }
    };
    this.stage.addEventListener("pointerup", release);
    this.stage.addEventListener("pointercancel", release);
    this.stage.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const bounds = this.stage.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015));
        this.zoomAt(factor, event.clientX - bounds.left, event.clientY - bounds.top);
      },
      { passive: false },
    );
    // The panel sits on the stage, but moving over it is not moving over the diagram.
    this.stage.addEventListener("pointerover", (event) => {
      if (this.panel.contains(event.target as Node)) {
        return;
      }
      const entity = (event.target as Element).closest<SVGGElement>("[data-entity]");
      this.highlight(entity?.dataset.entity ?? this.selected);
    });
    this.stage.addEventListener("pointerout", (event) => {
      if (this.panel.contains(event.target as Node)) {
        return;
      }
      this.highlight(this.selected);
    });
  }

  /** Emphasises the relations and neighbours of `key`, unless a rule in the panel holds the emphasis. */
  private highlight(key: string | null): void {
    if (this.pointed !== null) {
      return;
    }
    for (const path of this.world.querySelectorAll<SVGPathElement>(".sc-relation")) {
      const active = key !== null && (path.dataset.source === key || path.dataset.target === key);
      path.classList.toggle("sc-active", active);
    }
    const related = new Set<string>();
    if (key !== null) {
      for (const foreignKey of this.data.snapshot.foreignKeys) {
        const source = entityKey(foreignKey.referencingTable);
        const target = entityKey(foreignKey.referencedTable);
        if (source === key) {
          related.add(target);
        } else if (target === key) {
          related.add(source);
        }
      }
    }
    for (const group of this.world.querySelectorAll<SVGGElement>(".sc-entity")) {
      const entity = group.dataset.entity ?? "";
      group.classList.toggle("sc-related", related.has(entity) && entity !== key);
    }
  }

  private select(key: string | null): void {
    this.selected = key;
    // The panel's items are replaced, and with them the rule pointed at.
    this.pointed = null;
    this.paintSelection();
    this.renderPanel();
  }

  /** Marks the selection on the diagram, with its neighbours or the rule pointed at in the panel. */
  private paintSelection(): void {
    for (const group of this.world.querySelectorAll<SVGGElement>(".sc-entity")) {
      group.classList.toggle("sc-selected", group.dataset.entity === this.selected);
    }
    if (this.pointed === null) {
      clearRuleHighlight(this.world);
      this.highlight(this.selected);
    } else {
      paintRuleHighlight(this.world, this.pointed.targets);
    }
    this.paintRuleRows();
  }

  /**
   * Points at a rule of the panel: its columns and relationship are highlighted on the diagram,
   * and its columns in the panel's own table, until the pointer and the focus both leave it.
   */
  private bindRule(item: HTMLElement, targets: RuleTargets): void {
    if (!hasRuleTargets(targets)) {
      return;
    }
    const point = () => {
      this.pointed = { item, targets };
      paintRuleHighlight(this.world, targets);
      this.paintRuleRows();
    };
    const release = () => {
      if (this.pointed?.item !== item) {
        return;
      }
      this.pointed = null;
      clearRuleHighlight(this.world);
      this.highlight(this.selected);
      this.paintRuleRows();
    };
    item.addEventListener("pointerenter", point);
    item.addEventListener("focusin", point);
    item.addEventListener("pointerleave", () => {
      if (!item.contains(document.activeElement)) {
        release();
      }
    });
    item.addEventListener("focusout", (event) => {
      if (!item.contains(event.relatedTarget as Node | null) && !item.matches(":hover")) {
        release();
      }
    });
  }

  /** Tints the rows of the panel's columns table that the rule pointed at involves. */
  private paintRuleRows(): void {
    const names = this.pointed?.targets.columns.get(this.selected ?? "") ?? [];
    for (const row of this.panel.querySelectorAll<HTMLTableRowElement>("tr[data-column]")) {
      row.classList.toggle("sc-rule-row", names.includes(row.dataset.column ?? ""));
    }
  }

  /** Moves focus to the panel's heading, so a keyboard user lands on what was just chosen. */
  private focusPanel(): void {
    this.panel.querySelector<HTMLElement>(".sc-panel-title")?.focus();
  }

  /**
   * Shows the selected entity as the application's Inspector shows it: the same facts, in the
   * same sections and the same words, with "None" only where the list is known to be complete.
   */
  private renderPanel(): void {
    const details =
      this.selected === null
        ? null
        : describeObjectDetails(this.data.snapshot, this.selected, this.scope);
    if (details === null) {
      this.panel.hidden = true;
      this.panel.replaceChildren();
      return;
    }
    const view = presentObjectDetails(details, this.translator);
    this.panel.replaceChildren(
      this.panelHeader(view),
      ...view.sections.map((section) => this.sectionElement(section)),
    );
    this.panel.hidden = false;
  }

  private panelHeader(view: DetailsView): HTMLElement {
    const closeButton = h(
      "button",
      { class: "sc-button sc-close", type: "button", "aria-label": this.t("viewer.action.close") },
      "×",
    );
    closeButton.addEventListener("click", () => {
      this.select(null);
    });
    return h(
      "div",
      { class: "sc-panel-header" },
      h(
        "div",
        { class: "sc-panel-heading" },
        h(
          "div",
          { class: view.kind === "view" ? "sc-panel-kind sc-panel-kind-view" : "sc-panel-kind" },
          view.kindLabel,
        ),
        h(
          "h2",
          { class: "sc-panel-title", tabindex: "-1" },
          h("span", { class: "sc-schema" }, `${displayIdentifier(view.schema)}.`),
          displayIdentifier(view.name),
        ),
        h("div", { class: "sc-panel-summary" }, view.summary),
        view.notice === null ? null : h("p", { class: "sc-panel-notice" }, view.notice),
      ),
      closeButton,
    );
  }

  /**
   * A section with its title and count, its items or its one honest empty line, a footnote, and
   * the notes its rules need.
   */
  private sectionElement(section: SectionView): HTMLElement {
    const heading = h("h3", {}, section.title);
    if (section.count > 0) {
      heading.append(h("span", { class: "sc-section-count" }, String(section.count)));
    }
    return h(
      "section",
      { class: "sc-section" },
      heading,
      section.emptyText === null
        ? this.sectionBody(section)
        : h("p", { class: "sc-empty" }, section.emptyText),
      section.footnote === null ? null : h("p", { class: "sc-footnote" }, section.footnote),
      ...section.notes.map((note) => h("p", { class: "sc-rule-note" }, note)),
    );
  }

  private sectionBody(section: SectionView): HTMLElement {
    switch (section.kind) {
      case "columns":
        return this.columnsTable(section);
      case "primaryKey":
      case "indexes":
      case "checks":
      case "nativeConstraints":
        return this.constraintList(section);
      case "references":
      case "referencedBy":
        return this.relationList(section);
      case "triggers":
        return triggerList(section);
      case "viewDefinition":
        return viewDefinition(section);
    }
  }

  private columnsTable(section: ColumnsSectionView): HTMLElement {
    const rows = section.items.map((column) => {
      const details = h("td", {}, h("span", { class: "sc-mono" }, column.type));
      for (const note of column.nativeNotes ?? [])
        details.append(h("div", { class: "sc-value" }, note));
      if (column.defaultValue !== null) {
        details.append(valueElement(column.defaultValue));
      }
      // A rule pointed at tints its columns here as on the diagram, found by their full name.
      return h(
        "tr",
        { "data-column": column.name },
        h("td", { class: "sc-mono" }, column.name, ...column.badges.map(badgeElement)),
        details,
        h("td", { class: "sc-muted" }, column.nullable),
      );
    });
    return h(
      "table",
      { class: "sc-table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}, section.headers.name),
          h("th", {}, section.headers.type),
          h("th", {}, section.headers.nullable),
        ),
      ),
      h("tbody", {}, ...rows),
    );
  }

  /**
   * Primary key, indexes and `CHECK`s: the name with its columns and badges, an index's `INCLUDE`
   * line, then for a `CHECK` its rule in words with the SQL behind a disclosure, or the marked
   * words for a missing text, under what is still known about it in words.
   */
  private constraintList(section: ConstraintSectionView): HTMLElement {
    return h(
      "ul",
      { class: "sc-list" },
      ...section.items.map((item) => {
        const head = h(
          "div",
          { class: "sc-mono" },
          item.name,
          item.columns.length === 0
            ? null
            : h("span", { class: "sc-muted" }, ` (${item.columns.join(", ")})`),
          ...item.badges.map(badgeElement),
        );
        if (item.rule === null) {
          return h(
            "li",
            {},
            head,
            ...(item.nativeNotes ?? []).map((note) => h("div", { class: "sc-value" }, note)),
            item.include === null ? null : h("div", { class: "sc-value sc-mono" }, item.include),
            item.expression === null ? null : valueElement(item.expression),
          );
        }
        // A text kept from an earlier read is worded too; its date says how far it holds. A text
        // the capture could not read keeps its marked words under what is still known.
        const { expression } = item;
        const hint = expression?.state === "notChecked" ? expression.hint : null;
        const missing =
          expression !== null &&
          (expression.state === "notAvailable" || expression.state === "notRecorded")
            ? valueElement(expression)
            : null;
        const element = h(
          "li",
          { class: "sc-rule" },
          head,
          item.include === null ? null : h("div", { class: "sc-value sc-mono" }, item.include),
          ...(item.nativeNotes ?? []).map((note) => h("div", { class: "sc-value" }, note)),
          ruleBody(item.rule, null),
          hint === null ? missing : h("div", { class: "sc-hint" }, hint),
          ruleSql(item.rule, this.t),
        );
        this.bindRule(element, item.rule.targets);
        return element;
      }),
    );
  }

  /**
   * Foreign keys out of or into the table: the name and badges, the column pairs, the sentences
   * that say what the key means and what its actions do, the other table, since when a kept key
   * is unchecked, and the scripted SQL.
   */
  private relationList(section: RelationSectionView): HTMLElement {
    return h(
      "ul",
      { class: "sc-list" },
      ...section.items.map((item) => {
        const { key, goLabel } = item.target;
        const link: TableLink | null =
          key === null
            ? null
            : {
                key,
                label: goLabel ?? key,
                onFollow: (target) => {
                  this.goTo(target);
                },
              };
        const element = h(
          "li",
          { class: "sc-rule" },
          h("div", { class: "sc-mono" }, item.name, ...item.badges.map(badgeElement)),
          h("div", { class: "sc-muted sc-mono" }, item.columns.join(", ")),
          ...(item.nativeNotes ?? []).map((note) => h("div", { class: "sc-value" }, note)),
          ruleBody(item.rule, link),
          this.targetElement(item.target),
          item.hint === null ? null : h("div", { class: "sc-hint" }, item.hint),
          ruleSql(item.rule, this.t),
        );
        this.bindRule(element, item.rule.targets);
        return element;
      }),
    );
  }

  /** The other table of a relation: a link when it is on the diagram, otherwise why it is not. */
  private targetElement(target: RelationTargetView): HTMLElement {
    const { key } = target;
    if (key !== null) {
      const link = h(
        "button",
        { class: "sc-link sc-mono", type: "button", "aria-label": target.goLabel ?? undefined },
        target.label,
      );
      link.addEventListener("click", () => {
        this.goTo(key);
      });
      return link;
    }
    if (target.state === "notVisible") {
      return h("div", { class: "sc-state" }, target.label);
    }
    return h(
      "div",
      {},
      h("span", { class: "sc-mono" }, target.label),
      target.stateLabel === null
        ? null
        : h("span", { class: "sc-state" }, ` · ${target.stateLabel}`),
    );
  }

  private bindSearch(): void {
    this.search.addEventListener("input", () => {
      this.updateResults();
    });
    this.search.addEventListener("focus", () => {
      this.updateResults();
    });
    this.search.addEventListener("blur", () => {
      // Let a click on a result land before the list disappears.
      window.setTimeout(() => {
        this.results.hidden = true;
      }, 150);
    });
    this.search.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const count = this.resultKeys.length;
        if (count > 0) {
          this.activeResult = (this.activeResult + step + count) % count;
          this.paintResults();
        }
      } else if (event.key === "Enter") {
        const key = this.resultKeys[this.activeResult] ?? this.resultKeys[0];
        if (key !== undefined) {
          this.goTo(key);
        }
      } else if (event.key === "Escape") {
        this.search.value = "";
        this.results.hidden = true;
      }
    });
  }

  private updateResults(): void {
    const query = this.search.value.trim().toLowerCase();
    if (query === "") {
      this.resultKeys = [];
      this.results.hidden = true;
      return;
    }
    this.resultKeys = [...this.entities.values()]
      .map((entity) => ({ entity, label: `${entity.name.schema}.${entity.name.name}` }))
      .filter(({ entity }) => matchesQualifiedName(entity.name, query))
      .sort(
        (left, right) =>
          left.label.length - right.label.length || left.label.localeCompare(right.label),
      )
      .slice(0, 50)
      .map(({ entity }) => entity.key);
    this.activeResult = 0;
    this.paintResults();
    this.results.hidden = false;
  }

  private paintResults(): void {
    if (this.resultKeys.length === 0) {
      this.results.replaceChildren(
        h("li", { class: "sc-result-empty" }, this.t("viewer.search.empty")),
      );
      return;
    }
    this.results.replaceChildren(
      ...this.resultKeys.flatMap((key, index) => {
        // Each result says whether it is a table or a view, as the application's palette does.
        const entity = this.entities.get(key);
        if (entity === undefined) return [];
        const isView = entity.kind === "view";
        const item = h(
          "li",
          {
            class: `sc-result${index === this.activeResult ? " sc-result-active" : ""}`,
            role: "option",
            "aria-selected": String(index === this.activeResult),
          },
          h("span", { class: "sc-result-name" }, qualifiedNameLabel(entity.name)),
          h(
            "span",
            { class: isView ? "sc-result-kind sc-result-kind-view" : "sc-result-kind" },
            this.t(isView ? "entity.view" : "entity.table"),
          ),
        );
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          this.goTo(key);
        });
        return item;
      }),
    );
  }

  /** Selects and centres an entity chosen by name, and hands focus to its panel. */
  private goTo(key: string): void {
    this.results.hidden = true;
    this.select(key);
    this.centerOn(key);
    this.focusPanel();
  }

  private onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") {
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      this.search.focus();
    } else if (event.key === "Escape") {
      this.select(null);
    } else if (event.key === "0") {
      this.fit();
    } else if (event.key === "+" || event.key === "=") {
      this.zoomAt(1.2, this.stage.clientWidth / 2, this.stage.clientHeight / 2);
    } else if (event.key === "-") {
      this.zoomAt(1 / 1.2, this.stage.clientWidth / 2, this.stage.clientHeight / 2);
    }
  }
}

function start(): void {
  const root = document.getElementById(VIEWER_ROOT_ELEMENT_ID);
  const data = readData();
  if (root === null || data === null) {
    return;
  }
  document.documentElement.dataset.theme = data.theme;
  const viewer = new Viewer(root, data);
  // Text was measured before the embedded fonts finished loading; measure again with them.
  void document.fonts.ready.then(() => {
    viewer.refresh();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
