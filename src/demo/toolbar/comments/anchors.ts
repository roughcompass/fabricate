/**
 * Comment anchors (design.md, decision 10). A comment is placed on the nearest
 * authored data-demo-anchor around the chosen element (or the region itself),
 * at a fractional offset within it, in a specific microfrontend version.
 */

export interface Placement {
  readonly member: string;
  readonly memberVersion: string;
  readonly anchor: string;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface Shell {
  readonly id: string;
  readonly version: string;
}

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));

/** The element a placement would attach to, for the element under the pointer or focus. */
export function anchorElementFor(element: Element): Element | null {
  if (element.closest("[data-demo-toolbar]")) return null;
  const portal = element.closest("[data-demo-portal]");
  if (!portal) return null;
  const scope = element.closest("[data-demo-mfe]") ?? portal;
  const anchored = element.closest("[data-demo-anchor]");
  return anchored && scope.contains(anchored) ? anchored : scope;
}

/** Where a comment on `element` would go; `point` is the click position, or null for the element's center. */
export function placementFor(element: Element, point: { x: number; y: number } | null, shell: Shell): Placement | null {
  const anchorElement = anchorElementFor(element);
  if (!anchorElement) return null;
  const region = element.closest("[data-demo-mfe]");
  const isScope = anchorElement === region || anchorElement.hasAttribute("data-demo-portal");
  const rect = anchorElement.getBoundingClientRect();
  return {
    member: region?.getAttribute("data-demo-mfe") ?? shell.id,
    memberVersion: region?.getAttribute("data-demo-version") ?? shell.version,
    anchor: isScope ? (region ? "region" : "portal") : anchorElement.getAttribute("data-demo-anchor")!,
    offsetX: point ? clamp((point.x - rect.left) / rect.width) : 0.5,
    offsetY: point ? clamp((point.y - rect.top) / rect.height) : 0.5,
  };
}

/** The element a saved placement attaches to in the current view, or null when it is not shown here. */
export function findAnchorElement(placement: Pick<Placement, "member" | "memberVersion" | "anchor">, shell: Shell): Element | null {
  const scope =
    placement.member === shell.id
      ? placement.memberVersion === shell.version
        ? document.querySelector("[data-demo-portal]")
        : null
      : document.querySelector(`[data-demo-mfe="${CSS.escape(placement.member)}"][data-demo-version="${CSS.escape(placement.memberVersion)}"][data-demo-state="ready"]`);
  if (!scope) return null;
  if (placement.anchor === "region" || placement.anchor === "portal") return scope;
  return scope.querySelector(`[data-demo-anchor="${CSS.escape(placement.anchor)}"]`);
}
