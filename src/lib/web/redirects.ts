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
 * Portal's pages, its Drafts and revisions included, open its Navigation
 * page; a Web Application's open its dashboard; the catalogs and reviews open
 * Applications or Navigation. The demo's create page and its BitBucket
 * import open Add application. Specific addresses come before the catalogs
 * that contain them.
 */
export const ONBOARDING_REDIRECTS: Redirect[] = [
  permanent("/onboarding/portals/:id(ptl_[a-z0-9]+|new)/:rest*", "/navigation/:id"),
  permanent("/onboarding/portals", "/navigation"),
  permanent("/onboarding/reviews/:rest*", "/navigation"),
  permanent("/onboarding/applications/:id(wap_[a-z0-9]+|sea_[a-z0-9]+|new)/:rest*", "/applications/:id"),
  permanent("/onboarding/applications", "/applications?portal=all"),
  permanent("/onboarding/microfrontends/:rest*", "/applications?portal=all"),
  permanent("/onboarding", "/applications"),
  permanent("/applications/import/:rest*", "/applications/new"),
  permanent("/new/:rest*", "/applications/new"),
];

export const LEGACY_REDIRECTS: Redirect[] = [...VOCABULARY_REDIRECTS, ...ONBOARDING_REDIRECTS];
