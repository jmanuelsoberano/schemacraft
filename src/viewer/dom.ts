/** Attributes of {@link h}: a string sets one, `true` sets it empty, anything else leaves it out. */
export type Attributes = Record<string, string | boolean | undefined>;

/** Creates an element with attributes and children; text children are never parsed as HTML. */
export function h<Tag extends keyof HTMLElementTagNameMap>(
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
