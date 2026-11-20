/*
 * Permanent redirects from addresses the product retired recently
 * (page-patterns spec, "Links open the pages they name"). next.config.ts
 * applies them before routing, so a bookmark or an old link opens the page
 * that replaced it. An address retired more than 30 days ago gets no
 * redirect and opens the not-found page. This module imports nothing,
 * because the Next.js configuration loads it.
 */

export interface Redirect {
  source: string;
  destination: string;
  permanent: true;
  has?: { type: "query"; key: string; value?: string }[];
}

const permanent = (source: string, destination: string): Redirect => ({ source, destination, permanent: true });

/** A Repository's Edit page became its Settings on 2026-11-17. */
const SETTINGS_REDIRECTS: Redirect[] = [permanent("/repositories/:id(src_[a-z0-9]{16})/edit", "/repositories/:id/settings")];

/** The Salt Patterns gallery, its templates, and their preview mode became Applications (add-applications, design decision 8). */
const TEMPLATE_REDIRECTS: Redirect[] = [permanent("/templates", "/applications"), permanent("/templates/:path*", "/applications")];

export const LEGACY_REDIRECTS: Redirect[] = [...SETTINGS_REDIRECTS, ...TEMPLATE_REDIRECTS];
