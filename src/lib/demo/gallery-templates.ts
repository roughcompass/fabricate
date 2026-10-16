import { getDb } from "@/lib/db/client";
import { combinedRecheckStatus, controlRecheck, heroStanding, templateStanding } from "@/lib/prototypes/conformance";
import { getPrototypesDb } from "@/lib/prototypes/db/client";
import type { RecheckStatus } from "@/lib/prototypes/db/schema";
import { prototypesEnabled, templatesAvailable } from "@/lib/prototypes/guard";
import { recheckStale } from "@/lib/prototypes/rechecks";
import { dispatch } from "@/lib/prototypes/runner";
import { type AcceptedTemplate, latestRechecks, liveTemplates, templateBySlug } from "@/lib/prototypes/templates";
import { TEMPLATES } from "./catalog";
import { heroFiles, heroTemplate } from "@/lib/prototypes/heroes/use";
import { type GalleryTemplate, filterTemplates } from "./gallery";

/**
 * Every template in the Salt Patterns gallery (template-gallery spec, "The
 * catalog spans brands and providers"; design.md, decision 13): the built-in
 * catalog, and, while Prototypes is enabled, the latest version of every
 * template accepted from a prototype on this deployment, provided by
 * Community and From Prototypes. On a fresh database that is the built-in 16.
 * Seeing a template version checked against an earlier runtime build starts
 * its re-check; the gallery shows the last known status meanwhile.
 */
export async function galleryTemplates(): Promise<GalleryTemplate[]> {
  if (!prototypesEnabled()) return [...TEMPLATES];
  const db = await getPrototypesDb();
  const accepted = await liveTemplates(db);
  await recheckTemplates(accepted);
  // Standards live in SQLite, which only the deployments that offer Accept have.
  const standings = templatesAvailable() ? accepted.map((template) => templateStanding(getDb(), template.latest.standards).status) : [];
  return [...(await withHeroStandings(TEMPLATES)), ...accepted.map((template, index) => galleryCard(template, standings[index], templatesAvailable() ? recheckStatus(template) : undefined))];
}

/** Hero templates whose page is committed show "Meets selected Standards" or "Not evaluated", where Standards are; seeing one starts its Evaluation when it has none. */
async function withHeroStandings(templates: readonly GalleryTemplate[]): Promise<GalleryTemplate[]> {
  if (!templatesAvailable()) return [...templates];
  return Promise.all(
    templates.map(async (template) => {
      const hero = template.hero ? heroTemplate(template.slug) : null;
      return hero ? { ...template, standards: (await heroStanding(getDb(), hero, heroFiles(hero))).status } : template;
    }),
  );
}

/** A template's re-check status from its gates and, where Standards are, its Controls (template-conformance spec). */
export function recheckStatus(template: AcceptedTemplate): RecheckStatus | null {
  const { latest, recheck } = template;
  if (!recheck?.status) return null;
  return combinedRecheckStatus(recheck.status, controlRecheck(getDb(), latest.standards, recheck.standards));
}

export function galleryCard(template: AcceptedTemplate, standards?: GalleryTemplate["standards"], status: RecheckStatus | null = template.recheck?.status ?? null): GalleryTemplate {
  const { latest, recheck } = template;
  return {
    slug: template.slug,
    title: latest.title,
    description: latest.description,
    brand: latest.brand,
    provider: "community",
    origin: "prototypes",
    acceptedBy: latest.acceptedBy,
    templateVersion: latest.number,
    templateId: template.id,
    ...(standards && { standards }),
    recheck: recheck && status && status !== "unchanged" ? { status, saltRelease: recheck.saltRelease } : null,
    tags: latest.tags,
    hero: false,
    preview: { src: prototypeTemplateImage(template.id), alt: `${latest.title}, a page from Prototypes in the common Salt page shell` },
  };
}

/** Starts a re-check of every version of these templates that is stale for the current runtime build (design.md, decision 17). */
export async function recheckTemplates(accepted: readonly AcceptedTemplate[]): Promise<void> {
  const db = await getPrototypesDb();
  const all = accepted.flatMap((template) => template.versions);
  const rechecks = await latestRechecks(db, all.map((version) => version.id));
  await recheckStale(
    db,
    all.map((version) => ({ version, recheck: rechecks.get(version.id) ?? null })),
    (recheckId) => dispatch({ kind: "recheck", recheckId }),
  );
}

/** A template New prototype offers to start from. */
export interface TemplateMatch {
  readonly templateId: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly templateVersion: number | string;
}

export const MATCH_LIMIT = 3;

/**
 * Up to three usable templates matching an intent, by the gallery's own
 * matcher (generation spec, "New prototype shows matching templates"; design
 * decision 9): hero templates whose page is committed, and templates accepted
 * from prototypes whose latest version isn't Broken. Illustrative built-ins
 * are never offered. Empty unless the gallery is available here.
 */
export async function matchingTemplates(intent: string): Promise<TemplateMatch[]> {
  if (!intent.trim() || !templatesAvailable() || !prototypesEnabled()) return [];
  // Heroes whose page is committed, and accepted templates that aren't Broken; illustrative built-ins never.
  const usable = (await galleryTemplates()).flatMap((template): GalleryTemplate[] => {
    if (template.hero) {
      const hero = heroTemplate(template.slug);
      return hero ? [{ ...template, templateId: hero.id }] : [];
    }
    return template.origin === "prototypes" && template.templateId && template.recheck?.status !== "broken" ? [template] : [];
  });
  return filterTemplates({ search: intent, brands: [], providers: [], origins: [] }, usable)
    .slice(0, MATCH_LIMIT)
    .map((template) => ({ templateId: template.templateId!, slug: template.slug, title: template.title, description: template.description, templateVersion: template.templateVersion ?? heroTemplate(template.slug)?.version ?? 1 }));
}

/** The address of a template's preview image, captured when its latest version was accepted. */
export function prototypeTemplateImage(templateId: string): string {
  return `/api/prototypes/templates/${templateId}/preview`;
}

/** The live template accepted from a prototype with this slug, while Prototypes is enabled. Opening it starts any re-check it needs. */
export async function acceptedTemplate(slug: string): Promise<AcceptedTemplate | null> {
  if (!prototypesEnabled()) return null;
  const template = await templateBySlug(await getPrototypesDb(), slug);
  if (template) await recheckTemplates([template]);
  return template;
}
