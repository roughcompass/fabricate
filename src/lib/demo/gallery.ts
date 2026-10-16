import { BRAND_IDS, type BrandId, ORIGIN_IDS, type OriginId, PROVIDER_IDS, type ProviderId, TEMPLATES } from "./catalog";
import type { RecheckStatus } from "@/lib/prototypes/db/schema";

/** The gallery's origins (template-gallery spec): Built-in, and From Prototypes for templates accepted from a prototype. */
export const ORIGINS: Readonly<Record<OriginId, { id: OriginId; label: string }>> = {
  "built-in": { id: "built-in", label: "Built-in" },
  prototypes: { id: "prototypes", label: "From Prototypes" },
};

/** A card in the gallery: a built-in template, or one accepted from a prototype, which is always provided by Community. */
export interface GalleryTemplate {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly brand: BrandId;
  readonly provider: ProviderId;
  readonly origin: OriginId;
  /** Shown for community templates. */
  readonly author?: string;
  /** Who accepted a template from a prototype: a workspace's display name, or "Anonymous visitor", shown as unverified. */
  readonly acceptedBy?: string;
  /** A template from a prototype's latest template version. */
  readonly templateVersion?: number;
  /** A template from a prototype's id, which New prototype attaches. */
  readonly templateId?: string;
  /** Its latest re-check, when it isn't Unchanged. */
  readonly recheck?: { readonly status: Exclude<RecheckStatus, "unchanged">; readonly saltRelease: string } | null;
  /** A template from a prototype's standing against the Releases its latest version was accepted against. */
  readonly standards?: "meets" | "gaps" | "not_evaluated";
  readonly tags: readonly string[];
  readonly hero: boolean;
  readonly preview: { readonly src: string; readonly alt: string };
}

/**
 * Search and filters for the Start with a template gallery (template-gallery
 * spec). Search matches title, description, tags, and author; options within a
 * filter group combine with OR, and groups and the search combine with AND.
 */

export const SEARCH_LIMIT = 100;

export interface GalleryQuery {
  readonly search: string;
  readonly brands: readonly BrandId[];
  readonly providers: readonly ProviderId[];
  readonly origins: readonly OriginId[];
}

export const EMPTY_QUERY: GalleryQuery = { search: "", brands: [], providers: [], origins: [] };

type Params = Readonly<Record<string, string | string[] | undefined>>;

const values = (params: Params, name: string) => [params[name]].flat().filter((value): value is string => typeof value === "string");

/** Reads the gallery query from the URL, ignoring unknown filter values. */
export function parseGalleryQuery(params: Params): GalleryQuery {
  const search = (values(params, "q")[0] ?? "").trim().replace(/\s+/g, " ").slice(0, SEARCH_LIMIT);
  const brands = BRAND_IDS.filter((brand) => values(params, "brand").includes(brand));
  const providers = PROVIDER_IDS.filter((provider) => values(params, "provider").includes(provider));
  const origins = ORIGIN_IDS.filter((origin) => values(params, "origin").includes(origin));
  return { search, brands, providers, origins };
}

export function isFiltered(query: GalleryQuery): boolean {
  return query.search !== "" || query.brands.length > 0 || query.providers.length > 0 || query.origins.length > 0;
}

/** Words too common to say what a description is about. */
const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "our", "your", "their", "them", "they", "its", "but", "not", "can", "are", "was", "has", "have", "like", "just", "more", "less", "than", "then", "app", "apps", "page", "pages", "build", "make", "want", "need", "new", "show", "some", "any", "all", "who", "what", "when", "where", "which", "how", "use", "using"]);

/** The words of a search that say what it's about: lowercased, without surrounding punctuation, at least three characters, and not filler. */
export function searchWords(search: string): string[] {
  const words = search
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return [...new Set(words)];
}

/**
 * How well a template matches a search: how many of its words appear in the
 * template's title, description, tags, or author, case-insensitively. A
 * search with no such words, such as "a", matches as one phrase. The gallery
 * and New prototype both match with this (converge-templates-and-prototypes,
 * design decision 9).
 */
export function searchScore(template: GalleryTemplate, search: string): number {
  const fields = [template.title, template.description, template.author ?? "", template.acceptedBy ?? "", ...template.tags].map((text) => text.toLowerCase());
  const words = searchWords(search);
  if (words.length === 0) return fields.some((text) => text.includes(search.trim().toLowerCase())) ? 1 : 0;
  return words.filter((word) => fields.some((text) => text.includes(word))).length;
}

function matchesSearch(template: GalleryTemplate, search: string): boolean {
  return !search || searchScore(template, search) > 0;
}

function matches(template: GalleryTemplate, query: GalleryQuery, ignore?: "brand" | "provider" | "origin"): boolean {
  return (
    matchesSearch(template, query.search) &&
    (ignore === "brand" || query.brands.length === 0 || query.brands.includes(template.brand)) &&
    (ignore === "provider" || query.providers.length === 0 || query.providers.includes(template.provider)) &&
    (ignore === "origin" || query.origins.length === 0 || query.origins.includes(template.origin))
  );
}

/** Hero templates first, then the rest by title, so the order is the same on every visit. */
export function galleryOrder<T extends GalleryTemplate>(templates: readonly T[]): T[] {
  return [...templates].sort((left, right) => Number(right.hero) - Number(left.hero) || left.title.localeCompare(right.title, "en"));
}

/** The templates a query matches; with a search, those matching more of its words come first. */
export function filterTemplates(query: GalleryQuery, templates: readonly GalleryTemplate[] = TEMPLATES): GalleryTemplate[] {
  const matched = galleryOrder(templates.filter((template) => matches(template, query)));
  return query.search ? [...matched].sort((left, right) => searchScore(right, query.search) - searchScore(left, query.search)) : matched;
}

/**
 * How many templates each option would match: the search and the other
 * group's filters apply, and the option's own group is replaced by the option.
 */
export function optionCounts(query: GalleryQuery, templates: readonly GalleryTemplate[] = TEMPLATES): { brand: Record<BrandId, number>; provider: Record<ProviderId, number>; origin: Record<OriginId, number> } {
  const brand = Object.fromEntries(BRAND_IDS.map((id) => [id, templates.filter((template) => template.brand === id && matches(template, query, "brand")).length])) as Record<BrandId, number>;
  const provider = Object.fromEntries(PROVIDER_IDS.map((id) => [id, templates.filter((template) => template.provider === id && matches(template, query, "provider")).length])) as Record<ProviderId, number>;
  const origin = Object.fromEntries(ORIGIN_IDS.map((id) => [id, templates.filter((template) => template.origin === id && matches(template, query, "origin")).length])) as Record<OriginId, number>;
  return { brand, provider, origin };
}

/** The gallery URL for a query. */
export function galleryHref(query: GalleryQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  for (const brand of query.brands) params.append("brand", brand);
  for (const provider of query.providers) params.append("provider", provider);
  for (const origin of query.origins) params.append("origin", origin);
  return `/templates${params.size ? `?${params}` : ""}`;
}
