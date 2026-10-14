/**
 * Standalone viewer embedded in exported HTML files. It renders the schema with the same SVG
 * renderer as the application, adds pan and zoom, the three detail levels, search, neighbour
 * highlighting and a detail panel, and depends on nothing outside the file.
 */
import "./viewer.css";

import { spreadForDetailLevel, withPositions } from "@/features/canvas/canvasState";
import { describeEntities, entityKey } from "@/features/canvas/geometry";
import type { EntityDescriptor } from "@/features/canvas/geometry";
import { VIEWER_DATA_ELEMENT_ID, VIEWER_ROOT_ELEMENT_ID } from "@/features/export/html/viewerData";
import type { ViewerData } from "@/features/export/html/viewerData";
import { renderDiagramSvg } from "@/features/export/svg/renderDiagram";
import type { ExportTheme } from "@/features/export/svg/palette";
import { createCanvasMeasurer } from "@/features/export/svg/text";
import { formatDataType } from "@/features/schema/dataType";
import type { DetailLevel, ForeignKey } from "@/shared/contracts";

import { createViewerTranslator, pluralKey } from "./messages";
import type { ViewerTranslator } from "./messages";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const FIT_MARGIN = 40;
const DETAIL_LEVELS: readonly DetailLevel[] = ["compact", "keys", "full"];

interface Transform {
  x: number;
  y: number;
  k: number;
}

type Attributes = Record<string, string | boolean | undefined>;

/** Creates an element with attributes and children; text children are never parsed as HTML. */
function h<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  attributes: Attributes = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[Tag] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === true) {
      element.setAttribute(name, "");
    } else if (typeof value === "string") {
      element.setAttribute(name, value);
    }
  }
  for (const child of children) {
    if (child !== null) {
      element.append(child);
    }
  }
  return element;
}

function readData(): ViewerData | null {
  const text = document.getElementById(VIEWER_DATA_ELEMENT_ID)?.textContent;
  if (!text) {
    return null;
  }
  return JSON.parse(text) as ViewerData;
}

class Viewer {
  private readonly data: ViewerData;
  private readonly t: ViewerTranslator;
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
  private diagramSize = { width: 1, height: 1 };
  private resultKeys: string[] = [];
  private activeResult = -1;

