import { describe, expect, it } from "vitest";
import { appendLog, endsAttempt } from "@/app/(operator)/repositories/[sourceId]/previews/[preview]/build-log";

// The preview page's live build log (task 6.3): when an attempt's log is whole, and how much of it the page keeps.
describe("the build log", () => {
  it("knows an attempt's log is whole once its last step line is in", () => {
    expect(endsAttempt("==> build: npm run build\n==> ready: 332 bytes published in 1s\n")).toBe(true);
    expect(endsAttempt("==> failed: The build failed\n")).toBe(true);
    expect(endsAttempt("==> stopped: The worker stopped\n")).toBe(true);
    expect(endsAttempt("==> not published: This claim no longer runs the preview's current attempt.\n")).toBe(true);
    expect(endsAttempt("==> build: npm run build\nsomething ==> ready: in a line\n")).toBe(false);
  });

  it("appends new lines, and keeps only the latest half mebibyte from a line's start", () => {
    expect(appendLog({ text: "one\n", truncated: false }, "two\n")).toEqual({ text: "one\ntwo\n", truncated: false });
    const line = `${"x".repeat(1023)}\n`;
    const kept = appendLog({ text: line.repeat(600), truncated: false }, "last\n");
    expect(kept.truncated).toBe(true);
    expect(kept.text.length).toBeLessThanOrEqual(512 * 1024);
    expect(kept.text.startsWith("x")).toBe(true);
    expect(kept.text.endsWith(`${line}last\n`)).toBe(true);
  });
});
