import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import type { PrototypesExecutor } from "./db/client";
import { feedback, versions } from "./db/schema";
import { NOTE_LENGTH } from "./limits";
import type { NotedElement, NoteStatus } from "./types";

/**
 * Feedback on versions (learning spec, "Feedback is recorded with its
 * context"): ratings with an optional note, which a later rating of the same
 * version replaces, and notes pinned to an element of the preview, open
 * until a refinement addresses them. Every record keeps the version's
 * personas as they read when it was given.
 */

export type Feedback = typeof feedback.$inferSelect;

async function readyVersion(db: PrototypesExecutor, workspaceId: string, versionId: string) {
  const [version] = await db
    .select()
    .from(versions)
    .where(and(eq(versions.workspaceId, workspaceId), eq(versions.id, versionId)));
  if (!version || version.status !== "ready") throw new NotFoundError("Unknown version");
  return version;
}

function validNote(text: string, required: boolean): string | null {
  const issues = new IssueCollector();
  const clean = text.trim();
  if (required && !clean) issues.add("note", "Write the note.");
  if (clean.length > NOTE_LENGTH) issues.add("note", `Keep the note to ${NOTE_LENGTH.toLocaleString("en-US")} characters.`);
  issues.throwIfAny();
  return clean || null;
}

/** Rates a version from 1 to 5 with an optional note; rating it again replaces the earlier rating (learning spec, "Versions can be rated with a note"). */
export async function rateVersion(db: PrototypesExecutor, workspaceId: string, versionId: string, rating: number, note: string, now = new Date()): Promise<Feedback> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    const issues = new IssueCollector();
    issues.add("rating", "Choose a rating from 1 to 5.");
    issues.throwIfAny();
  }
  const text = validNote(note, false);
  const version = await readyVersion(db, workspaceId, versionId);
  const values = { id: generatePublicId("fbk"), workspaceId, kind: "rating" as const, versionId, prototypeId: version.prototypeId, personas: version.provenance?.personas ?? [], rating, text, createdAt: now };
  const [row] = await db
    .insert(feedback)
    .values(values)
    .onConflictDoUpdate({ target: feedback.versionId, targetWhere: sql`kind = 'rating'`, set: { rating, text, createdAt: now } })
    .returning();
  return row!;
}

/** Pins a note to an element of a version's preview (learning spec, "Element notes are tracked until addressed"). */
export async function addNote(db: PrototypesExecutor, workspaceId: string, versionId: string, text: string, element: NotedElement, now = new Date()): Promise<Feedback> {
  const clean = validNote(text, true)!;
  const version = await readyVersion(db, workspaceId, versionId);
  const [row] = await db
    .insert(feedback)
    .values({ id: generatePublicId("fbk"), workspaceId, kind: "note", versionId, prototypeId: version.prototypeId, personas: version.provenance?.personas ?? [], text: clean, element, noteStatus: "open", createdAt: now })
    .returning();
  return row!;
}

/** Marks a note resolved, or opens it again. */
export async function setNoteStatus(db: PrototypesExecutor, workspaceId: string, noteId: string, status: Extract<NoteStatus, "open" | "resolved">): Promise<Feedback> {
  const [row] = await db
    .update(feedback)
    .set({ noteStatus: status })
    .where(and(eq(feedback.workspaceId, workspaceId), eq(feedback.id, noteId), eq(feedback.kind, "note")))
    .returning();
  if (!row) throw new NotFoundError("Unknown note");
  return row;
}

/** A version's feedback, oldest first, and the notes later refinements addressed. */
export async function feedbackFor(db: PrototypesExecutor, versionId: string): Promise<Feedback[]> {
  return db.select().from(feedback).where(eq(feedback.versionId, versionId)).orderBy(asc(feedback.createdAt));
}

/** The ratings of these versions, by version. */
export async function ratingsOf(db: PrototypesExecutor, versionIds: readonly string[]): Promise<Map<string, number>> {
  if (versionIds.length === 0) return new Map();
  const rows = await db
    .select({ versionId: feedback.versionId, rating: feedback.rating })
    .from(feedback)
    .where(and(eq(feedback.kind, "rating"), inArray(feedback.versionId, [...versionIds])));
  return new Map(rows.flatMap((row) => (row.versionId && row.rating ? [[row.versionId, row.rating] as const] : [])));
}
