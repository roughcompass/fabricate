import { describe, expect, it } from "vitest";
import { formatAbsolute, formatRelative } from "@/components/ui/time";

const NOW = new Date("2026-09-30T12:00:00Z");
const ago = (milliseconds: number) => new Date(NOW.getTime() - milliseconds);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relative time", () => {
  it.each([
    [0, "just now"],
    [59_000, "just now"],
    [MINUTE, "1 minute ago"],
    [45 * MINUTE, "45 minutes ago"],
    [HOUR, "1 hour ago"],
    [23 * HOUR, "23 hours ago"],
    [DAY, "yesterday"],
    [6 * DAY, "6 days ago"],
    [7 * DAY, "Sep 23, 2026"],
    [400 * DAY, "Aug 26, 2025"],
  ])("formats %d ms ago as %s", (elapsed, expected) => {
    expect(formatRelative(ago(elapsed), NOW)).toBe(expected);
  });

  it("reads a time slightly in the future as just now", () => {
    expect(formatRelative(new Date(NOW.getTime() + 5_000), NOW)).toBe("just now");
  });

  it("gives the full UTC time for tooltips", () => {
    expect(formatAbsolute(NOW)).toBe("Sep 30, 2026, 12:00 PM UTC");
  });
});
