/** A closed runtime embedded in offline HTML; it depends only on the document's projected data. */
function mountDependencyViewer(): void {
  interface ViewerNode {
    id: string;
    label: string;
    kind: string;
    status: string;
    readAt: string | null;
    retained: boolean;
    routineBodyTracking?: string;
  }
  interface ViewerWords {
    kinds: Record<string, string>;
    statuses: Record<string, string>;
    retained: string;
    routineTrackingTitle: string;
    routineTracking: Record<string, string>;
    routineTrackingHints: Record<string, string>;
  }
  const data = document.getElementById("graph");
  const words = document.getElementById("words");
  const details = document.getElementById("details");
  const search = document.getElementById("search");
  const svg = document.querySelector("svg");
  if (
    data === null ||
    words === null ||
    details === null ||
    !(search instanceof HTMLInputElement) ||
    svg === null
  )
    return;
  const graph = JSON.parse(data.textContent) as { nodes: ViewerNode[] };
  const labels = JSON.parse(words.textContent) as ViewerWords;
  const original = svg.viewBox.baseVal;
  const initial = { x: original.x, y: original.y, width: original.width, height: original.height };
  let box = { ...initial };
  const draw = () => {
    svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  };
  const zoom = (factor: number) => {
    const width = Math.max(20, Math.min(1e8, box.width * factor));
    const height = (width * initial.height) / initial.width;
    box = {
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - height) / 2,
      width,
      height,
    };
    draw();
  };
  document.getElementById("fit")?.addEventListener("click", () => {
    box = { ...initial };
    draw();
  });
  document.getElementById("in")?.addEventListener("click", () => {
    zoom(0.8);
  });
  document.getElementById("out")?.addEventListener("click", () => {
    zoom(1.25);
  });
  let drag: { x: number; y: number; box: typeof box } | null = null;
  svg.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Element && event.target.closest("g[data-node]") !== null) return;
    drag = { x: event.clientX, y: event.clientY, box: { ...box } };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (drag === null) return;
    const bounds = svg.getBoundingClientRect();
    const ratio = Math.max(drag.box.width / bounds.width, drag.box.height / bounds.height);
    box = {
      ...drag.box,
      x: drag.box.x - (event.clientX - drag.x) * ratio,
      y: drag.box.y - (event.clientY - drag.y) * ratio,
    };
    draw();
  });
  const finishDrag = () => {
    drag = null;
  };
  svg.addEventListener("pointerup", finishDrag);
  svg.addEventListener("pointercancel", finishDrag);
  const elements = [...svg.querySelectorAll<SVGGElement>("g[data-node]")];
  const byId = new Map(elements.map((element) => [element.getAttribute("data-node"), element]));
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const select = (node: ViewerNode, center: boolean) => {
    for (const element of elements)
      element.toggleAttribute("data-selected", element.getAttribute("data-node") === node.id);
    const status = node.retained
      ? labels.retained
      : (labels.statuses[node.status] ?? labels.statuses.unknown ?? node.status);
    const tracking =
      node.routineBodyTracking === undefined
        ? ""
        : `\n${labels.routineTrackingTitle}: ${labels.routineTracking[node.routineBodyTracking] ?? labels.routineTracking.unknown ?? ""}. ${labels.routineTrackingHints[node.routineBodyTracking] ?? labels.routineTrackingHints.unknown ?? ""}`;
    details.textContent = `${node.label} · ${labels.kinds[node.kind] ?? node.kind} · ${status}${node.readAt === null ? "" : ` · ${node.readAt}`}${tracking}`;
    if (!center) return;
    const element = byId.get(node.id);
    const transform = element?.transform.baseVal.consolidate()?.matrix;
    if (element === undefined || transform === undefined) return;
    const bounds = element.getBBox();
    box = {
      ...box,
      x: transform.e + bounds.x + bounds.width / 2 - box.width / 2,
      y: transform.f + bounds.y + bounds.height / 2 - box.height / 2,
    };
    draw();
  };
  for (const element of elements) {
    const node = nodesById.get(element.getAttribute("data-node") ?? "");
    if (node === undefined) continue;
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
    element.setAttribute("aria-label", node.label);
    element.addEventListener("click", () => {
      select(node, false);
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(node, true);
      }
    });
  }
  search.addEventListener("input", () => {
    const query = search.value.toLocaleLowerCase(document.documentElement.lang);
    if (query === "") return;
    const node = graph.nodes.find((node) =>
      node.label.toLocaleLowerCase(document.documentElement.lang).includes(query),
    );
    if (node !== undefined) select(node, true);
  });
}

// TypeScript is erased by the application build before this closed function is serialized.
export const DEPENDENCY_VIEWER_SCRIPT = `(${mountDependencyViewer.toString()})();`;
