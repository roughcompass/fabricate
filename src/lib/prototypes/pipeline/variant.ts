import { and, eq, inArray, sql } from "drizzle-orm";
import { generatePublicId } from "@/lib/db/ids";
import { type PrototypesSettings, getConfig } from "@/lib/config";
import type { PrototypesExecutor } from "../db/client";
import { type GenerationTemplate, type TemplateSnapshot, feedback, generations, prototypes, variants, versions } from "../db/schema";
import { runGates } from "../gates";
import { countApplied } from "../lessons-applied";
import { PrototypesLimitError } from "../limits";
import { RUNTIME } from "../render";
import { recommendFixRecipes, registryRelease, saltRegistry } from "../salt/adapter";
import { KIT_VERSION } from "../salt-kit";
import { workspaceShell } from "../shell";
import { templateVersionSnapshot } from "../templates";
import { type Attempt, type Failure, type Provenance, type SampleData, type Stage, isPortalScope } from "../types";
import { claimVariants } from "../workspace";
import { VariantFailure, failureFrom } from "./errors";
import { repairPrompt, refinePrompt, writePrompt } from "./prompts";
import { NoSubmissionError, writePrototype } from "./write";

/**
 * One attempt at a variant (quality-checks spec, "Failed gates are repaired
 * automatically"): the generator writes, DE FabLab runs the four gates, and
 * the attempt is recorded. A failing attempt is followed by a repair, up to
 * the repair limit; the first attempt's results stay the version's
 * first-pass result. Each attempt is its own step, so a long repair never
 * runs into a function's time limit, and every stage is written as it
 * starts, so the variants page shows it.
 */

export type AttemptOutcome = "ready" | "retry" | "failed";

async function setStage(db: PrototypesExecutor, variantId: string, stage: Stage): Promise<void> {
  await db.update(variants).set({ stage, updatedAt: new Date() }).where(eq(variants.id, variantId));
}

/** Ends a variant as Failed with a reason the visitor can act on. */
export async function failVariant(db: PrototypesExecutor, variantId: string, failure: Failure, now = new Date()): Promise<void> {
  const [variant] = await db.update(variants).set({ status: "failed", failure, updatedAt: now }).where(eq(variants.id, variantId)).returning();
  if (variant?.versionId) await db.update(versions).set({ status: "failed" }).where(eq(versions.id, variant.versionId));
  const [generation] = variant ? await db.select().from(generations).where(eq(generations.id, variant.generationId)) : [];
  if (generation?.kind === "refine" && generation.prototypeId) {
    await db.update(prototypes).set({ refiningGenerationId: null }).where(and(eq(prototypes.id, generation.prototypeId), eq(prototypes.refiningGenerationId, generation.id)));
  }
}

interface Context {
  readonly variant: typeof variants.$inferSelect;
  readonly generation: typeof generations.$inferSelect;
  readonly version: typeof versions.$inferSelect;
  readonly data: SampleData;
  readonly base: typeof versions.$inferSelect | null;
}

async function context(db: PrototypesExecutor, variantId: string): Promise<Context | null> {
  const [variant] = await db.select().from(variants).where(eq(variants.id, variantId));
  if (!variant) throw new Error(`Unknown variant ${variantId}`);
  if (variant.status !== "running") return null;
  const [generation] = await db.select().from(generations).where(eq(generations.id, variant.generationId));
  if (!generation) throw new Error(`Unknown generation ${variant.generationId}`);
  const [base] = generation.baseVersionId ? await db.select().from(versions).where(eq(versions.id, generation.baseVersionId)) : [];
  const data = base?.sampleData ?? generation.sampleData;
  if (!data) throw new VariantFailure({ kind: "internal", message: "The generation has no sample data. Retry." });
  let version: typeof versions.$inferSelect | undefined;
  if (variant.versionId) [version] = await db.select().from(versions).where(eq(versions.id, variant.versionId));
  if (!version) {
    [version] = await db
      .insert(versions)
      .values({ id: generatePublicId("ver"), workspaceId: generation.workspaceId, generationId: generation.id, scope: generation.scope, sampleData: data, status: "pending" })
      .returning();
    await db.update(variants).set({ versionId: version!.id }).where(eq(variants.id, variantId));
  }
  return { variant, generation, version: version!, data, base: base ?? null };
}

