import type { ApplicationOutcome, ScreenshotState } from "@/lib/db/schema";

/**
 * What an application shows (add-applications, design decision 1): its
 * status, from its latest attempt's outcome and whether it has a current
 * build, and its image, from its current build's screenshot. Pure, so the
 * Applications page, the application page, the status endpoint, and the
 * toolbar's context row all derive them alike.
 *
 * | Current build | Latest outcome            | Status                           | Image       |
 * |---------------|---------------------------|----------------------------------|-------------|
 * | none          | building                  | Building                         | placeholder |
 * | none          | failed / not_previewable  | Build failed / Can't be previewed| failure     |
 * | set           | ready                     | Ready                            | screenshot  |
 * | set           | building                  | Building                         | screenshot  |
 * | set           | failed / not_previewable  | Latest build failed / Latest commit can't be previewed | screenshot |
 *
 * "Screenshot" is the current build's: while it's still being captured the
 * image is `capturing`, and when it couldn't be captured, `unavailable`.
 */

export const APPLICATION_STATUSES = ["ready", "building", "build_failed", "not_previewable", "latest_build_failed", "latest_not_previewable"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Each status's text, which is always shown with its icon and tone, never by color alone.
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export const APPLICATION_STATUS_LABELS: Readonly<Record<ApplicationStatus, string>> = {
  ready: "Ready",
  building: "Building",
  build_failed: "Build failed",
  not_previewable: "Can't be previewed",
  latest_build_failed: "Latest build failed",
  latest_not_previewable: "Latest commit can't be previewed",
};

/** The Status filter's options (design decision 9): every failure, first or later, is Failed. */
export const STATUS_FILTERS = ["ready", "building", "failed"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** What the card and page show in the image area. */
export type ApplicationImage =
  /** The first build is queued or running: the building placeholder. */
  | "placeholder"
  /** No build ever succeeded and the latest failed or was refused: the failure state. */
  | "failure"
  /** The current build's screenshot. */
  | "screenshot"
  /** The current build's screenshot is being captured: the building placeholder until it's ready. */
  | "capturing"
  /** The current build's screenshot couldn't be captured: the neutral "Screenshot unavailable" image. */
  | "unavailable";

export interface StatusInput {
  readonly latestOutcome: ApplicationOutcome;
  /** Whether it has a current build. */
  readonly hasCurrent: boolean;
  /** The current build's screenshot state, or null when none was requested. */
  readonly screenshot: ScreenshotState | null;
}

export function applicationStatus(input: Pick<StatusInput, "latestOutcome" | "hasCurrent">): ApplicationStatus {
  switch (input.latestOutcome) {
    case "ready":
      return "ready";
    case "building":
      return "building";
    case "failed":
      return input.hasCurrent ? "latest_build_failed" : "build_failed";
    case "not_previewable":
      return input.hasCurrent ? "latest_not_previewable" : "not_previewable";
  }
}

export function applicationImage(input: StatusInput): ApplicationImage {
  if (!input.hasCurrent) return input.latestOutcome === "building" ? "placeholder" : "failure";
  if (input.screenshot === "ready") return "screenshot";
  if (input.screenshot === "unavailable") return "unavailable";
  return "capturing";
}

/** The Status filter option a status counts under. */
export function statusFilter(status: ApplicationStatus): StatusFilter {
  if (status === "ready" || status === "building") return status;
  return "failed";
}

/** Whether the page should keep refreshing: a build is running, or a screenshot is being captured. */
export function isSettling(input: StatusInput): boolean {
  return input.latestOutcome === "building" || applicationImage(input) === "capturing";
}
