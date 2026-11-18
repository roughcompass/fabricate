import { generateText, Output } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type PrototypesSettings, getConfig } from "@/lib/config";
import type { PrototypesExecutor } from "../db/client";
import { generations, variants, versions } from "../db/schema";
import { gatewayOptions, modelFor } from "../models";
import { CRITERIA, type CriterionId, type FitReview, type PersonaReview, type Score } from "../types";
import { failureFrom } from "./errors";
import { reviewPrompt } from "./prompts";

/**
 * The persona-fit review (quality-checks spec; design.md, decision 10): a
 * model from a different provider than the generator scores each persona's
 * four criteria and three to five checks derived from the intent, from 1 to
 * 5 or Unknown, with strengths and gaps. It reads the code, so it is
 * advisory and never a gate.
 */

const REVIEW_TIMEOUT_MS = 120_000;
const score = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal("unknown")]);
const scored = z.object({ score, reason: z.string().max(400) });
const criterionIds = CRITERIA.map((criterion) => criterion.id) as [CriterionId, ...CriterionId[]];

const reviewSchema = z.object({
  personas: z.array(
    z.object({
      personaId: z.string(),
      personaName: z.string(),
      criteria: z.object({ intent: scored, goals: scored, constraints: scored, clarity: scored }),
      checks: z.array(scored.extend({ check: z.string().max(160) })).min(3).max(5),
      strengths: z.array(z.object({ text: z.string().max(300), element: z.string().max(120).nullable() })).max(6),
      gaps: z.array(z.object({ text: z.string().max(300), element: z.string().max(120).nullable(), criterion: z.enum(criterionIds).nullable() })).max(6),
    }),
  ),
});

/** The mean of every known score, criteria and checks, across personas; null when every score is Unknown (spec, "Unknown score"). */
export function averageFit(personas: readonly PersonaReview[]): number | null {
  const known = personas.flatMap((persona) => [...Object.values(persona.criteria), ...persona.checks].map((entry) => entry.score)).filter((value): value is Exclude<Score, "unknown"> => value !== "unknown");
  return known.length ? Math.round((known.reduce((sum, value) => sum + value, 0) / known.length) * 100) / 100 : null;
}

/** Reviews a ready version against its personas; with none, it is not applicable and no model is called. */
export async function reviewVersion(db: PrototypesExecutor, versionId: string, settings: PrototypesSettings = getConfig().prototypes, now = new Date()): Promise<FitReview> {
  const [version] = await db.select().from(versions).where(eq(versions.id, versionId));
  if (!version || version.status !== "ready" || !version.provenance) throw new Error(`Version ${versionId} isn't ready for review`);
  const { personas, intent, scope, direction } = version.provenance;
  const { model, id } = modelFor("review", settings);
  let fit: FitReview;
  if (personas.length === 0) {
    fit = { status: "not-applicable", model: null, personas: [], average: null, at: now.toISOString() };
  } else {
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: reviewSchema }),
        prompt: reviewPrompt({ intent, scope, personas, direction, code: version.code, data: version.sampleData?.source ?? "", styles: version.styles }),
        providerOptions: gatewayOptions(settings),
        timeout: REVIEW_TIMEOUT_MS,
      });
      // Every persona the version was generated for gets a review, matched by id; the model can't add or drop one.
      const reviewed = personas.flatMap((persona) => {
        const entry = output.personas.find((candidate) => candidate.personaId === persona.id) ?? output.personas.find((candidate) => candidate.personaName === persona.name);
        return entry ? [{ ...entry, personaId: persona.id, personaName: persona.name }] : [];
      });
      fit = reviewed.length ? { status: "reviewed", model: id, personas: reviewed, average: averageFit(reviewed), at: now.toISOString() } : { status: "failed", model: id, personas: [], average: null, at: now.toISOString(), error: "The review didn't cover the version's personas." };
    } catch (error) {
      fit = { status: "failed", model: id, personas: [], average: null, at: now.toISOString(), error: failureFrom(error).message };
    }
  }
  await db.update(versions).set({ fit, fitAverage: fit.average }).where(eq(versions.id, versionId));
  return fit;
}

/** The review stage of a variant: its version is reviewed, and the variant is then ready. */
export async function reviewVariant(db: PrototypesExecutor, variantId: string, settings: PrototypesSettings = getConfig().prototypes): Promise<void> {
  const [variant] = await db.select().from(variants).where(eq(variants.id, variantId));
  if (!variant?.versionId || variant.status !== "running") return;
  await db.update(variants).set({ stage: "reviewing", updatedAt: new Date() }).where(eq(variants.id, variantId));
  await reviewVersion(db, variant.versionId, settings);
  await db.update(variants).set({ status: "ready", updatedAt: new Date() }).where(eq(variants.id, variantId));
  const [generation] = await db.select({ kind: generations.kind }).from(generations).where(eq(generations.id, variant.generationId));
  if (generation?.kind === "refine") await db.update(variants).set({ decision: "kept", decidedAt: new Date() }).where(eq(variants.id, variantId));
}
