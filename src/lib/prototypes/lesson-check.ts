import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { type PrototypesSettings, getConfig } from "@/lib/config";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import type { PrototypesExecutor } from "./db/client";
import { benchmarkIntents, generations, lessonChecks, lessons, variants, versions } from "./db/schema";
import { applicableLessons } from "./lessons-applied";
import { INTENT_LENGTH, PrototypesLimitError } from "./limits";
import { generationConfigured } from "./models";
import { personaCopies } from "./personas";
import { judgePair } from "./pipeline/pairwise";
import { GenerationUnavailableError } from "./pipeline/start";
import type { LessonCopy, PairwiseVerdict, Scope } from "./types";
import { claimVariants } from "./workspace";

/**
 * Lesson checks (learning spec, "A lesson check measures whether lessons
 * help" and "Benchmark intents are workspace data"; design.md, decision 11).
 * For each of the workspace's benchmark intents, one variant is generated with
 * the active lessons that apply to it and one with none, through the same
 * generate steps as any generation, and each pair is judged pairwise. Three
 * pairs are evidence, not proof, and the result says what was measured.
 */

export type LessonCheck = typeof lessonChecks.$inferSelect;
export type BenchmarkIntent = typeof benchmarkIntents.$inferSelect;
type Winner = "with" | "without" | "undecided";

/** Variants a lesson check generates per benchmark intent: one with lessons, one without. */
export const VARIANTS_PER_INTENT = 2;

export async function listBenchmarks(db: PrototypesExecutor, workspaceId: string): Promise<BenchmarkIntent[]> {
  return db.select().from(benchmarkIntents).where(eq(benchmarkIntents.workspaceId, workspaceId)).orderBy(asc(benchmarkIntents.position));
}

/** Replaces a benchmark intent. Earlier lesson checks keep the copy of the intents they used. */
export async function updateBenchmark(db: PrototypesExecutor, workspaceId: string, benchmarkId: string, input: { intent: string; scope: string; personaIds: readonly string[] }, now = new Date()): Promise<void> {
  const issues = new IssueCollector();
  const intent = input.intent.trim().replace(/\s+/g, " ");
  if (intent.length < INTENT_LENGTH.min) issues.add("intent", `Describe the benchmark in at least ${INTENT_LENGTH.min} characters.`);
  else if (intent.length > INTENT_LENGTH.max) issues.add("intent", `Use at most ${INTENT_LENGTH.max.toLocaleString("en-US")} characters.`);
  if (input.scope !== "page" && input.scope !== "component") issues.add("scope", "Choose Component or Page.");
  const personaIds = [...new Set(input.personaIds)];
  if (personaIds.length > 3) issues.add("personas", "Choose at most 3 personas.");
  issues.throwIfAny();
  const found = await personaCopies(db, workspaceId, personaIds);
  const [updated] = await db
    .update(benchmarkIntents)
    .set({ intent, scope: input.scope as Scope, personaIds: found.map((persona) => persona.id), updatedAt: now })
    .where(and(eq(benchmarkIntents.id, benchmarkId), eq(benchmarkIntents.workspaceId, workspaceId)))
    .returning({ id: benchmarkIntents.id });
  if (!updated) throw new NotFoundError("Unknown benchmark intent");
}

/** The workspace's lesson check that is still running, if any; only one runs at a time. */
export async function runningLessonCheck(db: PrototypesExecutor, workspaceId: string): Promise<LessonCheck | null> {
  const [row] = await db
    .select()
    .from(lessonChecks)
    .where(and(eq(lessonChecks.workspaceId, workspaceId), eq(lessonChecks.status, "running")));
  return row ?? null;
}

/**
 * Starts a lesson check, taking its variants from today's allowance before
 * any model is called, and copying the intents and lessons it uses. Returns
 * the check's id.
 */
export async function startLessonCheck(db: PrototypesExecutor, workspaceId: string, settings: PrototypesSettings = getConfig().prototypes, now = new Date()): Promise<string> {
  if (!generationConfigured(settings)) throw new GenerationUnavailableError();
  if (await runningLessonCheck(db, workspaceId)) throw new PrototypesLimitError("A lesson check is already running. Start another when it finishes.");
  const active = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.workspaceId, workspaceId), eq(lessons.status, "active")))
    .orderBy(asc(lessons.createdAt));
  if (active.length === 0) throw new PrototypesLimitError("There are no active lessons to check. Accept or add a lesson first.");
  const benchmarks = await listBenchmarks(db, workspaceId);
  if (benchmarks.length === 0) throw new PrototypesLimitError("This workspace has no benchmark intents.");
  const intents = await Promise.all(benchmarks.map(async (benchmark) => ({ intent: benchmark.intent, scope: benchmark.scope, personas: await personaCopies(db, workspaceId, benchmark.personaIds) })));
  const used: LessonCopy[] = active.map((lesson) => ({ id: lesson.id, text: lesson.text, scope: lesson.scope, category: lesson.category }));
  const id = generatePublicId("lck");
  await db.transaction(async (tx) => {
    await claimVariants(tx, workspaceId, intents.length * VARIANTS_PER_INTENT, settings.dailyVariantLimit, now);
    await tx.insert(lessonChecks).values({ id, workspaceId, lessons: used, intents, createdAt: now });
    for (const [index, intent] of intents.entries()) {
      const applied = await applicableLessons(tx, workspaceId, intent.personas.map((persona) => persona.id));
      for (const withLessons of [true, false]) {
        const generationId = generatePublicId("gen");
        // A millisecond apart, so the pairs keep the benchmarks' order.
        const at = new Date(now.getTime() + index * 2 + (withLessons ? 0 : 1));
        await tx.insert(generations).values({ id: generationId, workspaceId, kind: "lesson-check", intent: intent.intent, scope: intent.scope, personas: intent.personas, variantCount: 1, lessons: withLessons ? applied : [], lessonCheckId: id, withLessons, createdAt: at });
        await tx.insert(variants).values({ id: generatePublicId("var"), workspaceId, generationId, position: 0, stage: "planning", updatedAt: at });
      }
    }
  });
  return id;
}

