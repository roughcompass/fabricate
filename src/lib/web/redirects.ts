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

/**
 * Web Onboarding's addresses (make-applications-first-class task 1.3): a
 * Portal's pages, its Drafts and revisions included, open its Portal page; a
 * Web Application's open its dashboard; the catalogs and reviews open
 * Applications or the Portals page. The demo's create page and its BitBucket
 * import open Add application. Specific addresses come before the catalogs
 * that contain them.
 */
export const ONBOARDING_REDIRECTS: Redirect[] = [
  permanent("/onboarding/portals/:id(ptl_[a-z0-9]+|new)/:rest*", "/portals/:id"),
  permanent("/onboarding/portals", "/portals"),
  permanent("/onboarding/reviews/:rest*", "/portals"),
  permanent("/onboarding/applications/:id(wap_[a-z0-9]+|sea_[a-z0-9]+|new)/:rest*", "/applications/:id"),
  permanent("/onboarding/applications", "/applications?portal=all"),
  permanent("/onboarding/microfrontends/:rest*", "/applications?portal=all"),
  permanent("/onboarding", "/applications"),
  permanent("/applications/import/:rest*", "/applications/new"),
  permanent("/new/:rest*", "/applications/new"),
];

/**
 * The Navigation section's addresses (runtime-configuration spec, "Old
 * Navigation addresses redirect"): each Portal page moved under /portals, and
 * its configuration sections left the editor for pages of their own.
 */
export const NAVIGATION_REDIRECTS: Redirect[] = [
  permanent("/navigation/:id(ptl_[a-z0-9]+)/editor/configuration/:section", "/portals/:id/configuration/:section"),
  permanent("/navigation/:id(ptl_[a-z0-9]+)/editor/configuration", "/portals/:id/configuration/brand"),
  permanent("/navigation/:id(ptl_[a-z0-9]+)/editor/:rest*", "/portals/:id/editor/:rest*"),
  permanent("/navigation/:id(ptl_[a-z0-9]+|new)/:rest*", "/portals/:id/:rest*"),
  permanent("/navigation", "/portals"),
];

export const LEGACY_REDIRECTS: Redirect[] = [...VOCABULARY_REDIRECTS, ...ONBOARDING_REDIRECTS, ...NAVIGATION_REDIRECTS];
