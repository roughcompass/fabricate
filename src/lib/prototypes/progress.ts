import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { PrototypesExecutor } from "./db/client";
import { feedback, generations, versions } from "./db/schema";

/**
 * Progress across generations (learning spec, "The Lessons page records
 * progress per generation" and "The progress summary compares early and
 * recent generations"). Each measure is what was recorded, never a claim of
 * improvement.
 */

export const PROGRESS_LIMIT = 30;
export const SUMMARY_SIZE = 5;

export interface ProgressRow {
  readonly generationId: string;
  readonly kind: "generate" | "refine";
  readonly intent: string;
  readonly createdAt: Date;
  /** Whether every finished version passed the gates on its first attempt; null with no finished version. */
  readonly firstPass: boolean | null;
  readonly repairs: number;
  readonly fit: number | null;
  readonly rating: number | null;
  readonly lessons: number;
}

export interface ProgressSummary {
  readonly enough: boolean;
  readonly earliest: Measures | null;
  readonly latest: Measures | null;
}

export interface Measures {
  /** The share of generations that passed the gates on the first attempt, from 0 to 1. */
  readonly firstPassRate: number | null;
  readonly repairs: number;
  readonly fit: number | null;
  readonly rating: number | null;
  readonly lessons: number;
}

const mean = (values: readonly number[]) => (values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null);

export async function progressRows(db: PrototypesExecutor, workspaceId: string): Promise<ProgressRow[]> {
  const rows = await db
    .select()
    .from(generations)
    // Lesson checks generate with and without lessons on purpose, so they aren't progress.
    .where(and(eq(generations.workspaceId, workspaceId), inArray(generations.status, ["done", "failed"]), ne(generations.kind, "lesson-check")))
    .orderBy(asc(generations.createdAt));
  const recent = rows.slice(-PROGRESS_LIMIT);
  if (recent.length === 0) return [];
  const made = await db.select().from(versions).where(inArray(versions.generationId, recent.map((row) => row.id)));
  const ratings = await db
    .select({ versionId: feedback.versionId, rating: feedback.rating })
    .from(feedback)
    .where(and(eq(feedback.kind, "rating"), inArray(feedback.versionId, made.length ? made.map((version) => version.id) : [""])));
  return recent.map((generation) => {
    const own = made.filter((version) => version.generationId === generation.id && version.attempts.length > 0);
    const finished = own.filter((version) => version.status === "ready");
    const fits = finished.flatMap((version) => (version.fitAverage === null ? [] : [version.fitAverage]));
    const rated = finished.flatMap((version) => ratings.filter((entry) => entry.versionId === version.id && entry.rating !== null).map((entry) => entry.rating!));
    return {
      generationId: generation.id,
      kind: generation.kind === "refine" ? "refine" : "generate",
      intent: generation.message ?? generation.intent,
      createdAt: generation.createdAt,
      firstPass: own.length ? own.every((version) => version.attempts[0]?.passed === true) : null,
      repairs: own.reduce((sum, version) => sum + Math.max(0, version.attempts.length - 1), 0),
      fit: mean(fits),
      rating: mean(rated),
      lessons: generation.lessons.length,
    };
  });
}

function measures(rows: readonly ProgressRow[]): Measures {
  const passes = rows.flatMap((row) => (row.firstPass === null ? [] : [row.firstPass ? 1 : 0]));
  return {
    firstPassRate: mean(passes),
    repairs: mean(rows.map((row) => row.repairs)) ?? 0,
    fit: mean(rows.flatMap((row) => (row.fit === null ? [] : [row.fit]))),
    rating: mean(rows.flatMap((row) => (row.rating === null ? [] : [row.rating]))),
    lessons: mean(rows.map((row) => row.lessons)) ?? 0,
  };
}

/** The earliest five generations against the latest five; with fewer than six, not enough data yet. */
export function progressSummary(rows: readonly ProgressRow[]): ProgressSummary {
  if (rows.length < SUMMARY_SIZE + 1) return { enough: false, earliest: null, latest: null };
  return { enough: true, earliest: measures(rows.slice(0, SUMMARY_SIZE)), latest: measures(rows.slice(-SUMMARY_SIZE)) };
}