async function firstPrompt(db: PrototypesExecutor, { generation, variant, data, base }: Context): Promise<string> {
  const shell = await workspaceShell(db, generation.workspaceId);
  // A direction of a template generation varies from the template, so it sees the template's code.
  const snapshot = generation.template ? await templateVersionSnapshot(db, generation.template.templateVersionId) : null;
  const template = generation.template && snapshot ? { title: generation.template.title, code: snapshot.code, styles: snapshot.styles ?? null } : null;
  const input = { intent: generation.intent, scope: generation.scope, personas: generation.personas, direction: variant.direction ?? base?.provenance?.direction ?? null, data, shell, template, member: generation.hero?.member ?? null, reference: generation.hero?.reference ?? null };
  if (generation.kind !== "refine" || !base) return writePrompt(input);
  const notes = await db
    .select()
    .from(feedback)
    .where(and(eq(feedback.versionId, base.id), eq(feedback.kind, "note"), eq(feedback.noteStatus, "open")));
  const given = await db
    .select()
    .from(feedback)
    .where(and(eq(feedback.versionId, base.id), inArray(feedback.kind, ["rating", "keep-reason", "discard-reason"])));
  return refinePrompt({
    ...input,
    message: generation.message ?? "",
    base: { number: base.number ?? 0, code: base.code, styles: base.styles },
    feedback: given.filter((entry) => entry.text).map((entry) => ({ kind: entry.kind, text: entry.text!, rating: entry.rating })),
    notes: notes.map((note) => ({ id: note.id, text: note.text ?? "", component: note.element?.component ?? "element", elementText: note.element?.text ?? "" })),
    violations: base.audit?.violations ?? [],
    renderError: base.renderError ?? null,
  });
}

