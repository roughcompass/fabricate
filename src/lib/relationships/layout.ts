import { compare } from "./placement";

/*
 * The layered layout for runtime system diagrams (design decision 6).
 * Boxes sit in fixed rows: row 0 is sorted by name, and each later row by
 * the average position of its connections in the row above, one barycenter
 * pass, with ties broken by name. A row wraps onto further lines at a fixed
 * number of boxes. Coordinates are deterministic, so the same diagram always
 * draws the same way, and boxes never overlap.
 */

export interface LayoutBox {
  key: string;
  label: string;
}

export interface LayoutArrow {
  from: string;
  to: string;
}

export interface PositionedBox extends LayoutBox {
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PositionedArrow extends LayoutArrow {
  /** SVG path data from the source box to the target box. */
  path: string;
}

export type Layout =
  | { tooLarge: false; width: number; height: number; boxes: PositionedBox[]; arrows: PositionedArrow[] }
  | { tooLarge: true; boxes: number };

export const BOX = { width: 184, height: 56, gapX: 24, gapY: 72, padding: 16, perLine: 5 } as const;
/** Above this many boxes a diagram shows its text equivalent instead of a crowded drawing. */
export const MAX_BOXES = 40;

export function layoutDiagram(rows: readonly (readonly LayoutBox[])[], arrows: readonly LayoutArrow[]): Layout {
  const count = rows.reduce((sum, row) => sum + row.length, 0);
  if (count > MAX_BOXES) return { tooLarge: true, boxes: count };

  const neighbours = new Map<string, Set<string>>();
  for (const arrow of arrows) {
    neighbours.set(arrow.from, (neighbours.get(arrow.from) ?? new Set()).add(arrow.to));
    neighbours.set(arrow.to, (neighbours.get(arrow.to) ?? new Set()).add(arrow.from));
  }

  const ordered: LayoutBox[][] = [];
  for (const [index, row] of rows.entries()) {
    const byName = [...row].sort((a, b) => compare(a.label, b.label) || compare(a.key, b.key));
    const above = index > 0 ? ordered[index - 1]! : [];
    if (above.length === 0) {
      ordered.push(byName);
      continue;
    }
    const position = new Map(above.map((box, at) => [box.key, at]));
    const barycenter = (box: LayoutBox) => {
      const linked = [...(neighbours.get(box.key) ?? [])].map((key) => position.get(key)).filter((at): at is number => at !== undefined);
      return linked.length === 0 ? Number.POSITIVE_INFINITY : linked.reduce((sum, at) => sum + at, 0) / linked.length;
    };
    ordered.push(byName.map((box) => ({ box, center: barycenter(box) })).sort((a, b) => a.center - b.center || compare(a.box.label, b.box.label) || compare(a.box.key, b.box.key)).map((item) => item.box));
  }

  // Each row becomes one or more lines of at most BOX.perLine boxes.
  const lines: { row: number; boxes: LayoutBox[] }[] = [];
  for (const [row, boxes] of ordered.entries()) for (let start = 0; start < boxes.length; start += BOX.perLine) lines.push({ row, boxes: boxes.slice(start, start + BOX.perLine) });
  const widest = Math.max(1, ...lines.map((line) => line.boxes.length));
  const width = BOX.padding * 2 + widest * BOX.width + (widest - 1) * BOX.gapX;
  const height = lines.length === 0 ? BOX.padding * 2 : BOX.padding * 2 + lines.length * BOX.height + (lines.length - 1) * BOX.gapY;

  const positioned: PositionedBox[] = [];
  for (const [index, line] of lines.entries()) {
    const lineWidth = line.boxes.length * BOX.width + (line.boxes.length - 1) * BOX.gapX;
    const left = (width - lineWidth) / 2;
    const y = BOX.padding + index * (BOX.height + BOX.gapY);
    for (const [at, box] of line.boxes.entries()) positioned.push({ ...box, row: line.row, x: left + at * (BOX.width + BOX.gapX), y, width: BOX.width, height: BOX.height });
  }

  const at = new Map(positioned.map((box) => [box.key, box]));
  const keys = new Set(arrows.map((arrow) => `${arrow.from}\u0000${arrow.to}`));
  const paths: PositionedArrow[] = [];
  for (const arrow of arrows) {
    const from = at.get(arrow.from);
    const to = at.get(arrow.to);
    if (!from || !to || from === to) continue;
    // Two arrows between the same boxes, one each way, are drawn side by side rather than on one line.
    const offset = keys.has(`${arrow.to}\u0000${arrow.from}`) ? (compare(arrow.from, arrow.to) < 0 ? -REVERSE_OFFSET : REVERSE_OFFSET) : 0;
    paths.push({ ...arrow, path: arrowPath(from, to, offset) });
  }
  return { tooLarge: false, width, height, boxes: positioned, arrows: paths.sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to)) };
}

/** How far apart two opposite arrows between the same boxes are drawn. */
const REVERSE_OFFSET = 8;

/**
 * From the bottom of the source to the top of a box below, the reverse for a
 * box above, and a curve below the line for a neighbour, or above it for the
 * second of two opposite arrows. +offset+ shifts the arrow sideways.
 */
function arrowPath(from: PositionedBox, to: PositionedBox, offset = 0): string {
  const fromX = from.x + from.width / 2 + offset;
  const toX = to.x + to.width / 2 + offset;
  if (to.y > from.y) return `M ${fromX} ${from.y + from.height} L ${toX} ${to.y}`;
  if (to.y < from.y) return `M ${fromX} ${from.y} L ${toX} ${to.y + to.height}`;
  if (offset > 0) return `M ${fromX} ${from.y} Q ${(fromX + toX) / 2} ${from.y - BOX.gapY / 2} ${toX} ${to.y}`;
  const bottom = from.y + from.height;
  return `M ${fromX} ${bottom} Q ${(fromX + toX) / 2} ${bottom + BOX.gapY / 2} ${toX} ${bottom}`;
}
