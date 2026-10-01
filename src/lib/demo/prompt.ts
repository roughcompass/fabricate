import { BITBUCKET_HOST } from "./bitbucket";
import { TEMPLATES, type Template } from "./catalog";
import { DEFAULT_PROJECT, findRepository } from "./catalog/repositories";
import { EMPTY_QUERY, SEARCH_LIMIT, galleryHref, galleryOrder } from "./gallery";

/**
 * The create page's prompt bar and quick-start chips (template-gallery spec,
 * design.md decision 17). A description opens the gallery searched for it; a
 * URL of a repository in the demo's BitBucket opens its import form, under
 * Applications; any other URL is refused.
 */

export type PromptRoute = { readonly kind: "redirect"; readonly href: string } | { readonly kind: "error"; readonly message: string };

const URL_LIKE = /^(https?:\/\/|[a-z0-9-]+(\.[a-z0-9-]+)+\/)/i;
const REPOSITORY_PATH = /^\/projects\/([A-Z][A-Z0-9]{1,9})\/repos\/([a-z][a-z0-9-]*[a-z0-9])\/?(browse\/?)?$/;

/** The import form for one repository, in the Applications section (deployments spec). */
export function importHref(project: string, repository: string): string {
  return `/applications/import/${encodeURIComponent(project)}/${encodeURIComponent(repository)}`;
}

/** The Import from BitBucket page with a project chosen; the default project needs no parameter. */
export function importPageHref(project: string = DEFAULT_PROJECT): string {
  return project === DEFAULT_PROJECT ? "/applications/import" : `/applications/import?${new URLSearchParams({ project })}`;
}

function parseUrl(text: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

export function routePrompt(input: string): PromptRoute {
  const text = input.trim().replace(/\s+/g, " ");
  if (!text) return { kind: "error", message: "Describe what you want to build, or paste a repository URL." };
  if (!URL_LIKE.test(text) || text.includes(" ")) return { kind: "redirect", href: galleryHref({ ...EMPTY_QUERY, search: text.slice(0, SEARCH_LIMIT) }) };

  const url = parseUrl(text);
  if (!url || url.hostname.toLowerCase() !== BITBUCKET_HOST) return { kind: "error", message: `Only repositories in the demo's BitBucket, ${BITBUCKET_HOST}, can be imported.` };
  const match = REPOSITORY_PATH.exec(url.pathname);
  if (!match) return { kind: "error", message: `Paste a repository URL such as https://${BITBUCKET_HOST}/projects/PAY/repos/payee-hub.` };
  const [, project, repository] = match;
  if (!findRepository(project!, repository!)) return { kind: "error", message: `The demo's BitBucket has no repository ${project}/${repository}.` };
  return { kind: "redirect", href: importHref(project!, repository!) };
}

export const CHIP_COUNT = 4;

/** The number of chip sets the catalog fills. */
export function chipSetCount(templates: readonly Template[] = TEMPLATES): number {
  return Math.max(1, Math.ceil(templates.length / CHIP_COUNT));
}

/** Reads the chip set from the URL; anything unknown is the first set. */
export function parseChipSet(value: string | string[] | undefined, templates: readonly Template[] = TEMPLATES): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const number = raw && /^\d{1,3}$/.test(raw) ? Number(raw) : 0;
  return number % chipSetCount(templates);
}

/** Four templates for a chip set, in the gallery's fixed order, wrapping at the end of the catalog. */
export function chipTemplates(set: number, templates: readonly Template[] = TEMPLATES): Template[] {
  const ordered = galleryOrder(templates);
  return Array.from({ length: Math.min(CHIP_COUNT, ordered.length) }, (_, index) => ordered[(set * CHIP_COUNT + index) % ordered.length]!);
}

export function nextChipSet(set: number, templates: readonly Template[] = TEMPLATES): number {
  return (set + 1) % chipSetCount(templates);
}
