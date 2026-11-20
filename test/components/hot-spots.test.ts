// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { anchorFor } from "@/components/toolbar/comments/element-anchor";
import { type TimedInteraction, findHotSpot, hotSpotLabel, hotSpotTime, hotSpots } from "@/components/toolbar/timing/hot-spots";

/*
 * Timing's hot spots (restore-toolbar-tools-and-branch-previews, design
 * decision 10, task 7.1): the elements behind interactions over 200 ms,
 * grouped by element and route, ranked by each one's slowest, and found
 * again by the element kept for them or by their anchor.
 */

const RECALCULATE = { path: "#totals > button", tag: "button", fingerprint: "Recalculate totals" };
const EXPORT = { path: "body > main > button:nth-of-type(2)", tag: "button", fingerprint: "Export orders" };

let next = 1;
const interaction = (durationMs: number, overrides: Partial<TimedInteraction> = {}): TimedInteraction => ({ id: next++, target: 'button "Recalculate totals"', anchor: RECALCULATE, route: "/accounts", durationMs, approximate: false, ...overrides });

describe("hot spots", () => {
  it("leaves out interactions of 200 ms or less, and rates the rest Needs improvement or Poor", () => {
    expect(hotSpots([interaction(120), interaction(200)])).toEqual([]);
    const [spot] = hotSpots([interaction(201)]);
    expect(spot).toMatchObject({ rank: 1, rating: "needs-improvement", slowestMs: 201 });
    expect(hotSpots([interaction(501)])[0]!.rating).toBe("poor");
  });

  it("groups an element's slow interactions on a route, counting them, and ranks elements by their slowest", () => {
    const first = interaction(650);
    const second = interaction(300);
    const exported = interaction(420, { target: 'button "Export orders"', anchor: EXPORT });
    const quick = interaction(40);
    const elsewhere = interaction(800, { route: "/settings" });
    const spots = hotSpots([first, exported, second, quick, elsewhere]);
    expect(spots.map((spot) => [spot.rank, spot.target, spot.route, spot.count, spot.slowestMs])).toEqual([
      [1, 'button "Recalculate totals"', "/settings", 1, 800],
      [2, 'button "Recalculate totals"', "/accounts", 2, 650],
      [3, 'button "Export orders"', "/accounts", 1, 420],
    ]);
    // Newest first, so the element kept for the latest interaction is tried first.
    expect(spots[1]!.interactionIds).toEqual([second.id, first.id]);
  });

  it("keeps an interaction whose element couldn't be described as a hot spot of its own", () => {
    const spots = hotSpots([interaction(300, { anchor: null }), interaction(310, { anchor: null })]);
    expect(spots.map((spot) => spot.count)).toEqual([1, 1]);
  });

  it("labels each outline with its rank, its slowest time, and its rating, and marks an approximate time", () => {
    const [spot] = hotSpots([interaction(652.4)]);
    expect(hotSpotLabel(spot!)).toBe("#1 · 652 ms · Poor");
    const [approximate] = hotSpots([interaction(310, { approximate: true })]);
    expect(hotSpotLabel(approximate!)).toBe("#1 · ≈ 310 ms · Needs improvement");
    expect(hotSpotTime(approximate!)).toBe("≈ 310 ms");
  });
});

describe("finding a hot spot's element", () => {
  const page = () => {
    document.body.innerHTML = '<main><section id="totals"><button type="button">Recalculate totals</button></section></main>';
    return document.querySelector("button")!;
  };

  it("uses the element kept for its interaction while it's in the page", () => {
    const button = page();
    const one = interaction(650, { anchor: anchorFor(button, document) });
    const [spot] = hotSpots([one]);
    expect(findHotSpot(spot!, "/accounts", (id) => (id === one.id ? button : null), document)).toBe(button);
  });

  it("finds it again by its anchor when a re-render replaced it, and not at all on another route or once it's gone", () => {
    const button = page();
    const one = interaction(650, { anchor: anchorFor(button, document) });
    const [spot] = hotSpots([one]);
    // The application renders the button again as a new element in the same place.
    const replacement = button.cloneNode(true) as HTMLButtonElement;
    button.replaceWith(replacement);
    const kept = (id: number) => (id === one.id ? button : null);
    expect(findHotSpot(spot!, "/accounts", kept, document)).toBe(replacement);
    expect(findHotSpot(spot!, "/settings", kept, document)).toBeNull();
    replacement.remove();
    expect(findHotSpot(spot!, "/accounts", kept, document)).toBeNull();
  });
});
