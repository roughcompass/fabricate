import { type JsonObject, type ReferenceCatalogEntry, dump, selectEntry, sha256 } from "@repo-facts/contract";
import type { CatalogRecipe, RecipeEntry } from "@/lib/db/schema";
import type { CurrentCatalog } from "./current";

/*
 * The Reference Catalog part of a survey's recipe (establish-frontend-registry,
 * design decision 6): the described things the survey was given entries of,
 * and the entries its fact document names, each with the version the
 * Repository wanted. A survey's entries are still current when no thing has
 * been described since, and `selectEntry` picks the same entry for each
 * wanted version from the current entries, as Surveyor would if it ran now.
 * Only the entries a survey used count, so rebuilding an entry no Repository
 * uses surveys nothing again.
 */

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The Catalog recipe of a survey given entries of +things+, from its fact document; without +things+, the things its entries describe. */
export function catalogRecipe(factDocument: unknown, things?: readonly string[]): CatalogRecipe {
  const listed = isObject(factDocument) && Array.isArray(factDocument.catalog_entries) ? factDocument.catalog_entries.filter(isObject) : [];
  const entries = listed.map(
    (entry): RecipeEntry => ({
      kind: String(entry.kind),
      id: String(entry.id),
      version: text(entry.version),
      format_version: typeof entry.format_version === "number" ? entry.format_version : null,
      digest: text(entry.digest),
      wanted: { package: String(isObject(entry.wanted) ? entry.wanted.package : ""), version: isObject(entry.wanted) ? text(entry.wanted.version) : null },
    }),
  );
  return { things: [...new Set(things ?? entries.map((entry) => `${entry.kind}:${entry.id}`))].sort(), entries };
}

/** The digest of a Catalog recipe, which the survey key carries. */
export function recipeDigest(recipe: CatalogRecipe): string {
  return sha256(dump(recipe as unknown as JsonObject));
}

/** The entries +recipe+ names that a survey would no longer pick from +current+: rebuilt, or since built nearer to the wanted version. */
export function changedEntries(recipe: CatalogRecipe | null, current: CurrentCatalog): RecipeEntry[] {
  const entries = current.entries as unknown as readonly ReferenceCatalogEntry[];
  return (recipe?.entries ?? []).filter((entry) => {
    const selected = selectEntry(entries, { kind: entry.kind as ReferenceCatalogEntry["kind"], id: entry.id, package: entry.wanted.package, version: entry.wanted.version });
    return (selected?.digest ?? null) !== entry.digest;
  });
}

/** The things +current+ has entries of that a survey with +recipe+ wasn't given entries of. */
export function newThings(recipe: CatalogRecipe | null, current: CurrentCatalog): string[] {
  const given = new Set(recipe?.things ?? []);
  return current.things.filter((thing) => !given.has(thing));
}

/** Whether a survey with +recipe+ would be compared against the same entries if it ran now. A survey from before entries were recorded counts as given none. */
export function catalogIsCurrent(recipe: CatalogRecipe | null, current: CurrentCatalog): boolean {
  return newThings(recipe, current).length === 0 && changedEntries(recipe, current).length === 0;
}
