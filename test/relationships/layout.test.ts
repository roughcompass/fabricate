import { describe, expect, it } from "vitest";
import { type LayoutBox, type PositionedBox, MAX_BOXES, layoutDiagram } from "@/lib/relationships/layout";

const box = (key: string): LayoutBox => ({ key, label: key });

function laidOut(rows: LayoutBox[][], arrows: { from: string; to: string }[]) {
  const layout = layoutDiagram(rows, arrows);
  if (layout.tooLarge) throw new Error("expected a drawable diagram");
  return layout;
}

const overlaps = (a: PositionedBox, b: PositionedBox) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("diagram layout", () => {
  const rows = [[box("shell")], [box("orders"), box("billing"), box("reports"), box("admin")], [box("design-tokens"), box("analytics")]];
  const arrows = [
    { from: "shell", to: "billing" },
    { from: "shell", to: "orders" },
    { from: "shell", to: "reports" },
    { from: "shell", to: "admin" },
    { from: "reports", to: "analytics" },
    { from: "admin", to: "design-tokens" },
  ];

  it("draws the host's row above the applications it loads", () => {
    const layout = laidOut(rows, arrows);
    const shell = layout.boxes.find((item) => item.key === "shell")!;

    for (const loaded of ["orders", "billing", "reports", "admin"]) expect(layout.boxes.find((item) => item.key === loaded)!.y).toBeGreaterThan(shell.y + shell.height);
    expect(layout.arrows.find((arrow) => arrow.to === "orders")!.path).toMatch(new RegExp(`^M ${shell.x + shell.width / 2} ${shell.y + shell.height} L `));
  });

  it("orders a row by the average position of its connections above", () => {
    const layout = laidOut(rows, arrows);
    const order = (row: number) => layout.boxes.filter((item) => item.row === row).sort((a, b) => a.x - b.x).map((item) => item.key);

    expect(order(1)).toEqual(["admin", "billing", "orders", "reports"]);
    // admin is first and reports last, so design-tokens (from admin) comes before analytics (from reports).
    expect(order(2)).toEqual(["design-tokens", "analytics"]);
  });

  it("gives the same coordinates for the same input", () => {
    expect(layoutDiagram(rows, arrows)).toEqual(layoutDiagram(rows.map((row) => [...row].reverse()), [...arrows].reverse()));
  });

  it("never overlaps two boxes, even when a row wraps", () => {
    const wide = [[box("host")], Array.from({ length: 23 }, (_, index) => box(`app-${String(index).padStart(2, "0")}`))];
    const layout = laidOut(wide, wide[1]!.map((item) => ({ from: "host", to: item.key })));

    expect(new Set(layout.boxes.filter((item) => item.row === 1).map((item) => item.y)).size).toBe(5);
    for (const [index, a] of layout.boxes.entries()) for (const b of layout.boxes.slice(index + 1)) expect(overlaps(a, b), `${a.key} and ${b.key}`).toBe(false);
    for (const item of layout.boxes) expect(item.x + item.width).toBeLessThanOrEqual(layout.width);
  });

  it("draws two opposite arrows between the same boxes side by side", () => {
    const layout = laidOut([[box("host")], [box("widget")]], [
      { from: "host", to: "widget" },
      { from: "widget", to: "host" },
    ]);
    const [down, up] = ["widget", "host"].map((to) => layout.arrows.find((arrow) => arrow.to === to)!.path);

    expect(down).not.toEqual(up);
    expect(Number(down!.split(" ")[1])).not.toBe(Number(up!.split(" ")[4]));
  });

  it("reports a 41-box diagram as too large to draw", () => {
    const boxes = Array.from({ length: MAX_BOXES + 1 }, (_, index) => box(`repo-${index}`));

    expect(layoutDiagram([boxes], [])).toEqual({ tooLarge: true, boxes: 41 });
    expect(layoutDiagram([boxes.slice(0, MAX_BOXES)], []).tooLarge).toBe(false);
  });
});
