import type { NotedElement } from "@/lib/prototypes/types";

/**
 * Finding the element a note is about (preview spec, "Visitors can select an
 * element in the preview"). Salt names a component's root element with a
 * `salt<Component>` class, which this reads as the component's name; that is
 * an internal detail of Salt, so a contract test pins it on the installed
 * release, and an element with no such class is named by its role and text.
 */

const COMPONENT_CLASS = /^salt([A-Z][A-Za-z0-9]*)$/;

/** Salt's class names that mark layout and structure rather than a component a note would be about. */
const STRUCTURAL = new Set(["StackLayout", "FlexLayout", "FlowLayout", "GridLayout", "GridItem", "BorderLayout", "BorderItem", "SplitLayout", "ParentChildLayout", "FlexItem"]);

/** "TokenizedInput" reads as "Tokenized input", as Salt's documentation names it. */
export function componentLabel(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
  return [words[0], ...words.slice(1).map((word) => (/^[A-Z]{2,}$/.test(word) ? word : word.toLowerCase()))].join(" ");
}

/** The Salt component name on an element itself, such as "Button" for an element with class saltButton. */
export function saltComponentOf(element: Element): string | null {
  for (const name of element.classList) {
    const match = COMPONENT_CLASS.exec(name);
    if (match && !STRUCTURAL.has(match[1]!)) return match[1]!;
  }
  return null;
}

/** The nearest element at or above `target`, inside `root`, that is a Salt component. */
export function nearestComponent(target: Element, root: Element): { element: Element; name: string | null } {
  for (let element: Element | null = target; element && root.contains(element); element = element.parentElement) {
    const name = saltComponentOf(element);
    if (name) return { element, name };
    if (element === root) break;
  }
  return { element: target, name: null };
}

/** A CSS path from `root` to `element`, by tag and position, so the pin can find the element again. */
export function locatorOf(element: Element, root: Element): string {
  const steps: string[] = [];
  for (let node: Element | null = element; node && node !== root; node = node.parentElement) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const tag = node.tagName.toLowerCase();
    const same = [...parent.children].filter((child) => child.tagName === node!.tagName);
    steps.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
  }
  return steps.join(" > ");
}

export function findByLocator(root: Element, locator: string): Element | null {
  if (!locator) return root;
  try {
    return root.querySelector(`:scope > ${locator}`);
  } catch {
    return null;
  }
}

/** The element's visible text, collapsed and cut to a readable length. */
export function visibleText(element: Element): string {
  const text = ((element as HTMLElement).innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/** What a note records about its element, apart from the image. */
export function describeElement(element: Element, root: Element): Omit<NotedElement, "image"> {
  const { element: component, name } = nearestComponent(element, root);
  const role = component.getAttribute("role") ?? component.tagName.toLowerCase();
  return { component: name ? componentLabel(name) : role, locator: locatorOf(component, root), text: visibleText(component) };
}
