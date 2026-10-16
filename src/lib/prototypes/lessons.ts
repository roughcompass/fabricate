import { and, asc, eq, ne, or } from "drizzle-orm";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import type { PrototypesExecutor } from "./db/client";
import { type LessonCitation, lessons, personas } from "./db/schema";
import { LESSON_LENGTH, LESSON_LIMIT } from "./limits";
import { LESSON_CATEGORIES, type LessonCategory, type LessonScope } from "./types";
import { claimSlot, releaseSlot } from "./workspace";

/**
 * The lesson library (learning spec, "Lessons are visible and under the
 * visitor's control"): proposed lessons wait for the visitor; active ones
 * apply to every later generation they are scoped to; turned-off ones apply
 * to none. A proposal may be an edit of a lesson, or contradict one, and
 * accepting it updates or turns off that lesson.
 */

export type Lesson = typeof lessons.$inferSelect;

/** One imperative sentence of at most 280 characters, with a known category (learning spec, "Every lesson is short, scoped, categorized, and cited"). */
export function validateLesson(text: string, category: string): { text: string; category: LessonCategory } {
  const issues = new IssueCollector();
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) issues.add("text", "Write the lesson as one sentence, such as Always show amounts with currency codes, right-aligned.");
  else if (clean.length > LESSON_LENGTH) issues.add("text", `Keep a lesson to ${LESSON_LENGTH} characters.`);
  else if (/[.!?]\s+[A-Z]/.test(clean)) issues.add("text", "Write one sentence; split other advice into its own lesson.");
  if (!(LESSON_CATEGORIES as readonly string[]).includes(category)) issues.add("category", "Choose a category.");
  issues.throwIfAny();
  return { text: clean, category: category as LessonCategory };
}

/** A lesson scope from a form: general, or one of the workspace's personas. */
export async function scopeFor(db: PrototypesExecutor, workspaceId: string, value: string): Promise<LessonScope> {
  if (!value || value === "general") return { kind: "general" };
  const [persona] = await db
    .select({ id: personas.id, name: personas.name })
    .from(personas)
    .where(and(eq(personas.workspaceId, workspaceId), eq(personas.id, value)));
  if (!persona) {
    const issues = new IssueCollector();
    issues.add("scope", "That persona no longer exists. Choose again.");
    issues.throwIfAny();
  }
  return { kind: "persona", personaId: persona!.id, personaName: persona!.name };
}

export async function listLessons(db: PrototypesExecutor, workspaceId: string): Promise<Lesson[]> {
  return db.select().from(lessons).where(and(eq(lessons.workspaceId, workspaceId), ne(lessons.status, "dismissed"))).orderBy(asc(lessons.createdAt));
}

async function own(db: PrototypesExecutor, workspaceId: string, lessonId: string): Promise<Lesson> {
  const [lesson] = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.workspaceId, workspaceId), eq(lessons.id, lessonId)));
  if (!lesson) throw new NotFoundError("Unknown lesson");
  return lesson;
}

const full = `A workspace can hold ${LESSON_LIMIT} lessons. Delete one to add another.`;

/** Adds a lesson written directly; it is active at once (learning spec, "Writing a lesson directly"). */
export async function addLesson(db: PrototypesExecutor, workspaceId: string, input: { text: string; category: string; scope: LessonScope }, now = new Date()): Promise<Lesson> {
  const clean = validateLesson(input.text, input.category);
  return db.transaction(async (tx) => {
    await claimSlot(tx, workspaceId, "lessonCount", LESSON_LIMIT, full);
    const [lesson] = await tx
      .insert(lessons)
      .values({ id: generatePublicId("lsn"), workspaceId, ...clean, scope: input.scope, status: "active", source: "visitor", citations: [], createdAt: now, updatedAt: now })
      .returning();
    return lesson!;
  });
}

/** Records a lesson the agent proposed; it applies to nothing until accepted. */
export async function proposeLesson(
  db: PrototypesExecutor,
  workspaceId: string,
  input: { text: string; category: string; scope: LessonScope; citations: readonly LessonCitation[]; editsLessonId?: string | null; conflictsWithLessonId?: string | null },
  now = new Date(),
): Promise<Lesson | null> {
  const clean = validateLesson(input.text, input.category);
  return db.transaction(async (tx) => {
    try {
      await claimSlot(tx, workspaceId, "lessonCount", LESSON_LIMIT, full);
    } catch {
      return null;
    }
    const [lesson] = await tx
      .insert(lessons)
      .values({ id: generatePublicId("lsn"), workspaceId, ...clean, scope: input.scope, status: "proposed", source: "agent", citations: input.citations, editsLessonId: input.editsLessonId ?? null, conflictsWithLessonId: input.conflictsWithLessonId ?? null, createdAt: now, updatedAt: now })
      .returning();
    return lesson!;
  });
}

