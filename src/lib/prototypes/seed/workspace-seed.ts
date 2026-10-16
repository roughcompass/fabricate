import { eq } from "drizzle-orm";
import { generatePublicId, type PublicIdPrefix } from "@/lib/db/ids";
import type { PrototypesExecutor } from "../db/client";
import { benchmarkIntents, feedback, generations, lessonChecks, lessons, pageShells, pairwiseReviews, personas, prototypes, variants, versions, workspaces } from "../db/schema";
import { buildGate } from "../gates";
import { RUNTIME } from "../render";

/**
 * A rehearsed workspace, captured from the real pipeline (design.md, decision
 * 12), and copied into every new workspace in the transaction that creates it.
 * Every id is replaced with a fresh one, wherever it appears, so seeded
 * content is identical in every workspace and owned by it. Seeds keep source
 * code, which is recompiled when the runtime build has changed since capture.
 */

export const SEED_FORMAT = 1;

type Rows<T extends { $inferSelect: unknown }> = Omit<T["$inferSelect"], "workspaceId">[];

export interface WorkspaceSeed {
  readonly format: typeof SEED_FORMAT;
  readonly capturedAt: string;
  /** The runtime build the versions' compiled code was made for. */
  readonly runtimeHash: string;
  readonly personas: Rows<typeof personas>;
  readonly pageShell: Omit<typeof pageShells.$inferSelect, "workspaceId"> | null;
  readonly benchmarkIntents: Rows<typeof benchmarkIntents>;
  readonly generations: Rows<typeof generations>;
  readonly variants: Rows<typeof variants>;
  readonly prototypes: Rows<typeof prototypes>;
  readonly versions: Rows<typeof versions>;
  readonly feedback: Rows<typeof feedback>;
  readonly lessons: Rows<typeof lessons>;
  readonly lessonChecks: Rows<typeof lessonChecks>;
  readonly pairwiseReviews: Rows<typeof pairwiseReviews>;
}

const without = <T extends { workspaceId?: unknown }>({ workspaceId: _owner, ...rest }: T) => rest;

/**
 * Exports a workspace's Prototypes data as a seed, in the order it was made.
 * Share links, Sandbox runs, and templates aren't part of it: links and runs
 * are per visitor, and templates are shared across the deployment.
 */
export async function exportWorkspaceSeed(db: PrototypesExecutor, workspaceId: string, now = new Date()): Promise<WorkspaceSeed> {
  const byCreation = <T extends { createdAt: Date }>(rows: T[]) => [...rows].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const [shell] = await db.select().from(pageShells).where(eq(pageShells.workspaceId, workspaceId));
  const [personaRows, benchmarkRows, generationRows, variantRows, prototypeRows, versionRows, feedbackRows, lessonRows, checkRows, reviewRows] = await Promise.all([
    db.select().from(personas).where(eq(personas.workspaceId, workspaceId)),
    db.select().from(benchmarkIntents).where(eq(benchmarkIntents.workspaceId, workspaceId)),
    db.select().from(generations).where(eq(generations.workspaceId, workspaceId)),
    db.select().from(variants).where(eq(variants.workspaceId, workspaceId)),
    db.select().from(prototypes).where(eq(prototypes.workspaceId, workspaceId)),
    db.select().from(versions).where(eq(versions.workspaceId, workspaceId)),
    db.select().from(feedback).where(eq(feedback.workspaceId, workspaceId)),
    db.select().from(lessons).where(eq(lessons.workspaceId, workspaceId)),
    db.select().from(lessonChecks).where(eq(lessonChecks.workspaceId, workspaceId)),
    db.select().from(pairwiseReviews).where(eq(pairwiseReviews.workspaceId, workspaceId)),
  ]);
  return {
    format: SEED_FORMAT,
    capturedAt: now.toISOString(),
    runtimeHash: RUNTIME.hash,
    personas: byCreation(personaRows).map(without),
    pageShell: shell ? without(shell) : null,
    benchmarkIntents: [...benchmarkRows].sort((left, right) => left.position - right.position).map(without),
    generations: byCreation(generationRows).map(without),
    variants: [...variantRows].sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime()).map(without),
    prototypes: byCreation(prototypeRows).map(without),
    // Versions still being written aren't seeded.
    versions: byCreation(versionRows.filter((version) => version.status !== "pending")).map(without),
    feedback: byCreation(feedbackRows).map(without),
    lessons: byCreation(lessonRows).map(without),
    lessonChecks: byCreation(checkRows.filter((check) => check.status !== "running")).map(without),
    pairwiseReviews: byCreation(reviewRows.filter((review) => review.status !== "running")).map(without),
  };
}