/** The check's generations, in benchmark order, with lessons first in each pair. */
export async function lessonCheckGenerations(db: PrototypesExecutor, checkId: string): Promise<string[]> {
  const rows = await db.select({ id: generations.id }).from(generations).where(eq(generations.lessonCheckId, checkId)).orderBy(asc(generations.createdAt));
  return rows.map((row) => row.id);
}

/** One pair's winner across its personas: a side wins only when every persona's verdict agrees on it. */
export function pairWinner(verdicts: readonly PairwiseVerdict[]): Winner {
  const winners = new Set(verdicts.map((verdict) => verdict.winner));
  if (winners.size !== 1) return "undecided";
  const [only] = [...winners];
  return only === "a" ? "with" : only === "b" ? "without" : "undecided";
}

/**
 * Judges each finished pair and stores the result. A side that failed its
 * checks loses to one that passed; when both fail, the pair is undecided.
 */
export async function judgeLessonCheck(db: PrototypesExecutor, checkId: string, settings: PrototypesSettings = getConfig().prototypes, now = new Date()): Promise<void> {
  const [check] = await db.select().from(lessonChecks).where(eq(lessonChecks.id, checkId));
  if (!check || check.status !== "running") return;
  const made = await db.select().from(generations).where(eq(generations.lessonCheckId, checkId)).orderBy(asc(generations.createdAt));
  const results = made.length ? await db.select().from(versions).where(inArray(versions.generationId, made.map((generation) => generation.id))) : [];
  try {
    const pairs: NonNullable<LessonCheck["result"]>["pairs"] = [];
    for (const [index, intent] of check.intents.entries()) {
      const side = (withLessons: boolean) => {
        const generation = made.filter((entry) => entry.withLessons === withLessons)[index];
        const version = results.find((entry) => entry.generationId === generation?.id && entry.status === "ready") ?? null;
        return { generation, version };
      };
      const withSide = side(true);
      const withoutSide = side(false);
      const withGates = withSide.version ? withSide.version.gatesPassed : withSide.generation ? false : null;
      const withoutGates = withoutSide.version ? withoutSide.version.gatesPassed : withoutSide.generation ? false : null;
      let winner: Winner = "undecided";
      if (withSide.version && withoutSide.version) {
        winner = pairWinner(await judgePair(intent.intent, intent.personas, { number: 2, name: "with lessons", code: withSide.version.code }, { number: 1, name: "without lessons", code: withoutSide.version.code }, settings));
      } else if (withGates && !withoutGates) winner = "with";
      else if (withoutGates && !withGates) winner = "without";
      pairs.push({ intent: intent.intent, withVersionId: withSide.version?.id ?? null, withoutVersionId: withoutSide.version?.id ?? null, winner, withGates, withoutGates });
    }
    const count = (winner: Winner) => pairs.filter((pair) => pair.winner === winner).length;
    await db.update(lessonChecks).set({ status: "done", result: { won: count("with"), lost: count("without"), undecided: count("undecided"), pairs }, finishedAt: now }).where(eq(lessonChecks.id, checkId));
  } catch (error) {
    await db.update(lessonChecks).set({ status: "failed", error: { kind: "model", message: `The pairwise review failed: ${error instanceof Error ? error.message : String(error)}. Run the check again.` }, finishedAt: now }).where(eq(lessonChecks.id, checkId));
  }
}

/** The workspace's lesson checks, newest first. */
export async function listLessonChecks(db: PrototypesExecutor, workspaceId: string): Promise<LessonCheck[]> {
  return db.select().from(lessonChecks).where(eq(lessonChecks.workspaceId, workspaceId)).orderBy(desc(lessonChecks.createdAt));
}

/** How a result reads, such as "With lessons: won 2, lost 0, undecided 1". */
export function lessonCheckSummary(result: NonNullable<LessonCheck["result"]>): string {
  return `With lessons: won ${result.won}, lost ${result.lost}, undecided ${result.undecided}`;
}