/**
 * Accepts a proposal, with the visitor's edits. An edit proposal updates the
 * lesson it names and goes away; a conflicting one becomes active and turns
 * the lesson it contradicts off (learning spec, "Proposed lessons don't
 * duplicate or silently contradict").
 */
export async function acceptLesson(db: PrototypesExecutor, workspaceId: string, lessonId: string, edited?: { text: string; category: string; scope: LessonScope }, now = new Date()): Promise<Lesson> {
  return db.transaction(async (tx) => {
    const lesson = await own(tx, workspaceId, lessonId);
    if (lesson.status !== "proposed") throw new NotFoundError("This lesson isn't waiting to be accepted.");
    const clean = edited ? { ...validateLesson(edited.text, edited.category), scope: edited.scope } : { text: lesson.text, category: lesson.category, scope: lesson.scope };
    if (lesson.editsLessonId) {
      const [target] = await tx
        .update(lessons)
        .set({ ...clean, citations: [...(await own(tx, workspaceId, lesson.editsLessonId)).citations, ...lesson.citations], updatedAt: now })
        .where(and(eq(lessons.workspaceId, workspaceId), eq(lessons.id, lesson.editsLessonId)))
        .returning();
      await tx.delete(lessons).where(eq(lessons.id, lesson.id));
      await releaseSlot(tx, workspaceId, "lessonCount");
      return target!;
    }
    if (lesson.conflictsWithLessonId) await tx.update(lessons).set({ status: "off", updatedAt: now }).where(and(eq(lessons.workspaceId, workspaceId), eq(lessons.id, lesson.conflictsWithLessonId)));
    const [accepted] = await tx.update(lessons).set({ ...clean, status: "active", updatedAt: now }).where(eq(lessons.id, lesson.id)).returning();
    return accepted!;
  });
}

/** Dismisses a proposal; it no longer counts toward the workspace's lessons. */
export async function dismissLesson(db: PrototypesExecutor, workspaceId: string, lessonId: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const lesson = await own(tx, workspaceId, lessonId);
    if (lesson.status !== "proposed") throw new NotFoundError("This lesson isn't waiting to be accepted.");
    await tx.update(lessons).set({ status: "dismissed", updatedAt: now }).where(eq(lessons.id, lesson.id));
    await releaseSlot(tx, workspaceId, "lessonCount");
  });
}

export async function editLesson(db: PrototypesExecutor, workspaceId: string, lessonId: string, input: { text: string; category: string; scope: LessonScope }, now = new Date()): Promise<Lesson> {
  const clean = validateLesson(input.text, input.category);
  await own(db, workspaceId, lessonId);
  const [lesson] = await db.update(lessons).set({ ...clean, scope: input.scope, updatedAt: now }).where(eq(lessons.id, lessonId)).returning();
  return lesson!;
}

/** Turns a lesson off, so generations started afterward don't apply it, or on again (learning spec, "Turning a lesson off"). */
export async function setLessonActive(db: PrototypesExecutor, workspaceId: string, lessonId: string, active: boolean, now = new Date()): Promise<Lesson> {
  const lesson = await own(db, workspaceId, lessonId);
  if (lesson.status !== "active" && lesson.status !== "off") throw new NotFoundError("Accept the lesson first.");
  const [updated] = await db.update(lessons).set({ status: active ? "active" : "off", updatedAt: now }).where(eq(lessons.id, lessonId)).returning();
  return updated!;
}

/** Deletes a lesson; versions that applied it keep their copy of it. */
export async function deleteLesson(db: PrototypesExecutor, workspaceId: string, lessonId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const lesson = await own(tx, workspaceId, lessonId);
    await tx.delete(lessons).where(eq(lessons.id, lesson.id));
    // A proposal that edits or contradicts it is about nothing now.
    await tx.update(lessons).set({ editsLessonId: null, conflictsWithLessonId: null }).where(and(eq(lessons.workspaceId, workspaceId), or(eq(lessons.editsLessonId, lesson.id), eq(lessons.conflictsWithLessonId, lesson.id))));
    if (lesson.status !== "dismissed") await releaseSlot(tx, workspaceId, "lessonCount");
  });
}
