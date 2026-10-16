import { GENERATED_SOURCES } from "@/demo/runtime/generated/sources";
import { templateBySlug } from "@/lib/demo/catalog";
import type { PrototypesExecutor } from "../db/client";
import type { TemplateSnapshot } from "../db/schema";
import { type ExportedVersion, projectFiles } from "../export";
import { copyIntoPrototype, fromSnapshot } from "../fork";
import { runGates } from "../gates";
import { RUNTIME } from "../render";
import { registryRelease } from "../salt/adapter";
import { KIT_VERSION } from "../salt-kit";
import { DEFAULT_SHELL } from "../seed/defaults";
import type { SampleData } from "../types";

/**
 * A hero template's flattened page as a template (converge-templates-and-
 * prototypes, design decisions 7 and 8; template-gallery spec, "Using a hero
 * template"): Use template copies it into a new prototype without a model
 * call, Generate variations attaches it as variant 0, and its export is what
 * the hero's template Assessment reads. It's addressed as `hero:<slug>`
 * wherever an accepted template's id would be.
 */

const PREFIX = "hero:";

export function heroTemplateId(slug: string): string {
  return `${PREFIX}${slug}`;
}

/** The hero slug a template id names, or null for an accepted template's id. */
export function heroSlugOf(templateId: string | null | undefined): string | null {
  return templateId?.startsWith(PREFIX) ? templateId.slice(PREFIX.length) : null;
}

export interface HeroTemplate {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  /** The hero's catalog version, such as 3.2.0. */
  readonly version: string;
  readonly code: string;
  readonly data: SampleData;
}

/** A hero whose page the hero script has committed, or null. */
export function heroTemplate(slug: string): HeroTemplate | null {
  const template = templateBySlug(slug);
  const sources = GENERATED_SOURCES[slug];
  if (!template?.hero || !sources?.page) return null;
  return { id: heroTemplateId(slug), slug, title: template.title, version: template.version, code: sources.page, data: { description: `The records the ${template.title} hero shows.`, source: sources.data } };
}

/** What a hero's page exports as a project, the same files its download and its template Assessment read. */
export function heroExport(hero: HeroTemplate): ExportedVersion {
  return { prototypeName: hero.title, number: 1, scope: "page", title: hero.title, navItem: null, code: hero.code, data: hero.data.source, personas: [], shell: DEFAULT_SHELL };
}

export function heroFiles(hero: HeroTemplate): Record<string, string> {
  return projectFiles(heroExport(hero));
}

const snapshots = new Map<string, Promise<TemplateSnapshot | null>>();

/**
 * A hero's page as a template version's snapshot, compiled and checked for
 * the current runtime build, once per process; null when it fails a gate,
 * which a committed page never should.
 */
export function heroSnapshot(slug: string): Promise<TemplateSnapshot | null> {
  const key = `${slug}@${RUNTIME.hash}`;
  let snapshot = snapshots.get(key);
  if (!snapshot) {
    snapshot = compile(slug);
    snapshots.set(key, snapshot);
  }
  return snapshot;
}

async function compile(slug: string): Promise<TemplateSnapshot | null> {
  const hero = heroTemplate(slug);
  if (!hero) return null;
  const run = await runGates({ code: hero.code, data: hero.data.source, portal: true });
  if (!run.passed || !run.compiled) return null;
  const release = registryRelease().release;
  const createdAt = new Date(0).toISOString();
  return {
    versionId: hero.id,
    number: 1,
    prototypeName: hero.title,
    code: hero.code,
    sampleData: hero.data,
    compiled: run.compiled,
    runtimeHash: RUNTIME.hash,
    title: hero.title,
    navItem: null,
    personas: [],
    provenance: {
      model: "none: the hero template's page",
      personas: [],
      intent: `Start from the ${hero.title} hero template.`,
      message: null,
      scope: "page",
      direction: null,
      lessons: [],
      saltGuidance: [],
      saltRelease: RUNTIME.packages["@salt-ds/core"] ?? release,
      registryRelease: release,
      kitVersion: KIT_VERSION,
      parentVersionId: null,
      forkedFrom: null,
      startedFromTemplate: null,
      hero: slug,
      createdAt,
    },
    gates: run.results,
    attempts: 1,
    audit: null,
    fit: null,
  };
}

export class HeroUnavailableError extends Error {
  override name = "HeroUnavailableError";
}

/** Use template on a hero: its page, copied into a new prototype in the visitor's workspace, marked as started from the hero, with no model call. */
export async function startFromHero(db: PrototypesExecutor, workspaceId: string, slug: string, now = new Date()): Promise<string> {
  const hero = heroTemplate(slug);
  const snapshot = await heroSnapshot(slug);
  if (!hero || !snapshot) throw new HeroUnavailableError(`${slug} has no page to start from.`);
  return db.transaction((tx) => copyIntoPrototype(tx, workspaceId, hero.title, { ...fromSnapshot(snapshot), provenance: { ...snapshot.provenance, createdAt: now.toISOString() } }, { forkedFrom: null, startedFromTemplate: { templateId: hero.id, title: hero.title, templateVersion: hero.version } }, now));
}
