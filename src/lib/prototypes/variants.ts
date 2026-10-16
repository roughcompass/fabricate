import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type PrototypesSettings, getConfig } from "@/lib/config";
import type { PrototypesExecutor } from "./db/client";
import { feedback, generations, prototypes, variants, versions } from "./db/schema";
import { NOTE_LENGTH, PROTOTYPE_LIMIT, PrototypesLimitError } from "./limits";
import { failVariant } from "./pipeline/variant";
import { finishGeneration } from "./pipeline/start";
import { claimSlot, claimVariants } from "./workspace";

/**
 * A generation's variants after they are written (versions spec, "Keeping a
 * variant creates a prototype"): keep one as a prototype at version 1,
 * discard it, either with an optional reason, or retry a failed one.
 */

export type Generation = typeof generations.$inferSelect;
export type Variant = typeof variants.$inferSelect;
export type VariantVersion = typeof versions.$inferSelect;

export interface GenerationView {
  readonly generation: Generation;
  readonly variants: readonly { readonly variant: Variant; readonly version: VariantVersion | null; readonly prototypeId: string | null }[];
}

/** A running variant that hasn't moved in this long has stopped, such as when the server restarted under it. */
export const STALLED_MS = 10 * 60 * 1000;

/**
 * Ends variants that stopped without finishing as Failed, with Retry
 * (generation spec, "Failed generations are explained"), so a generation
 * never stays in progress forever. Runs when the generation is read.
 */
export async function failStalledVariants(db: PrototypesExecutor, generationIds: readonly string[], now = new Date()): Promise<void> {
  if (generationIds.length === 0) return;
  const stalled = await db
    .select({ id: variants.id, generationId: variants.generationId })
    .from(variants)
    .where(and(inArray(variants.generationId, [...generationIds]), eq(variants.status, "running"), lt(variants.updatedAt, new Date(now.getTime() - STALLED_MS))));
  for (const variant of stalled) await failVariant(db, variant.id, { kind: "internal", message: "Generation stopped before it finished, for example because the server restarted. Retry." }, now);
  for (const generationId of new Set(stalled.map((variant) => variant.generationId))) {
    const [left] = await db.select({ id: variants.id }).from(variants).where(and(eq(variants.generationId, generationId), eq(variants.status, "running"))).limit(1);
    if (!left) await finishGeneration(db, generationId, now);
  }
}

/** What a variant is called: its direction's title, or, for variant 0 of a template generation, the template's. */
export function variantTitle(generation: Pick<typeof generations.$inferSelect, "template">, variant: Pick<typeof variants.$inferSelect, "direction" | "position">, index = variant.position): string {
  if (generation.template && variant.position === 0) return `${generation.template.title} (template)`;
  return variant.direction?.title ?? `Variant ${index + 1}`;
}

/** The sentence under a variant's title: its direction, or, for variant 0, that it is the template unchanged. */
export function variantSentence(generation: Pick<typeof generations.$inferSelect, "template">, variant: Pick<typeof variants.$inferSelect, "direction" | "position">): string | null {
  if (generation.template && variant.position === 0) return `The template ${generation.template.title} v${generation.template.templateVersion}, unchanged. The other variants each vary one thing from it.`;
  return variant.direction?.sentence ?? null;
}

export async function getGeneration(db: PrototypesExecutor, workspaceId: string, generationId: string): Promise<GenerationView> {
  await failStalledVariants(db, [generationId]);
  const [generation] = await db
    .select()
    .from(generations)
    .where(and(eq(generations.workspaceId, workspaceId), eq(generations.id, generationId)));
  if (!generation) throw new NotFoundError("Unknown generation");
  const rows = await db.select().from(variants).where(eq(variants.generationId, generationId)).orderBy(asc(variants.position));
  const made = await db.select().from(versions).where(eq(versions.generationId, generationId));
  return {
    generation,
    variants: rows.map((variant) => {
      const version = made.find((entry) => entry.id === variant.versionId) ?? null;
      return { variant, version, prototypeId: version?.prototypeId ?? null };
    }),
  };
}

