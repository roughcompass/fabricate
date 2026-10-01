/**
 * Placement for the toolbar's floating overlays (template-demo/toolbar spec:
 * nothing overlays the toolbar). Overlays such as the zone indicator, debug
 * labels, banners, hints, and the comment composer go where they prefer to,
 * unless that would cover one of the toolbar's controls; then they move left
 * of the control, or above it, or below it. No React or browser dependencies.
 */

export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface Position {
  readonly top: number;
  readonly left: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Matches --space-2: the gap kept from the viewport edges and from the toolbar. */
export const PLACEMENT_MARGIN = 8;

export function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

function clamp(position: Position, box: Size, viewport: Size, margin: number): Position {
  const maxLeft = Math.max(margin, viewport.width - box.width - margin);
  const maxTop = Math.max(margin, viewport.height - box.height - margin);
  return { left: Math.min(Math.max(margin, position.left), maxLeft), top: Math.min(Math.max(margin, position.top), maxTop) };
}

const at = (position: Position, box: Size): Rect => ({ ...position, ...box });

/**
 * Places a box: at its preferred position when that covers no exclusion;
 * otherwise left of the exclusion it would cover, then above it, then below
 * it. Every candidate is clamped to the viewport, keeping `margin` from its
 * edges and from the exclusions. When no candidate is clear, as when the box
 * is larger than the space left, the box goes left of the exclusions, the
 * side the toolbar leaves free.
 */
export function placeOutside(box: Size, preferred: Position, exclusions: readonly Rect[], viewport: Size, margin = PLACEMENT_MARGIN): Position {
  const clear = (position: Position) => !exclusions.some((exclusion) => intersects(at(position, box), exclusion));
  const first = clamp(preferred, box, viewport, margin);
  if (clear(first)) return first;

  const tried: Position[] = [];
  let current = first;
  // Each step moves past one more exclusion, so a box can clear the menu and the pill beside it.
  for (let step = 0; step <= exclusions.length; step++) {
    const hit = exclusions.find((exclusion) => intersects(at(current, box), exclusion));
    if (!hit) return current;
    const candidates = [
      { left: hit.left - margin - box.width, top: current.top },
      { left: current.left, top: hit.top - margin - box.height },
      { left: current.left, top: hit.top + hit.height + margin },
    ].map((position) => clamp(position, box, viewport, margin));
    const next = candidates.find(clear) ?? candidates.find((position) => !intersects(at(position, box), hit));
    if (!next || tried.some((position) => position.left === next.left && position.top === next.top)) break;
    tried.push(next);
    current = next;
  }
  if (clear(current)) return current;
  // Nothing is clear: keep the box at the left of every exclusion, which the toolbar never occupies.
  const leftmost = Math.min(...exclusions.map((exclusion) => exclusion.left));
  return clamp({ left: leftmost - margin - box.width, top: current.top }, box, viewport, margin);
}