/** Runs the variant's next attempt, and says whether it is ready, should be repaired, or has failed. */
export async function attemptVariant(db: PrototypesExecutor, variantId: string, settings: PrototypesSettings = getConfig().prototypes, now = new Date()): Promise<AttemptOutcome> {
  let ctx: Context | null;
  try {
    ctx = await context(db, variantId);
  } catch (error) {
    if (error instanceof VariantFailure) {
      await failVariant(db, variantId, error.failure);
      return "failed";
    }
    throw error;
  }
  if (!ctx) {
    const [variant] = await db.select({ status: variants.status }).from(variants).where(eq(variants.id, variantId));
    return variant?.status === "ready" ? "ready" : "failed";
  }
  const { generation, version, data } = ctx;
  if (generation.template && ctx.variant.position === 0) return templateVariant(db, ctx, generation.template, now);
  const previous = version.attempts.at(-1);
  const number = version.attempts.length + 1;

  if (previous) {
    // Repairs count toward the daily limit (availability spec, "Generation is bounded per workspace").
    try {
      await claimVariants(db, generation.workspaceId, 1, settings.dailyVariantLimit, now);
    } catch (error) {
      if (!(error instanceof PrototypesLimitError)) throw error;
      await failVariant(db, variantId, { kind: "limit", message: `The checks failed and no repair was left for today. ${error.message}`, issues: previous.gates.flatMap((gate) => gate.issues) });
      return "failed";
    }
  }
  await setStage(db, variantId, previous ? "repairing" : "writing");

  const registry = await saltRegistry();
  const release = registryRelease().release;
  let prompt = await firstPrompt(db, ctx);
  if (previous) {
    const recipes = (recommendFixRecipes(registry, version.code, release).fixes as { recommended_fix?: string }[] | undefined)?.flatMap((fix) => (fix.recommended_fix ? [fix.recommended_fix] : [])) ?? [];
    prompt = `${prompt}\n\n${repairPrompt(version.code, previous.gates, recipes, version.styles)}`;
  }

  let written;
  try {
    written = await writePrototype({ prompt, lessons: generation.lessons, portal: isPortalScope(generation.scope) }, settings);
  } catch (error) {
    if (error instanceof NoSubmissionError) {
      const attempt: Attempt = { number, gates: [], passed: false, at: now.toISOString(), signatures: ["write:no-submission"] };
      await db.update(versions).set({ attempts: [...version.attempts, attempt] }).where(eq(versions.id, version.id));
      if (number > settings.repairAttempts) {
        await failVariant(db, variantId, { kind: "internal", message: `${error.message} Retry.` });
        return "failed";
      }
      return "retry";
    }
    await failVariant(db, variantId, failureFrom(error));
    return "failed";
  }

  await setStage(db, variantId, "checking");
  const { submission, lookups } = written;
  // The CSS module the model was shown: the last attempt's, the base version's, or the attached template's. It stays unless the submission changes it, and an empty one removes it.
  const shown = previous ? version.styles : ctx.base ? ctx.base.styles : generation.template ? ((await templateVersionSnapshot(db, generation.template.templateVersionId))?.styles ?? null) : null;
  const styles = submission.styles === undefined || submission.styles === null ? shown : submission.styles.trim() ? submission.styles : null;
  // A refinement keeps its lineage, and a template generation takes its template's, so a page started from a hero may keep importing @deweb/portal.
  const hero = ctx.base?.provenance?.hero ?? generation.template?.hero ?? generation.hero?.slug ?? null;
  const run = await runGates({ code: submission.code, data: data.source, styles, portal: hero !== null });
  const attempt: Attempt = { number, gates: run.results, passed: run.passed, at: new Date().toISOString(), lookups, signatures: run.signatures };
  const attempts = [...version.attempts, attempt];
  await db
    .update(versions)
    .set({ attempts, firstPass: version.firstPass ?? [...run.results], code: submission.code, styles, title: submission.title, navItem: generation.scope === "page" ? submission.navItem : null, summary: submission.summary, addressedNotes: submission.addressedNotes })
    .where(eq(versions.id, version.id));

  if (!run.passed) {
    if (number > settings.repairAttempts) {
      await failVariant(db, variantId, { kind: "checks", message: `The checks still failed after ${settings.repairAttempts} repairs.`, issues: run.results.filter((result) => result.status === "failed").flatMap((result) => result.issues) });
      return "failed";
    }
    return "retry";
  }

  await setStage(db, variantId, "rendering");
  const provenance: Provenance = {
    model: settings.models.generate,
    personas: generation.personas,
    intent: generation.intent,
    message: generation.message,
    scope: generation.scope,
    direction: ctx.variant.direction ?? ctx.base?.provenance?.direction ?? null,
    lessons: generation.lessons,
    saltGuidance: attempts.flatMap((entry) => entry.lookups ?? []),
    saltRelease: RUNTIME.packages["@salt-ds/core"] ?? release,
    registryRelease: release,
    kitVersion: KIT_VERSION,
    parentVersionId: generation.baseVersionId,
    forkedFrom: null,
    startedFromTemplate: startedFrom(generation.template),
    hero,
    createdAt: version.createdAt.toISOString(),
  };
  await db.transaction(async (tx) => {
    await tx.update(versions).set({ status: "ready", gatesPassed: true, compiled: run.compiled, runtimeHash: RUNTIME.hash, provenance }).where(eq(versions.id, version.id));
    await countApplied(tx, generation.lessons.map((lesson) => lesson.id));
    if (generation.kind === "refine" && generation.prototypeId) await attachRefinement(tx, generation, version.id, submission.addressedNotes);
  });
  return "ready";
}

/** What every variant of a template generation records about where it started. */
function startedFrom(template: GenerationTemplate | null): Provenance["startedFromTemplate"] {
  return template ? { templateId: template.templateId, title: template.title, templateVersion: template.templateVersion } : null;
}

/**
 * Variant 0 of a template generation (generation spec, "A generation can
 * start from a template"; design decision 8 of converge-templates-and-
 * prototypes): the template's code, unchanged, with no model call and so no
 * repairs. It runs the four gates with the generation's sample data; if they
 * fail, it falls back to the template's own data and says why. It is then
 * audited and reviewed like any variant.
 */
