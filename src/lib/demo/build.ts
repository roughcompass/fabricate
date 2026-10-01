import type { StageScript } from "./catalog";

/**
 * Progress of a simulated build, as a pure function of when it was created,
 * its stage script, and whether it was skipped (design.md, decision 5). The
 * server and the browser compute the same answer, so reloading the page never
 * restarts a build. No module here touches Node or the database.
 */

export type StageState = "done" | "active" | "pending";

export interface StageProgress {
  readonly name: string;
  readonly state: StageState;
  /** Milliseconds from the start of the build. */
  readonly startMs: number;
  readonly durationMs: number;
  /** The log lines visible so far: the first when a stage starts, all of them when it finishes. */
  readonly lines: readonly string[];
}

export interface BuildProgress {
  readonly status: "building" | "ready";
  readonly stages: readonly StageProgress[];
  /** Index of the active stage, or the number of stages once ready. */
  readonly current: number;
  readonly elapsedMs: number;
  readonly totalMs: number;
  /** When the build finished or will finish, in epoch milliseconds. */
  readonly readyAt: number;
  readonly skipped: boolean;
}

export function buildProgress(script: readonly StageScript[], createdAt: number, now: number, skippedAt: number | null = null): BuildProgress {
  const totalMs = script.reduce((total, stage) => total + stage.durationMs, 0);
  const skipped = skippedAt !== null && skippedAt - createdAt < totalMs;
  const finishedAt = skipped ? skippedAt : createdAt + totalMs;
  const elapsedMs = Math.max(0, Math.min(now, finishedAt) - createdAt);
  const ready = now >= finishedAt;

  let offset = 0;
  let current = script.length;
  const stages = script.map((stage, index): StageProgress => {
    const startMs = offset;
    offset += stage.durationMs;
    const state: StageState = ready || elapsedMs >= offset ? "done" : elapsedMs >= startMs ? "active" : "pending";
    if (state === "active") current = index;
    const lines = state === "done" ? stage.lines : state === "active" ? stage.lines.slice(0, 1) : [];
    return { name: stage.name, state, startMs, durationMs: stage.durationMs, lines };
  });

  return { status: ready ? "ready" : "building", stages, current: ready ? script.length : current, elapsedMs: ready ? totalMs : elapsedMs, totalMs, readyAt: finishedAt, skipped };
}