const PREFIXES = new Set<string>(["per", "bmi", "gen", "var", "pro", "ver", "fbk", "lsn", "lck", "pwr"]);
const ID = /^([a-z]{3})_[a-z0-9]{16}$/;

/** Every id the seed defines, mapped to a fresh one with the same prefix. */
function freshIds(seed: WorkspaceSeed): Map<string, string> {
  const ids = new Map<string, string>();
  const rows = [seed.personas, seed.benchmarkIntents, seed.generations, seed.variants, seed.prototypes, seed.versions, seed.feedback, seed.lessons, seed.lessonChecks, seed.pairwiseReviews].flat() as { id: string }[];
  for (const { id } of rows) {
    const prefix = ID.exec(id)?.[1];
    if (prefix && PREFIXES.has(prefix)) ids.set(id, generatePublicId(prefix as PublicIdPrefix));
  }
  return ids;
}

/** Replaces every seed id wherever it appears, and turns the timestamp columns back into dates. */
function remap<T>(value: T, ids: ReadonlyMap<string, string>, key = ""): T {
  if (typeof value === "string") {
    if (ids.has(value)) return ids.get(value) as T;
    // Row timestamps are dates; timestamps inside JSON, such as a provenance's, stay strings.
    if (TIMESTAMP_COLUMNS.has(key)) return new Date(value) as T;
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => remap(entry, ids)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, remap(entry, ids, name)])) as T;
  return value;
}

const TIMESTAMP_COLUMNS = new Set(["createdAt", "updatedAt", "finishedAt", "decidedAt"]);

/** Recompiled code per captured version, for this runtime build; seeds are the same in every workspace. */
const recompiled = new Map<string, string | null>();

function compiledFor(seed: WorkspaceSeed, version: WorkspaceSeed["versions"][number]): { compiled: string | null; runtimeHash: string | null } {
  if (!version.compiled || seed.runtimeHash === RUNTIME.hash) return { compiled: version.compiled, runtimeHash: version.runtimeHash };
  const key = `${RUNTIME.hash}:${version.id}`;
  if (!recompiled.has(key)) recompiled.set(key, buildGate({ code: version.code, data: version.sampleData?.source ?? "export {};\n" }).compiled);
  return { compiled: recompiled.get(key) ?? null, runtimeHash: RUNTIME.hash };
}

/**
 * Copies a seed into a new workspace, inside the transaction that created it.
 * Timestamps are kept as captured, so every workspace shows the same history.
 */
export async function importWorkspaceSeed(tx: PrototypesExecutor, workspaceId: string, seed: WorkspaceSeed): Promise<void> {
  const ids = freshIds(seed);
  const own = <T extends object>(rows: readonly T[]) => rows.map((row) => ({ ...remap(row, ids), workspaceId }));
  if (seed.personas.length) await tx.insert(personas).values(own(seed.personas));
  if (seed.pageShell) await tx.insert(pageShells).values({ ...remap(seed.pageShell, ids), workspaceId });
  if (seed.benchmarkIntents.length) await tx.insert(benchmarkIntents).values(own(seed.benchmarkIntents));
  if (seed.generations.length) await tx.insert(generations).values(own(seed.generations));
  if (seed.variants.length) await tx.insert(variants).values(own(seed.variants));
  if (seed.prototypes.length) await tx.insert(prototypes).values(own(seed.prototypes).map((row) => ({ ...row, seeded: true, refiningGenerationId: null })));
  if (seed.versions.length) await tx.insert(versions).values(own(seed.versions.map((version) => ({ ...version, ...compiledFor(seed, version) }))));
  if (seed.feedback.length) await tx.insert(feedback).values(own(seed.feedback));
  if (seed.lessons.length) await tx.insert(lessons).values(own(seed.lessons));
  if (seed.lessonChecks.length) await tx.insert(lessonChecks).values(own(seed.lessonChecks));
  if (seed.pairwiseReviews.length) await tx.insert(pairwiseReviews).values(own(seed.pairwiseReviews));
  await tx
    .update(workspaces)
    .set({ personaCount: seed.personas.length, prototypeCount: seed.prototypes.length, lessonCount: seed.lessons.filter((lesson) => lesson.status !== "dismissed").length })
    .where(eq(workspaces.id, workspaceId));
}
