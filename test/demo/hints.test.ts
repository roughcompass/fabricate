import { describe, expect, it } from "vitest";
import { hintsShown, nextHints, parseHints } from "@/lib/demo/hints";

describe("guided hint rules", () => {
  it("shows each sequence until it is finished or dismissed", () => {
    expect(hintsShown({}, "create")).toBe(true);
    const done = nextHints({}, "done", "create")!;
    expect(done).toEqual({ create: "done" });
    expect(hintsShown(done, "create")).toBe(false);
    expect(hintsShown(done, "runtime")).toBe(true);
    expect(nextHints({}, "done")).toBeNull();
  });

  it("replays both sequences, unless hints are off", () => {
    expect(nextHints({ create: "done", runtime: "done" }, "replay")).toEqual({});
    expect(nextHints({ off: true, runtime: "done" }, "replay")).toEqual({ off: true });
  });

  it("turns hints off everywhere, and back on without repeating finished sequences", () => {
    const off = nextHints({ create: "done" }, "off")!;
    expect(hintsShown(off, "create")).toBe(false);
    expect(hintsShown(off, "runtime")).toBe(false);
    expect(nextHints(off, "on")).toEqual({ create: "done" });
  });

  it("keeps only known values from stored state", () => {
    expect(parseHints('{"off":true,"create":"done","runtime":"later","gallery":"done"}')).toEqual({ off: true, create: "done" });
    expect(parseHints("not json")).toEqual({});
  });
});
