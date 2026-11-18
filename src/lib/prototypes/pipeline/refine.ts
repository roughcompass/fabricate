import { and, asc, eq, isNull } from "drizzle-orm";
import { IssueCollector, NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type PrototypesSettings, getConfig } from "@/lib/config";
import type { PrototypesExecutor } from "../db/client";
import { type GenerationHero, generations, prototypes, variants, versions } from "../db/schema";
import { applicableLessons } from "../lessons-applied";
import { NOTE_LENGTH, PrototypesLimitError } from "../limits";
import { generationConfigured } from "../models";
import { claimVariants } from "../workspace";
import { GenerationUnavailableError } from "./start";

/**
 * Starting a refinement (generation spec, "Refinements create new versions"):
 * a message on the version shown produces the next version from it. The
 * prototype is claimed in one conditional update, so only one refinement
 * runs at a time, and the daily limit is claimed in the same transaction,
 * before any model call.
 */

export function validateMessage(message: string): string {
  const issues = new IssueCollector();
  const clean = message.trim();
  if (clean.length < 3) issues.add("message", "Say what to change, such as Group by cut-off time and show the total per group.");
  else if (clean.length > NOTE_LENGTH) issues.add("message", `Use at most ${NOTE_LENGTH.toLocaleString("en-US")} characters.`);
  issues.throwIfAny();
  return clean;
}

/** With +hero+, a portal microfrontend's refinement: it keeps the lineage and names the microfrontend. */
export async function startRefinement(db: PrototypesExecutor, workspaceId: string, prototypeId: string, baseVersionId: string, message: string, settings: PrototypesSettings = getConfig().prototypes, now = new Date(), hero: GenerationHero | null = null): Promise<string> {
  const clean = validateMessage(message);
  if (!generationConfigured(settings)) throw new GenerationUnavailableError();
  const [base] = await db
    .select()
    .from(versions)
    .where(and(eq(versions.id, baseVersionId), eq(versions.prototypeId, prototypeId), eq(versions.workspaceId, workspaceId)));
  if (!base || base.status !== "ready" || !base.provenance) throw new NotFoundError("Unknown version");
  const [original] = base.generationId ? await db.select({ intent: generations.intent }).from(generations).where(eq(generations.id, base.generationId)) : [];
  const personas = base.provenance.personas;
  const lessons = await applicableLessons(db, workspaceId, personas.map((persona) => persona.id));
  const id = generatePublicId("gen");
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(prototypes)
      .set({ refiningGenerationId: id })
      .where(and(eq(prototypes.id, prototypeId), eq(prototypes.workspaceId, workspaceId), isNull(prototypes.refiningGenerationId)))
      .returning({ id: prototypes.id });
    if (!claimed) throw new PrototypesLimitError("A refinement is already running on this prototype. Send the next message when it finishes.");
    await claimVariants(tx, workspaceId, 1, settings.dailyVariantLimit, now);
    await tx.insert(generations).values({
      id,
      workspaceId,
      kind: "refine",
      intent: original?.intent ?? base.provenance!.intent,
      scope: base.scope,
      personas,
      variantCount: 1,
      lessons,
      prototypeId,
      baseVersionId: base.id,
      message: clean,
      hero,
      createdAt: now,
    });
    await tx.insert(variants).values({ id: generatePublicId("var"), workspaceId, generationId: id, position: 0, direction: base.provenance!.direction, stage: "writing", updatedAt: now });
  });
  return id;
}

export interface ThreadEntry {
  readonly generation: typeof generations.$inferSelect;
  readonly variant: typeof variants.$inferSelect | null;
  readonly version: typeof versions.$inferSelect | null;
}

/** A prototype's refinements in order, each with the version it produced, or its progress (generation spec, "Refining a version"). */
export async function refinementsOf(db: PrototypesExecutor, prototypeId: string): Promise<ThreadEntry[]> {
  const rows = await db
    .select()
    .from(generations)
    .where(and(eq(generations.prototypeId, prototypeId), eq(generations.kind, "refine")))
    .orderBy(asc(generations.createdAt));
  if (rows.length === 0) return [];
  const entries: ThreadEntry[] = [];
  for (const generation of rows) {
    const [variant] = await db.select().from(variants).where(eq(variants.generationId, generation.id));
    const [version] = variant?.versionId ? await db.select().from(versions).where(eq(versions.id, variant.versionId)) : [];
    entries.push({ generation, variant: variant ?? null, version: version ?? null });
  }
  return entries;
}