  constructor(root: HTMLElement, data: ViewerData) {
    this.data = data;
    this.t = createViewerTranslator(data.locale);
    this.entities = describeEntities(data.snapshot);
    this.detailLevel = data.detailLevel;
    this.theme = data.theme;

    this.search = h("input", {
      class: "sc-search",
      type: "search",
      placeholder: this.t("search.placeholder"),
      "aria-label": this.t("search.placeholder"),
      autocomplete: "off",
    });
    this.results = h("ul", { class: "sc-results", role: "listbox", hidden: true });
    this.stage = h("main", { class: "sc-stage" });
    this.world = h("div", { class: "sc-world" });
    this.panel = h("aside", { class: "sc-panel", hidden: true, "aria-live": "polite" });
    this.stage.append(this.world, this.panel);

    const levelGroup = h("div", {
      class: "sc-segment",
      role: "group",
      "aria-label": this.t("level.label"),
    });
    for (const level of DETAIL_LEVELS) {
      const button = h(
        "button",
        { class: "sc-button", type: "button", "aria-pressed": String(level === this.detailLevel) },
        this.t(`level.${level}`),
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
      this.t("action.fit"),
    );
    fitButton.addEventListener("click", () => {
      this.fit();
    });
    const themeButton = h(
      "button",
      {
        class: "sc-button sc-button-outline",
        type: "button",
        "aria-label": this.t("action.theme"),
      },
      "◐",
    );
    themeButton.addEventListener("click", () => {
      this.setTheme(this.theme === "light" ? "dark" : "light");
    });

    const { snapshot } = data;
    const summary = [
      this.t(pluralKey("summary.tables", snapshot.tables.length), {
        count: snapshot.tables.length,
      }),
      this.t(pluralKey("summary.views", snapshot.views.length), { count: snapshot.views.length }),
      this.t(pluralKey("summary.relations", snapshot.foreignKeys.length), {
        count: snapshot.foreignKeys.length,
      }),
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
        this.t("footer.exported", {
          date: Number.isNaN(exportedAt.getTime())
            ? data.exportedAt
            : exportedAt.toLocaleString(data.locale),
          generator: data.generator,
        }),
      ),
      h("span", { class: "sc-spacer" }),
      h("span", { class: "sc-zoom" }),
    );
    root.replaceChildren(h("div", { class: "sc-app" }, bar, this.stage, footer));

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
        background: false,
        measureText: this.measure,
      },
    );
    this.diagramSize = { width: rendered.width, height: rendered.height };
    // The markup is produced by the renderer from escaped data, never from the page.
    this.world.innerHTML = rendered.svg;
    this.applySelection();
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
      const wasClick = !pointer.moved;
      pointer = null;
      this.stage.classList.remove("sc-dragging");
      if (wasClick) {
        const entity = (event.target as Element).closest<SVGGElement>("[data-entity]");
        this.select(entity?.dataset.entity ?? null);
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
    this.stage.addEventListener("pointerover", (event) => {
      const entity = (event.target as Element).closest<SVGGElement>("[data-entity]");
      this.highlight(entity?.dataset.entity ?? this.selected);
    });
    this.stage.addEventListener("pointerout", () => {
      this.highlight(this.selected);
    });
  }

  private highlight(key: string | null): void {
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
    this.applySelection();
  }

  private applySelection(): void {
    for (const group of this.world.querySelectorAll<SVGGElement>(".sc-entity")) {
      group.classList.toggle("sc-selected", group.dataset.entity === this.selected);
    }
    this.highlight(this.selected);
    this.renderPanel();
  }

  private renderPanel(): void {
    const entity = this.selected === null ? undefined : this.entities.get(this.selected);
    if (entity === undefined) {
      this.panel.hidden = true;
      this.panel.replaceChildren();
      return;
    }
    const closeButton = h(
      "button",
      { class: "sc-button sc-close", type: "button", "aria-label": this.t("action.close") },
      "×",
    );
    closeButton.addEventListener("click", () => {
      this.select(null);
    });
    const header = h(
      "div",
      { class: "sc-panel-header" },
      h(
        "div",
        {},
        h(
          "div",
          { class: "sc-panel-kind" },
          this.t(entity.kind === "view" ? "panel.view" : "panel.table"),
        ),
        h(
          "h2",
          { class: "sc-panel-title" },
          h("span", { class: "sc-schema" }, `${entity.name.schema}.`),
          entity.name.name,
        ),
      ),
      closeButton,
    );
    this.panel.replaceChildren(
      header,
      this.columnsSection(entity),
      ...this.constraintSections(entity),
    );
    this.panel.hidden = false;
  }

  private columnsSection(entity: EntityDescriptor): HTMLElement {
    const rows = entity.columns.map((column) => {
      const badges: HTMLElement[] = [];
      if (entity.primaryKeyColumns.has(column.name)) {
        badges.push(h("span", { class: "sc-badge sc-badge-key" }, "PK"));
      }
      if (entity.foreignKeyColumns.has(column.name)) {
        badges.push(h("span", { class: "sc-badge sc-badge-link" }, "FK"));
      }
      if (column.isIdentity) {
        badges.push(h("span", { class: "sc-badge" }, this.t("panel.identity")));
      }
      if (column.isComputed) {
        badges.push(h("span", { class: "sc-badge" }, this.t("panel.computed")));
      }
      const type = h("span", { class: "sc-mono" }, formatDataType(column.dataType));
      const details = h("td", {}, type);
      if (column.defaultExpression !== null) {
        details.append(
          h(
            "div",
            { class: "sc-muted sc-mono" },
            `${this.t("panel.default")} ${column.defaultExpression}`,
          ),
        );
      }
      return h(
        "tr",
        {},
        h("td", { class: "sc-mono" }, column.name, ...badges),
        details,
        h("td", { class: "sc-muted" }, this.t(column.isNullable ? "panel.yes" : "panel.no")),
      );
    });
    return h(
      "section",
      { class: "sc-section" },
      h("h3", {}, this.t("panel.columns")),
      h(
        "table",
        { class: "sc-table" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", {}, this.t("panel.column")),
            h("th", {}, this.t("panel.type")),
            h("th", {}, this.t("panel.nullable")),
          ),
        ),
        h("tbody", {}, ...rows),
      ),
    );
  }

  private constraintSections(entity: EntityDescriptor): HTMLElement[] {
    const sections: HTMLElement[] = [];
    const table = this.data.snapshot.tables.find(
      (candidate) => entityKey(candidate.name) === entity.key,
    );
    if (table?.primaryKey) {
      sections.push(
        this.listSection(this.t("panel.primaryKey"), [
          h(
            "li",
            { class: "sc-mono" },
            `${table.primaryKey.name} (${table.primaryKey.columns.join(", ")})`,
          ),
        ]),
      );
    }
    if (table !== undefined && table.indexes.length > 0) {
      sections.push(
        this.listSection(
          this.t("panel.indexes"),
          table.indexes.map((index) =>
            h(
              "li",
              { class: "sc-mono" },
              `${index.name} (${index.columns.join(", ")})`,
              index.kind === "nonUnique"
                ? null
                : h("span", { class: "sc-badge" }, this.t("panel.unique")),
              index.isClustered
                ? h("span", { class: "sc-badge" }, this.t("panel.clustered"))
                : null,
            ),
          ),
        ),
      );
    }
    const outgoing = this.data.snapshot.foreignKeys.filter(
      (key) => entityKey(key.referencingTable) === entity.key,
    );
    if (outgoing.length > 0) {
      sections.push(
        this.listSection(
          this.t("panel.foreignKeys"),
          outgoing.map((key) => this.relationItem(key, entityKey(key.referencedTable))),
        ),
      );
    }
    const incoming = this.data.snapshot.foreignKeys.filter(
      (key) =>
        entityKey(key.referencedTable) === entity.key &&
        entityKey(key.referencingTable) !== entity.key,
    );
    if (incoming.length > 0) {
      sections.push(
        this.listSection(
          this.t("panel.referencedBy"),
          incoming.map((key) => this.relationItem(key, entityKey(key.referencingTable))),
        ),
      );
    }
    if (table !== undefined && table.checkConstraints.length > 0) {
      sections.push(
        this.listSection(
          this.t("panel.checks"),
          table.checkConstraints.map((check) =>
            h("li", { class: "sc-mono" }, `${check.name}: ${check.expression}`),
          ),
        ),
      );
    }
    return sections;
  }

  private relationItem(key: ForeignKey, otherKey: string): HTMLElement {
    const link = h("button", { class: "sc-link sc-mono", type: "button" }, otherKey);
    link.addEventListener("click", () => {
      this.select(otherKey);
      this.centerOn(otherKey);
    });
    const columns = key.columnPairs
      .map((pair) => `${pair.referencingColumn} → ${pair.referencedColumn}`)
      .join(", ");
    return h(
      "li",
      {},
      h(
        "div",
        { class: "sc-mono" },
        key.name,
        key.isEnabled ? null : h("span", { class: "sc-badge" }, this.t("panel.disabled")),
      ),
      h("div", { class: "sc-muted sc-mono" }, columns),
      link,
    );
  }

  private listSection(title: string, items: HTMLElement[]): HTMLElement {
    return h(
      "section",
      { class: "sc-section" },
      h("h3", {}, title),
      h("ul", { class: "sc-list" }, ...items),
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
    this.resultKeys = [...this.entities.keys()]
      .filter((key) => key.toLowerCase().includes(query))
      .sort((left, right) => left.length - right.length || left.localeCompare(right))
      .slice(0, 50);
    this.activeResult = 0;
    this.paintResults();
    this.results.hidden = false;
  }

  private paintResults(): void {
    if (this.resultKeys.length === 0) {
      this.results.replaceChildren(h("li", { class: "sc-result-empty" }, this.t("search.empty")));
      return;
    }
    this.results.replaceChildren(
      ...this.resultKeys.map((key, index) => {
        const item = h(
          "li",
          {
            class: `sc-result${index === this.activeResult ? " sc-result-active" : ""}`,
            role: "option",
            "aria-selected": String(index === this.activeResult),
          },
          key,
        );
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          this.goTo(key);
        });
        return item;
      }),
    );
  }

  private goTo(key: string): void {
    this.results.hidden = true;
    this.search.blur();
    this.select(key);
    this.centerOn(key);
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
