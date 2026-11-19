import { describe, expect, it } from "vitest";
import { APPLICATION_STATUS_LABELS, applicationImage, applicationStatus, isSettling, statusFilter } from "@/lib/applications/status";
import type { ApplicationOutcome, ScreenshotState } from "@/lib/db/schema";

/*
 * An application's status and image (add-applications, design decision 1),
 * from its latest attempt's outcome and whether it has a current build,
 * every row of the design's table.
 */

describe("application status", () => {
  it.each<[current: boolean, outcome: ApplicationOutcome, status: string, image: string]>([
    [false, "building", "Building", "placeholder"],
    [false, "failed", "Build failed", "failure"],
    [false, "not_previewable", "Can't be previewed", "failure"],
    [true, "ready", "Ready", "screenshot"],
    [true, "building", "Building", "screenshot"],
    [true, "failed", "Latest build failed", "screenshot"],
    [true, "not_previewable", "Latest commit can't be previewed", "screenshot"],
  ])("with a current build %s and the latest outcome %s, shows %s and the %s image", (hasCurrent, latestOutcome, label, image) => {
    const input = { latestOutcome, hasCurrent, screenshot: hasCurrent ? ("ready" as const) : null };
    expect(APPLICATION_STATUS_LABELS[applicationStatus(input)]).toBe(label);
    expect(applicationImage(input)).toBe(image);
  });

  it.each<[ScreenshotState | null, string]>([
    ["ready", "screenshot"],
    ["pending", "capturing"],
    [null, "capturing"],
    ["unavailable", "unavailable"],
  ])("shows the current build's screenshot state %s as the %s image", (screenshot, image) => {
    for (const latestOutcome of ["ready", "building", "failed", "not_previewable"] as const) expect(applicationImage({ latestOutcome, hasCurrent: true, screenshot })).toBe(image);
  });

  it("files every failure, first or later, under Failed, and keeps refreshing while a build or capture is under way", () => {
    expect([applicationStatus({ latestOutcome: "ready", hasCurrent: true }), applicationStatus({ latestOutcome: "building", hasCurrent: false })].map(statusFilter)).toEqual(["ready", "building"]);
    for (const [latestOutcome, hasCurrent] of [["failed", false], ["failed", true], ["not_previewable", false], ["not_previewable", true]] as const) expect(statusFilter(applicationStatus({ latestOutcome, hasCurrent }))).toBe("failed");

    expect(isSettling({ latestOutcome: "building", hasCurrent: true, screenshot: "ready" })).toBe(true);
    expect(isSettling({ latestOutcome: "ready", hasCurrent: true, screenshot: "pending" })).toBe(true);
    expect(isSettling({ latestOutcome: "ready", hasCurrent: true, screenshot: "ready" })).toBe(false);
    expect(isSettling({ latestOutcome: "failed", hasCurrent: false, screenshot: null })).toBe(false);
    expect(isSettling({ latestOutcome: "ready", hasCurrent: true, screenshot: "unavailable" })).toBe(false);
  });
});
