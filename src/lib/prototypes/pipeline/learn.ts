import { generateText, Output } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ValidationError } from "@/lib/db/errors";
import { type PrototypesSettings, getConfig } from "@/lib/config";
import type { PrototypesExecutor } from "../db/client";
import { feedback, generations, type LessonCitation, lessons, personas, versions } from "../db/schema";
import { proposeLesson } from "../lessons";
import { gatewayOptions, modelFor } from "../models";
import { LESSON_CATEGORIES, type LessonScope } from "../types";
import { learnPrompt } from "./prompts";

/**
 * Proposing lessons (learning spec, "The agent proposes lessons from feedback
 * and checks"; design.md, decision 11). Text feedback (a keep or discard
 * reason, a rating's note, an element note) and failures that recur across
 * generations are the triggers; a rating alone never is, since ratings are
 * for measurement. Recurring failures are found deterministically, as the
 * same failure signature in two or more generations, and the model only
 * phrases them. A proposal that resembles an existing lesson becomes an edit
 * of it, and one that contradicts an active lesson is marked as a conflict.
 */

const LEARN_TIMEOUT_MS = 90_000;
const MAX_PROPOSALS = 3;

const proposalSchema = z.object({
  proposals: z
    .array(
      z.object({
        kind: z.enum(["new", "edit", "conflict"]),
        lessonId: z.string().nullable().optional(),
        text: z.string().max(400),
        scope: z.union([z.object({ kind: z.literal("general") }), z.object({ kind: z.literal("persona"), personaId: z.string() })]),
        category: z.enum(LESSON_CATEGORIES),
        citations: z.array(z.string()),
        failures: z.array(z.string()),
      }),
    )
    .max(MAX_PROPOSALS),
});

export interface RecurringFailure {
  readonly signature: string;
  readonly message: string;
  readonly versionIds: readonly string[];
}

/** Failure signatures seen in two or more of the workspace's generations, that no lesson cites yet. */
export async function recurringFailures(db: PrototypesExecutor, workspaceId: string): Promise<RecurringFailure[]> {
  const rows = await db.select({ id: versions.id, generationId: versions.generationId, attempts: versions.attempts }).from(versions).where(eq(versions.workspaceId, workspaceId));
  const seen = new Map<string, { generations: Set<string>; versionIds: Set<string>; message: string }>();
  for (const row of rows) {
    for (const attempt of row.attempts) {
      for (const signature of attempt.signatures ?? []) {
        if (signature.startsWith("write:")) continue;
        const entry = seen.get(signature) ?? { generations: new Set(), versionIds: new Set(), message: "" };
        entry.generations.add(row.generationId ?? row.id);
        entry.versionIds.add(row.id);
        if (!entry.message) entry.message = attempt.gates.flatMap((gate) => gate.issues).find((issue) => signature.endsWith(`${issue.code}${issue.symbol ? `:${issue.symbol}` : ""}`))?.message ?? "";
        seen.set(signature, entry);
      }
    }
  }
  const cited = new Set(
    (await db.select({ citations: lessons.citations }).from(lessons).where(eq(lessons.workspaceId, workspaceId))).flatMap((row) => row.citations.flatMap((citation) => (citation.kind === "failure" ? [citation.signature] : []))),
  );
  return [...seen.entries()].filter(([signature, entry]) => entry.generations.size >= 2 && !cited.has(signature)).map(([signature, entry]) => ({ signature, message: entry.message, versionIds: [...entry.versionIds] }));
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Proposes zero to three lessons from the given feedback and the
 * workspace's recurring failures. Returns how many were proposed. Feedback
 * with no text proposes nothing, and nothing calls the model then.
 */
export async function proposeLessons(db: PrototypesExecutor, workspaceId: string, feedbackIds: readonly string[], settings: PrototypesSettings = getConfig().prototypes): Promise<number> {
  const given = feedbackIds.length
    ? (await db.select().from(feedback).where(and(eq(feedback.workspaceId, workspaceId), inArray(feedback.id, [...feedbackIds])))).filter((entry) => entry.text?.trim())
    : [];
  const failures = await recurringFailures(db, workspaceId);
  if (given.length === 0 && failures.length === 0) return 0;
  const existing = await db.select().from(lessons).where(eq(lessons.workspaceId, workspaceId));
  const live = existing.filter((lesson) => lesson.status !== "dismissed");
  const { output } = await generateText({
    model: modelFor("learn", settings).model,
    output: Output.object({ schema: proposalSchema }),
    prompt: learnPrompt({
      feedback: given.map((entry) => ({ id: entry.id, kind: entry.kind === "note" ? "element note" : entry.kind === "rating" ? "rating note" : entry.kind.replace("-", " "), text: entry.text!, personas: entry.personas })),
      failures,
      lessons: live.map((lesson) => ({ id: lesson.id, text: lesson.text, scope: lesson.scope, category: lesson.category, status: lesson.status })),
    }),
    providerOptions: gatewayOptions(settings),
    timeout: LEARN_TIMEOUT_MS,
  });
  const people = await db.select({ id: personas.id, name: personas.name }).from(personas).where(eq(personas.workspaceId, workspaceId));
  let proposed = 0;
  for (const proposal of output.proposals.slice(0, MAX_PROPOSALS)) {
    const citations: LessonCitation[] = [
      ...proposal.citations.filter((id) => given.some((entry) => entry.id === id)).map((feedbackId) => ({ kind: "feedback" as const, feedbackId })),
      ...proposal.failures.flatMap((signature) => {
        const failure = failures.find((entry) => entry.signature === signature);
        return failure ? [{ kind: "failure" as const, signature, versionIds: failure.versionIds }] : [];
      }),
    ];
    // A proposed lesson cites what it came from (learning spec); one citing nothing it was shown is dropped.
    if (citations.length === 0) continue;
    const persona = proposal.scope.kind === "persona" ? people.find((entry) => entry.id === (proposal.scope as { personaId: string }).personaId) : undefined;
    const scope: LessonScope = persona ? { kind: "persona", personaId: persona.id, personaName: persona.name } : { kind: "general" };
    const target = proposal.lessonId ? live.find((lesson) => lesson.id === proposal.lessonId) : undefined;
    // An identical lesson becomes an edit of it, even when the model called it new.
    const twin = live.find((lesson) => normalize(lesson.text) === normalize(proposal.text));
    if (twin && twin.status === "proposed") continue;
    try {
      const created = await proposeLesson(db, workspaceId, {
        text: proposal.text,
        category: proposal.category,
        scope,
        citations,
        editsLessonId: proposal.kind === "edit" && target ? target.id : twin ? twin.id : null,
        conflictsWithLessonId: proposal.kind === "conflict" && target?.status === "active" ? target.id : null,
      });
      if (created) proposed++;
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }
  return proposed;
}

/** Whether a finished generation left a failure that now recurs, which is worth proposing a lesson for. */
export async function generationHasRecurringFailure(db: PrototypesExecutor, generationId: string): Promise<boolean> {
  const [generation] = await db.select({ workspaceId: generations.workspaceId }).from(generations).where(eq(generations.id, generationId));
  if (!generation) return false;
  const failures = await recurringFailures(db, generation.workspaceId);
  if (failures.length === 0) return false;
  const own = await db.select({ id: versions.id }).from(versions).where(eq(versions.generationId, generationId));
  return failures.some((failure) => own.some((version) => failure.versionIds.includes(version.id)));
}
