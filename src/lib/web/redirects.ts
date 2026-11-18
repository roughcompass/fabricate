/*
 * Permanent redirects from addresses the product no longer serves
 * (page-patterns spec, "Every link opens the page it names"). next.config.ts
 * applies them before routing, so a bookmark or an old link opens the page
 * that replaced it. This module imports nothing, because the Next.js
 * configuration loads it.
 */

export interface Redirect {
  source: string;
  destination: string;
  permanent: true;
  has?: { type: "query"; key: string; value?: string }[];
}

const permanent = (source: string, destination: string): Redirect => ({ source, destination, permanent: true });

/**
 * Addresses from before the interface vocabulary changed. Old Assessment
 * pages are told apart from the new ones by their public ID prefix: a model
 * Assessment (asm_) is now a Run, while /assessments/ini_… is an Assessment.
 */
export const VOCABULARY_REDIRECTS: Redirect[] = [
  permanent("/initiatives/new", "/assessments/new"),
  permanent("/initiatives/:id(ini_[a-z0-9]{16})/:rest*", "/assessments/:id/:rest*"),
  permanent("/assessments/:id(asm_[a-z0-9]{16})/:rest*", "/runs/:id/:rest*"),
  permanent("/sources/:rest*", "/repositories/:rest*"),
];

/** A Repository's Edit page became its Settings. */
export const SETTINGS_REDIRECTS: Redirect[] = [permanent("/repositories/:id(src_[a-z0-9]{16})/edit", "/repositories/:id/settings")];

export const LEGACY_REDIRECTS: Redirect[] = [...VOCABULARY_REDIRECTS, ...SETTINGS_REDIRECTS];
