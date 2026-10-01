import { BRAND_IDS, type BrandId, PROVIDER_IDS, type ProviderId, TEMPLATES, type Template } from "./catalog";

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
}

export const EMPTY_QUERY: GalleryQuery = { search: "", brands: [], providers: [] };

type Params = Readonly<Record<string, string | string[] | undefined>>;

const values = (params: Params, name: string) => [params[name]].flat().filter((value): value is string => typeof value === "string");

/** Reads the gallery query from the URL, ignoring unknown filter values. */
export function parseGalleryQuery(params: Params): GalleryQuery {
  const search = (values(params, "q")[0] ?? "").trim().replace(/\s+/g, " ").slice(0, SEARCH_LIMIT);
  const brands = BRAND_IDS.filter((brand) => values(params, "brand").includes(brand));
  const providers = PROVIDER_IDS.filter((provider) => values(params, "provider").includes(provider));
  return { search, brands, providers };
}

export function isFiltered(query: GalleryQuery): boolean {
  return query.search !== "" || query.brands.length > 0 || query.providers.length > 0;
}

function matchesSearch(template: Template, search: string): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return [template.title, template.description, template.author ?? "", ...template.tags].some((text) => text.toLowerCase().includes(needle));
}

function matches(template: Template, query: GalleryQuery, ignore?: "brand" | "provider"): boolean {
  return (
    matchesSearch(template, query.search) &&
    (ignore === "brand" || query.brands.length === 0 || query.brands.includes(template.brand)) &&
    (ignore === "provider" || query.providers.length === 0 || query.providers.includes(template.provider))
  );
}

/** Hero templates first, then the rest by title, so the order is the same on every visit. */
export function galleryOrder(templates: readonly Template[]): Template[] {
  return [...templates].sort((left, right) => Number(right.hero) - Number(left.hero) || left.title.localeCompare(right.title, "en"));
}

export function filterTemplates(query: GalleryQuery, templates: readonly Template[] = TEMPLATES): Template[] {
  return galleryOrder(templates.filter((template) => matches(template, query)));
}

/**
 * How many templates each option would match: the search and the other
 * group's filters apply, and the option's own group is replaced by the option.
 */
export function optionCounts(query: GalleryQuery, templates: readonly Template[] = TEMPLATES): { brand: Record<BrandId, number>; provider: Record<ProviderId, number> } {
  const brand = Object.fromEntries(BRAND_IDS.map((id) => [id, templates.filter((template) => template.brand === id && matches(template, query, "brand")).length])) as Record<BrandId, number>;
  const provider = Object.fromEntries(PROVIDER_IDS.map((id) => [id, templates.filter((template) => template.provider === id && matches(template, query, "provider")).length])) as Record<ProviderId, number>;
  return { brand, provider };
}

/** The gallery URL for a query. */
export function galleryHref(query: GalleryQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  for (const brand of query.brands) params.append("brand", brand);
  for (const provider of query.providers) params.append("provider", provider);
  return `/templates${params.size ? `?${params}` : ""}`;
}