/** A fingerprint of the generation's progress, which the page polls to know when to refresh. */
export function progressVersion(view: GenerationView): string {
  return [view.generation.status, ...view.variants.map(({ variant, version }) => `${variant.stage}:${variant.status}:${variant.decision ?? ""}:${version?.status ?? ""}:${version?.fit ? "fit" : ""}`)].join("|");
}

function validReason(reason: string): string | null {
  const clean = reason.trim();
  if (clean.length > NOTE_LENGTH) {
    const issues = new IssueCollector();
    issues.add("reason", `Keep the reason to ${NOTE_LENGTH.toLocaleString("en-US")} characters.`);
    issues.throwIfAny();
  }
  return clean || null;
}

async function ownVariant(db: PrototypesExecutor, workspaceId: string, variantId: string): Promise<{ variant: Variant; version: VariantVersion | null }> {
  const [variant] = await db
    .select()
    .from(variants)
    .where(and(eq(variants.workspaceId, workspaceId), eq(variants.id, variantId)));
  if (!variant) throw new NotFoundError("Unknown variant");
  const [version] = variant.versionId ? await db.select().from(versions).where(eq(versions.id, variant.versionId)) : [];
  return { variant, version: version ?? null };
}

/** Keeps a ready variant as a new prototype at version 1; a variant is kept at most once. Returns the prototype and the feedback the reason became. */
export async function keepVariant(db: PrototypesExecutor, workspaceId: string, variantId: string, reason: string, now = new Date()): Promise<{ prototypeId: string; feedbackId: string | null }> {
  const clean = validReason(reason);
  return db.transaction(async (tx) => {
    const { variant, version } = await ownVariant(tx, workspaceId, variantId);
    if (!version || version.status !== "ready") throw new PrototypesLimitError("Only a ready variant can be kept.");
    const [generation] = await tx.select({ template: generations.template }).from(generations).where(eq(generations.id, variant.generationId));
    if (version.prototypeId) return { prototypeId: version.prototypeId, feedbackId: null };
    const [claimed] = await tx
      .update(variants)
      .set({ decision: "kept", decisionReason: clean, decidedAt: now, updatedAt: now })
      .where(and(eq(variants.id, variantId), isNull(variants.decision)))
      .returning({ id: variants.id });
    if (!claimed) throw new PrototypesLimitError("This variant was already kept or discarded.");
    await claimSlot(tx, workspaceId, "prototypeCount", PROTOTYPE_LIMIT, `A workspace can hold ${PROTOTYPE_LIMIT} prototypes. Delete one to keep another.`);
    const prototypeId = generatePublicId("pro");
    await tx.insert(prototypes).values({ id: prototypeId, workspaceId, name: generation?.template && variant.position === 0 ? generation.template.title : (variant.direction?.title ?? (version.title || "Untitled prototype")), scope: version.scope, generationId: variant.generationId, latestNumber: 1, createdAt: now, updatedAt: now });
    await tx.update(versions).set({ prototypeId, number: 1 }).where(eq(versions.id, version.id));
    const feedbackId = clean ? generatePublicId("fbk") : null;
    if (feedbackId) await tx.insert(feedback).values({ id: feedbackId, workspaceId, kind: "keep-reason", versionId: version.id, variantId, prototypeId, personas: version.provenance?.personas ?? [], text: clean, createdAt: now });
    return { prototypeId, feedbackId };
  });
}

/** Hides a variant, recording the reason as feedback (learning spec, "Discard reason"). */
export async function discardVariant(db: PrototypesExecutor, workspaceId: string, variantId: string, reason: string, now = new Date()): Promise<string | null> {
  const clean = validReason(reason);
  return db.transaction(async (tx) => {
    const { variant, version } = await ownVariant(tx, workspaceId, variantId);
    const [claimed] = await tx
      .update(variants)
      .set({ decision: "discarded", decisionReason: clean, decidedAt: now, updatedAt: now })
      .where(and(eq(variants.id, variantId), isNull(variants.decision)))
      .returning({ id: variants.id });
    if (!claimed) throw new PrototypesLimitError("This variant was already kept or discarded.");
    if (!clean) return null;
    const id = generatePublicId("fbk");
    const [generation] = await tx.select({ personas: generations.personas }).from(generations).where(eq(generations.id, variant.generationId));
    await tx.insert(feedback).values({ id, workspaceId, kind: "discard-reason", versionId: version?.id ?? null, variantId, personas: version?.provenance?.personas ?? generation?.personas ?? [], text: clean, createdAt: now });
    return id;
  });
}

