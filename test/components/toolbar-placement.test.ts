import { describe, expect, it } from "vitest";
import { PLACEMENT_MARGIN, type Rect, intersects, placeOutside } from "@/components/toolbar/placement";

const desktop = { width: 1280, height: 900 };
const mobile = { width: 375, height: 812 };
// The pill docked to the middle of the right edge, and a panel to its left.
const pill = (viewport: { width: number; height: number }): Rect => ({ left: viewport.width - 12 - 46, top: viewport.height / 2 - 70, width: 46, height: 140 });
const panel = (viewport: { width: number; height: number }, width: number): Rect => ({ left: viewport.width - 78 - width, top: 120, width, height: viewport.height - 240 });
const at = (position: { left: number; top: number }, box: { width: number; height: number }): Rect => ({ ...position, ...box });

describe("placing overlays outside the toolbar", () => {
  for (const viewport of [desktop, mobile]) {
    const name = `${viewport.width} by ${viewport.height}`;

    it(`keeps the preferred position when it is clear (${name})`, () => {
      const box = { width: 160, height: 28 };
      expect(placeOutside(box, { left: 20, top: 20 }, [pill(viewport)], viewport)).toEqual({ left: 20, top: 20 });
    });

    it(`moves left of the pill a box that would cover it (${name})`, () => {
      const box = { width: 120, height: 28 };
      const exclusion = pill(viewport);
      const placed = placeOutside(box, { left: viewport.width - 130, top: exclusion.top + 10 }, [exclusion], viewport);
      expect(intersects(at(placed, box), exclusion)).toBe(false);
      expect(placed.left + box.width).toBeLessThanOrEqual(exclusion.left - PLACEMENT_MARGIN);
      expect(placed.top).toBe(exclusion.top + 10);
    });

    it(`goes above when there is no room to the left (${name})`, () => {
      const wide: Rect = { left: 0, top: 300, width: viewport.width, height: 100 };
      const box = { width: 200, height: 40 };
      const placed = placeOutside(box, { left: 50, top: 320 }, [wide], viewport);
      expect(placed).toEqual({ left: 50, top: 300 - PLACEMENT_MARGIN - 40 });
    });

    it(`goes below when there is no room to the left or above (${name})`, () => {
      const band: Rect = { left: 0, top: 0, width: viewport.width, height: 200 };
      const box = { width: 200, height: 40 };
      const placed = placeOutside(box, { left: 50, top: 20 }, [band], viewport);
      expect(placed).toEqual({ left: 50, top: 200 + PLACEMENT_MARGIN });
    });

    it(`clears both the pill and an open panel beside it (${name})`, () => {
      const exclusions = [pill(viewport), panel(viewport, Math.min(480, viewport.width - 90))];
      const box = { width: 180, height: 28 };
      const placed = placeOutside(box, { left: viewport.width - 200, top: 12 + 140 }, exclusions, viewport);
      for (const exclusion of exclusions) expect(intersects(at(placed, box), exclusion)).toBe(false);
    });

    it(`stays inside the viewport with the margin (${name})`, () => {
      const box = { width: 300, height: 50 };
      const placed = placeOutside(box, { left: -40, top: viewport.height + 10 }, [], viewport);
      expect(placed).toEqual({ left: PLACEMENT_MARGIN, top: viewport.height - 50 - PLACEMENT_MARGIN });
    });
  }

  it("keeps a box larger than the free space left of the toolbar, inside the viewport", () => {
    const box = { width: 360, height: 700 };
    const exclusion = pill(mobile);
    const placed = placeOutside(box, { left: 10, top: 50 }, [exclusion], mobile);
    expect(placed.left).toBeGreaterThanOrEqual(PLACEMENT_MARGIN);
    expect(placed.top).toBeGreaterThanOrEqual(PLACEMENT_MARGIN);
    expect(placed.top + box.height).toBeLessThanOrEqual(mobile.height - PLACEMENT_MARGIN);
  });

  it("returns the clamped preferred position when there are no exclusions", () => {
    expect(placeOutside({ width: 100, height: 20 }, { left: 1250, top: 5 }, [], desktop)).toEqual({ left: 1280 - 100 - PLACEMENT_MARGIN, top: PLACEMENT_MARGIN });
  });
});
