import { and, eq, inArray, sql } from "drizzle-orm";
import type { PrototypesExecutor } from "./db/client";
import { lessons } from "./db/schema";
import type { LessonCopy } from "./types";

/**
 * The lessons a generation applies (generation spec, "Active lessons apply to
 * every generation"): every active lesson that is general or tied to one of
 * its personas, as it reads when the generation starts.
 */
export async function applicableLessons(db: PrototypesExecutor, workspaceId: string, personaIds: readonly string[]): Promise<LessonCopy[]> {
  const active = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.workspaceId, workspaceId), eq(lessons.status, "active")))
    .orderBy(lessons.createdAt);
  return active
    .filter((lesson) => lesson.scope.kind === "general" || personaIds.includes(lesson.scope.personaId))
    .map((lesson) => ({ id: lesson.id, text: lesson.text, scope: lesson.scope, category: lesson.category }));
}

/** Counts a version against each lesson it applied (learning spec, "how many versions applied it"). */
export async function countApplied(db: PrototypesExecutor, lessonIds: readonly string[]): Promise<void> {
  if (lessonIds.length === 0) return;
  await db
    .update(lessons)
    .set({ appliedCount: sql`${lessons.appliedCount} + 1` })
    .where(inArray(lessons.id, [...lessonIds]));
}
