import { eq } from "drizzle-orm";
import { IssueCollector } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { type PrototypesSettings, getConfig } from "@/lib/config";
import type { PrototypesExecutor } from "../db/client";
import { type GenerationHero, type GenerationTemplate, generations, variants } from "../db/schema";
import { applicableLessons } from "../lessons-applied";
import { INTENT_LENGTH, MAX_PERSONAS_PER_INTENT, TEMPLATE_VARIANT_CHOICES, VARIANT_CHOICES } from "../limits";
import { heroSlugOf, heroSnapshot, heroTemplate } from "../heroes/use";
import { latestRechecks, templateById } from "../templates";
import { generationConfigured } from "../models";
import { personaCopies } from "../personas";
import type { Direction, SampleData, Scope } from "../types";
import { claimVariants } from "../workspace";

/**
 * Starting a generation from the composer (generation spec, "The composer
 * takes an intent, scope, personas, and variant count"). Everything that can
 * refuse the request runs first: the fields, whether generation is
 * configured here, and today's limit, which is claimed in the same
 * transaction that writes the generation, before any model is called.
 */

export interface ComposerInput {
  readonly intent: string;
  readonly scope: Scope;
  readonly personaIds: readonly string[];
  readonly variants: number;
  /** An attached template, which becomes variant 0 (generation spec, "A generation can start from a template"). */
  readonly templateId?: string | null;
}

/** Raised when no model credential is configured here (availability spec, "Generation needs a configured model credential"). */
export class GenerationUnavailableError extends Error {
  override name = "GenerationUnavailableError";

  constructor() {
    super("Generation isn't configured in this environment.");
  }
}

export function validateComposer(input: ComposerInput): ComposerInput {
  const issues = new IssueCollector();
  const intent = input.intent.trim();
  if (intent.length < INTENT_LENGTH.min) issues.add("intent", `Describe what the persona needs in at least ${INTENT_LENGTH.min} characters, such as "Review and release today's urgent payments before cut-off".`);
  else if (intent.length > INTENT_LENGTH.max) issues.add("intent", `Use at most ${INTENT_LENGTH.max.toLocaleString("en-US")} characters.`);
  if (input.scope !== "page" && input.scope !== "component") issues.add("scope", "Choose Component or Page.");
  const personaIds = [...new Set(input.personaIds)];
  if (personaIds.length > MAX_PERSONAS_PER_INTENT) issues.add("personas", `Choose at most ${MAX_PERSONAS_PER_INTENT} personas.`);
  const templateId = input.templateId || null;
  const choices: readonly number[] = templateId ? TEMPLATE_VARIANT_CHOICES : VARIANT_CHOICES;
  if (!choices.includes(input.variants)) issues.add("variants", `Choose ${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)} variants${templateId ? ", counting the template" : ""}.`);
  // A template is a page, so the generation is too.
  if (templateId && input.scope !== "page") issues.add("scope", "A generation from a template is a page.");
  issues.throwIfAny();
  return { intent, scope: input.scope, personaIds, variants: input.variants, templateId };
}

/** The attached template's latest version as the generation records it, or a refusal when it can't be used. */
export async function attachedTemplate(db: PrototypesExecutor, templateId: string): Promise<GenerationTemplate> {
  // A hero's page attaches like a template version (design decision 8 of converge-templates-and-prototypes).
  const heroSlug = heroSlugOf(templateId);
  if (heroSlug) {
    const hero = heroTemplate(heroSlug);
    if (!hero || !(await heroSnapshot(heroSlug))) {
      const issues = new IssueCollector();
      issues.add("template", "This hero template has no page to start from.");
      issues.throwIfAny();
    }
    return { templateId: hero!.id, templateVersionId: hero!.id, templateVersion: hero!.version, title: hero!.title, hero: heroSlug };
  }
  const template = await templateById(db, templateId);
  const issues = new IssueCollector();
  if (!template) issues.add("template", "The template is no longer in the gallery. Remove it, or choose another.");
  else if ((await latestRechecks(db, [template.latest.id])).get(template.latest.id)?.status === "broken") issues.add("template", "The template fails its checks on the current Salt release, so it can't be attached until a fixed version is accepted.");
  issues.throwIfAny();
  const { latest } = template!;
  return { templateId: template!.id, templateVersionId: latest.id, templateVersion: latest.number, title: latest.title, hero: latest.snapshot.provenance.hero ?? null };
}

