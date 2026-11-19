import { describe, expect, it } from "vitest";
import { isInspectorMessage, isToolbarEvent, markToolbarEvent } from "@/components/toolbar/inspector/protocol";
import { addressOf, routeOf } from "@/components/toolbar/target-document";
import { addLoads, pageLoad } from "@/components/toolbar/timing/load-order";
import { waterfall } from "@/demo/toolbar/timing/timing";

/*
 * What the toolbar works out from a framed application (add-applications,
 * design decision 6): its route under the build's path, its loads in order,
 * and which events and messages are the toolbar's own.
 */

const BASE = "/previews/pvw_orders/";
const ORIGIN = "http://127.0.0.1:3100";

describe("the framed application's route", () => {
  it("is the path under the build's base", () => {
    expect(routeOf("/previews/pvw_orders/", BASE)).toBe("/");
    expect(routeOf("/previews/pvw_orders", BASE)).toBe("/");
    expect(routeOf("/previews/pvw_orders/accounts/42", BASE)).toBe("/accounts/42");
    // A page outside the build keeps its own path.
    expect(routeOf("/elsewhere", BASE)).toBe("/elsewhere");
  });

  it("opens under the build's base", () => {
    expect(addressOf("/accounts/42", BASE)).toBe("/previews/pvw_orders/accounts/42");
    expect(addressOf("/", BASE)).toBe(BASE);
  });
});

describe("the load order", () => {
  const load = (path: string, startMs: number, durationMs: number, initiator = "script") => pageLoad({ url: path.startsWith("http") ? path : `${ORIGIN}${path}`, initiator, startMs, durationMs }, BASE, ORIGIN);

  it("names each file by its path in the build, or by its address from elsewhere, and its kind", () => {
    expect(load("/previews/pvw_orders/assets/index-B1.js", 12, 40)).toMatchObject({ file: "assets/index-B1.js", kind: "Script" });
    expect(load("/previews/pvw_orders/assets/index-C2.css", 14, 8, "link")).toMatchObject({ file: "assets/index-C2.css", kind: "Stylesheet" });
    expect(load("/previews/pvw_orders/remoteEntry.js", 30, 20)).toMatchObject({ file: "remoteEntry.js", kind: "Remote entry" });
    expect(load("https://cdn.example.com/lib/react.js", 5, 60)).toMatchObject({ file: "cdn.example.com/lib/react.js", kind: "Script" });
  });

  it("lists loads in the order they started, the slowest flagged, without repeating one reported again", () => {
    const entry = load("/previews/pvw_orders/assets/index-B1.js", 12, 40);
    const style = load("/previews/pvw_orders/assets/index-C2.css", 10, 8, "link");
    const chunk = load("/previews/pvw_orders/assets/settings-D3.js", 900, 15);
    const known = addLoads(addLoads([], [entry, style]), [entry, chunk]);
    const rows = waterfall(known);
    expect(rows.map((row) => row.file)).toEqual(["assets/index-C2.css", "assets/index-B1.js", "assets/settings-D3.js"]);
    expect(rows.filter((row) => row.slowest).map((row) => row.file)).toEqual(["assets/index-B1.js"]);
    expect(rows[2]!.offset + rows[2]!.width).toBeCloseTo(1);
  });
});

describe("what the toolbar tells apart", () => {
  it("marks an event it acted on, for the inspector in any realm", () => {
    const event = new Event("keydown");
    expect(isToolbarEvent(event)).toBe(false);
    markToolbarEvent(event);
    expect(isToolbarEvent(event)).toBe(true);
    // The mark is a Symbol.for key, which every realm shares.
    expect((event as unknown as Record<symbol, boolean>)[Symbol.for("frontend-registry.toolbar-event")]).toBe(true);
  });

  it("accepts only the inspector's tagged messages", () => {
    expect(isInspectorMessage({ type: "frontend-registry:inspector", kind: "ready", eventTiming: true })).toBe(true);
    expect(isInspectorMessage({ kind: "ready" })).toBe(false);
    expect(isInspectorMessage("ready")).toBe(false);
    expect(isInspectorMessage(null)).toBe(false);
  });
});
