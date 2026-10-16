import { type GalleryQuery, type GalleryTemplate, filterTemplates, galleryOrder } from "@/lib/demo/gallery";
import { galleryTemplates } from "@/lib/demo/gallery-templates";
import { demoEnabled } from "@/lib/demo/guard";
import { type Starter, starters } from "./starters";
import { STARTER_KINDS, STARTER_KIND_LABELS, type StarterKind } from "./vocabulary";

/*
 * The full catalog Add application's Browse all opens (application-creation
 * spec, "Browse all opens the full catalog on a full page"; design decision
 * 4): every starter, then, while the demo is enabled, every Salt Patterns
 * template. A starter is shown as a gallery card of brand Other and provider
 * DE Web, so the gallery's own search and filters serve both, with a Kind
 * facet beside them. Salt Patterns templates are web applications.
 */

export interface CatalogEntry extends GalleryTemplate {
  kind: StarterKind;
  /** The starter's own entry, or null for a Salt Patterns template. */
  starter: Starter | null;
}

export function starterEntry(starter: Starter): CatalogEntry {
  return {
    slug: starter.slug,
    title: starter.title,
    description: starter.description,
    brand: "other",
    provider: "de-web",
    origin: "built-in",
    tags: [STARTER_KIND_LABELS[starter.kind]],
    hero: false,
    preview: { src: starter.preview, alt: `Preview of the ${starter.title} starter` },
    kind: starter.kind,
    starter,
  };
}

/** The Kind values the address names, in their fixed order; anything unknown is ignored. */
export function parseKinds(value: string | string[] | undefined): StarterKind[] {
  const values = [value].flat().filter((entry): entry is string => typeof entry === "string");
  return STARTER_KINDS.filter((kind) => values.includes(kind));
}

/** Every entry the catalog offers: the starters first, in file order, then the demo's templates in the gallery's order. */
export async function catalogEntries(): Promise<{ entries: CatalogEntry[]; startersAvailable: boolean }> {
  const list = starters();
  const templates = demoEnabled() ? galleryOrder(await galleryTemplates()).map((template): CatalogEntry => ({ ...template, kind: "web", starter: null })) : [];
  return { entries: [...(list ?? []).map(starterEntry), ...templates], startersAvailable: list !== null };
}

/**
 * The entries +query+ and +kinds+ match, starters before templates. Without
 * a search, starters keep their file order and templates the gallery's; with
 * one, closer matches come first within each.
 */
export function filterCatalog(entries: readonly CatalogEntry[], query: GalleryQuery, kinds: readonly StarterKind[]): CatalogEntry[] {
  const matched = filterTemplates(query, entries) as CatalogEntry[];
  const kept = matched.filter((entry) => kinds.length === 0 || kinds.includes(entry.kind));
  const starters = query.search.trim() ? kept.filter((entry) => entry.starter) : entries.filter((entry) => entry.starter && kept.includes(entry));
  return [...starters, ...kept.filter((entry) => !entry.starter)];
}

/** How many of +entries+ each Kind would leave, with the query applied. */
export function kindCounts(entries: readonly CatalogEntry[], query: GalleryQuery): Record<StarterKind, number> {
  const matched = filterTemplates(query, entries) as CatalogEntry[];
  return Object.fromEntries(STARTER_KINDS.map((kind) => [kind, matched.filter((entry) => entry.kind === kind).length])) as Record<StarterKind, number>;
}