async function templateVariant(db: PrototypesExecutor, { variant, generation, version, data }: Context, template: GenerationTemplate, now: Date): Promise<AttemptOutcome> {
  const snapshot: TemplateSnapshot | null = await templateVersionSnapshot(db, template.templateVersionId);
  if (!snapshot) {
    await failVariant(db, variant.id, { kind: "internal", message: `The template ${template.title} v${template.templateVersion} is no longer available.` });
    return "failed";
  }
  await setStage(db, variant.id, "checking");
  const portal = template.hero !== null;
  let used = data;
  let dataNote: string | null = null;
  const styles = snapshot.styles ?? null;
  let run = await runGates({ code: snapshot.code, data: data.source, styles, portal });
  if (!run.passed && snapshot.sampleData) {
    const own = await runGates({ code: snapshot.code, data: snapshot.sampleData.source, styles, portal });
    if (own.passed) {
      const failed = run.results.filter((result) => result.status === "failed").map((result) => result.gate);
      dataNote = `This generation's sample data doesn't fit the template (it fails the ${failed.join(" and ")} ${failed.length === 1 ? "check" : "checks"}), so variant 0 shows the template with its own data.`;
      used = snapshot.sampleData;
      run = own;
    }
  }
  const attempt: Attempt = { number: 1, gates: run.results, passed: run.passed, at: new Date().toISOString(), signatures: run.signatures };
  await db
    .update(versions)
    .set({ attempts: [attempt], firstPass: [...run.results], code: snapshot.code, styles, sampleData: used, title: snapshot.title, navItem: snapshot.navItem, summary: `The template ${template.title} v${template.templateVersion}, unchanged.`, addressedNotes: [] })
    .where(eq(versions.id, version.id));
  if (!run.passed) {
    await failVariant(db, variant.id, { kind: "checks", message: `The template ${template.title} v${template.templateVersion} no longer passes its checks.`, issues: run.results.filter((result) => result.status === "failed").flatMap((result) => result.issues) });
    return "failed";
  }
  await setStage(db, variant.id, "rendering");
  const release = registryRelease().release;
  const provenance: Provenance = {
    model: "none: the template, unchanged",
    personas: generation.personas,
    intent: generation.intent,
    message: null,
    scope: generation.scope,
    direction: null,
    lessons: [],
    saltGuidance: [],
    saltRelease: RUNTIME.packages["@salt-ds/core"] ?? release,
    registryRelease: release,
    kitVersion: KIT_VERSION,
    parentVersionId: null,
    forkedFrom: null,
    startedFromTemplate: startedFrom(template),
    hero: template.hero,
    dataNote,
    createdAt: (version.createdAt ?? now).toISOString(),
  };
  await db.update(versions).set({ status: "ready", gatesPassed: true, compiled: run.compiled, runtimeHash: RUNTIME.hash, provenance }).where(eq(versions.id, version.id));
  return "ready";
}

/**
 * Adds a ready refinement to its prototype as the next version (generation
 * spec, "Refinements create new versions"), marks the notes it addressed,
 * and frees the prototype for its next refinement.
 */
async function attachRefinement(tx: PrototypesExecutor, generation: typeof generations.$inferSelect, versionId: string, addressed: readonly { noteId: string; addressed: boolean }[]): Promise<void> {
  const [prototype] = await tx
    .update(prototypes)
    .set({ latestNumber: sql`${prototypes.latestNumber} + 1`, refiningGenerationId: null, updatedAt: new Date() })
    .where(eq(prototypes.id, generation.prototypeId!))
    .returning({ latestNumber: prototypes.latestNumber });
  await tx.update(versions).set({ prototypeId: generation.prototypeId, number: prototype!.latestNumber }).where(eq(versions.id, versionId));
  const noteIds = addressed.filter((entry) => entry.addressed).map((entry) => entry.noteId);
  if (noteIds.length > 0 && generation.baseVersionId) {
    await tx
      .update(feedback)
      .set({ noteStatus: "addressed", addressedByVersionId: versionId })
      .where(and(inArray(feedback.id, noteIds), eq(feedback.versionId, generation.baseVersionId), eq(feedback.noteStatus, "open")));
  }
}