/**
 * Starts a failed variant again from its first attempt (generation spec,
 * "Failed generations are explained"). A retry counts toward the daily
 * limit, claimed before any model call.
 */
export async function retryVariant(db: PrototypesExecutor, workspaceId: string, variantId: string, settings: PrototypesSettings = getConfig().prototypes, now = new Date()): Promise<string> {
  return db.transaction(async (tx) => {
    const { variant } = await ownVariant(tx, workspaceId, variantId);
    if (variant.status !== "failed") throw new PrototypesLimitError("Only a failed variant can be retried.");
    await claimVariants(tx, workspaceId, 1, settings.dailyVariantLimit, now);
    await tx.update(variants).set({ status: "running", stage: "writing", failure: null, versionId: null, updatedAt: now }).where(eq(variants.id, variantId));
    await tx.update(generations).set({ status: "running", finishedAt: null }).where(eq(generations.id, variant.generationId));
    return variant.generationId;
  });
}

export interface OpenGeneration {
  readonly generation: Generation;
  readonly running: number;
  /** Ready variants not yet kept or discarded. */
  readonly undecided: number;
  readonly failed: number;
  readonly total: number;
}

/**
 * Generations that still need the visitor (versions spec, "Keeping a variant
 * creates a prototype"): running, or with ready variants nobody has kept or
 * discarded, or that failed outright, newest first. A generation makes no
 * prototype until a variant is kept, so the Prototypes list shows these too.
 */
export async function openGenerations(db: PrototypesExecutor, workspaceId: string, limit = 10): Promise<OpenGeneration[]> {
  const recent = await db
    .select()
    .from(generations)
    .where(and(eq(generations.workspaceId, workspaceId), eq(generations.kind, "generate")))
    .orderBy(desc(generations.createdAt))
    .limit(30);
  if (recent.length === 0) return [];
  await failStalledVariants(db, recent.filter((generation) => generation.status === "running").map((generation) => generation.id));
  const rows = await db.select().from(variants).where(inArray(variants.generationId, recent.map((generation) => generation.id)));
  return recent
    .map((generation) => {
      const own = rows.filter((row) => row.generationId === generation.id);
      return {
        generation,
        running: own.filter((row) => row.status === "running").length,
        undecided: own.filter((row) => row.status === "ready" && !row.decision).length,
        failed: own.filter((row) => row.status === "failed" && !row.decision).length,
        total: own.length,
      };
    })
    // A generation whose every variant failed stays listed, so its reason isn't lost.
    .filter((entry) => entry.running > 0 || entry.undecided > 0 || (entry.total > 0 && entry.failed === entry.total))
    .slice(0, limit);
}

/**
 * Deletes a generation and the variants nobody kept, with their versions.
 * Prototypes kept from it stay, with their versions, and only lose the link
 * back to the variants; feedback and the lessons it taught stay too. A
 * generation still running can't be deleted, and refinements and lesson
 * checks are deleted with their prototype or workspace, not on their own.
 */
export async function deleteGeneration(db: PrototypesExecutor, workspaceId: string, generationId: string, now = new Date()): Promise<void> {
  await failStalledVariants(db, [generationId], now);
  await db.transaction(async (tx) => {
    const [generation] = await tx
      .select()
      .from(generations)
      .where(and(eq(generations.workspaceId, workspaceId), eq(generations.id, generationId)));
    if (!generation || generation.kind !== "generate") throw new NotFoundError("Unknown generation");
    if (generation.status === "running") throw new PrototypesLimitError("This generation is still running. Delete it once it finishes.");
    await tx.delete(versions).where(and(eq(versions.generationId, generationId), isNull(versions.prototypeId)));
    await tx.update(prototypes).set({ generationId: null }).where(eq(prototypes.generationId, generationId));
    await tx.delete(generations).where(eq(generations.id, generationId));
  });
}