export async function startGeneration(db: PrototypesExecutor, workspaceId: string, input: ComposerInput, settings: PrototypesSettings = getConfig().prototypes, now = new Date()): Promise<string> {
  const clean = validateComposer(input);
  if (!generationConfigured(settings)) throw new GenerationUnavailableError();
  const personas = await personaCopies(db, workspaceId, clean.personaIds);
  if (personas.length !== clean.personaIds.length) {
    const issues = new IssueCollector();
    issues.add("personas", "A chosen persona no longer exists. Choose again.");
    issues.throwIfAny();
  }
  const lessons = await applicableLessons(db, workspaceId, clean.personaIds);
  const template = clean.templateId ? await attachedTemplate(db, clean.templateId) : null;
  const id = generatePublicId("gen");
  await db.transaction(async (tx) => {
    // Variant 0 of a template generation is the template itself, with no model call, so it isn't counted.
    await claimVariants(tx, workspaceId, clean.variants - (template ? 1 : 0), settings.dailyVariantLimit, now);
    await tx.insert(generations).values({ id, workspaceId, kind: "generate", intent: clean.intent, scope: clean.scope, personas, variantCount: clean.variants, lessons, template, createdAt: now });
    await tx.insert(variants).values(Array.from({ length: clean.variants }, (_, position) => ({ id: generatePublicId("var"), workspaceId, generationId: id, position, stage: "planning" as const, updatedAt: now })));
  });
  return id;
}

/** What hero generation asks for: one part of a hero portal (converge-templates-and-prototypes, design decision 6). */
export interface HeroInput {
  readonly intent: string;
  readonly scope: "portal-member" | "portal-shell";
  readonly personaIds: readonly string[];
  /** The hero template, by slug, and the microfrontend this writes, or null for the shell. */
  readonly hero: GenerationHero;
  readonly variants?: number;
  /** A fixed direction and data, so the plan step doesn't run: the hero's shared data.ts and the version's catalog summary. */
  readonly plan?: { readonly direction: Direction; readonly sampleData: SampleData };
}

/**
 * Starts a generation of one part of a hero portal. It runs the same steps as
 * any generation, with the portal scopes the composer doesn't offer, no
 * workspace lessons, so a committed run reproduces, and `@deweb/portal`
 * allowed, since its versions start a hero lineage.
 */
export async function startHeroGeneration(db: PrototypesExecutor, workspaceId: string, input: HeroInput, settings: PrototypesSettings = getConfig().prototypes, now = new Date()): Promise<string> {
  const issues = new IssueCollector();
  if (input.intent.trim().length < INTENT_LENGTH.min) issues.add("intent", `Describe the part in at least ${INTENT_LENGTH.min} characters.`);
  if (input.scope === "portal-member" && !input.hero.member) issues.add("hero", "A microfrontend names its member id.");
  issues.throwIfAny();
  if (!generationConfigured(settings)) throw new GenerationUnavailableError();
  const personas = await personaCopies(db, workspaceId, input.personaIds);
  const count = input.variants ?? 1;
  const id = generatePublicId("gen");
  await db.transaction(async (tx) => {
    await claimVariants(tx, workspaceId, count, settings.dailyVariantLimit, now);
    const plan = input.plan ? { directions: Array.from({ length: count }, () => input.plan!.direction), sampleData: input.plan.sampleData } : {};
    await tx.insert(generations).values({ id, workspaceId, kind: "generate", intent: input.intent.trim(), scope: input.scope, personas, variantCount: count, lessons: [], hero: input.hero, ...plan, createdAt: now });
    await tx.insert(variants).values(Array.from({ length: count }, (_, position) => ({ id: generatePublicId("var"), workspaceId, generationId: id, position, stage: input.plan ? ("writing" as const) : ("planning" as const), direction: input.plan?.direction ?? null, updatedAt: now })));
  });
  return id;
}

/** Marks a generation finished: done when any variant is ready, failed when none is. */
export async function finishGeneration(db: PrototypesExecutor, generationId: string, now = new Date()): Promise<void> {
  const rows = await db.select({ status: variants.status }).from(variants).where(eq(variants.generationId, generationId));
  const status = rows.some((row) => row.status === "ready") ? "done" : "failed";
  await db.update(generations).set({ status, finishedAt: now }).where(eq(generations.id, generationId));
}
