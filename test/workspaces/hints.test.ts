import { describe, expect, it } from "vitest";
import { hintsShown, nextHints, parseHints } from "@/lib/workspaces/hints";

describe("guided hint rules", () => {
  it("shows the sequence until it is finished or dismissed", () => {
    expect(hintsShown({}, "runtime")).toBe(true);
    const done = nextHints({}, "done", "runtime")!;
    expect(done).toEqual({ runtime: "done" });
    expect(hintsShown(done, "runtime")).toBe(false);
    expect(nextHints({}, "done")).toBeNull();
  });

  it("replays the sequence, unless hints are off", () => {
    expect(nextHints({ runtime: "done" }, "replay")).toEqual({});
    expect(nextHints({ off: true, runtime: "done" }, "replay")).toEqual({ off: true });
  });

  it("turns hints off, and back on without repeating a finished sequence", () => {
    const off = nextHints({}, "off")!;
    expect(hintsShown(off, "runtime")).toBe(false);
    expect(nextHints(off, "on")).toEqual({});
    expect(nextHints({ off: true, runtime: "done" }, "on")).toEqual({ runtime: "done" });
  });

  it("keeps only known values from stored state", () => {
    expect(parseHints('{"off":true,"create":"done","runtime":"later","gallery":"done"}')).toEqual({ off: true });
    expect(parseHints('{"runtime":"done"}')).toEqual({ runtime: "done" });
    expect(parseHints("not json")).toEqual({});
  });
});
