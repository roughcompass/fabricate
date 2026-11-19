import type { JsonObject } from "@repo-facts/contract";
import semver from "semver";
import { catalogConfiguration } from "@/lib/catalog/configuration";
import { type EntrySummary, currentCatalog } from "@/lib/catalog/current";
import { entryDocument, storedEntries } from "@/lib/catalog/entries";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import type { StoredEntrySource } from "@/lib/db/schema";
import { asArray, asObject, isJsonObject } from "@/lib/json";

/*
 * What Adoption Analytics tracks of a design system (adoption-analytics,
 * "Design-system adoption shows component usage across the fleet"): the
 * components, and each one's props, that its newest current Reference
 * Catalog entry lists. A component is unused when that entry lists it and no
 * covered Repository uses it in the app. Entries are read once each, by
 * digest; Profile documents never are.
 */

export interface TrackedProp {
  readonly name: string;
  /** Its finite values, when the entry lists them. */
  readonly values?: readonly string[];
  readonly deprecated?: true;
}

export interface TrackedComponent {
  readonly name: string;
  readonly package: string;
  readonly props: readonly TrackedProp[];
}

export interface TrackedDesignSystem {
  readonly id: string;
  readonly name: string;
  /** The entry whose components are tracked: the current one for the newest version described. */
  readonly entry: EntrySummary;
  /** Its sources: each package or rules file, its version, the sections it supplied, and for published data, the snapshot date to show as "as of". */
  readonly sources: readonly StoredEntrySource[];
  readonly components: readonly TrackedComponent[];
}

const components = new Map<string, { name: string; components: TrackedComponent[] }>();

/** The tracked components of the design system +id+, or undefined when it has no entry or isn't described. */
export function trackedDesignSystem(db: Executor, config: FrontendRegistryConfig, id: string): TrackedDesignSystem | undefined {
  const catalog = catalogConfiguration(config);
  const thing = catalog.things.find((candidate) => candidate.kind === "design_system" && candidate.id === id);
  if (!thing) return undefined;
  const stored = storedEntries(db);
  const entry = currentCatalog(db, { things: [thing] }, stored).entries.toSorted((a, b) => semver.rcompare(a.version, b.version))[0];
  if (!entry) return undefined;
  let read = components.get(entry.digest);
  if (!read) {
    const document = entryDocument(db, entry.digest)!;
    components.set(entry.digest, (read = { name: String(asObject(document.content).name ?? id), components: componentsOf(document) }));
  }
  return { id, name: read.name, entry, sources: stored.find((row) => row.digest === entry.digest)!.sources, components: read.components };
}

function componentsOf(document: JsonObject): TrackedComponent[] {
  return asArray(asObject(document.content).components)
    .filter(isJsonObject)
    .map((component) => ({
      name: String(component.name),
      package: String(component.package),
      props: asArray(component.props)
        .filter(isJsonObject)
        .map((prop) => ({ name: String(prop.name), ...(Array.isArray(prop.values) && { values: prop.values.map(String) }), ...(prop.deprecated === true && { deprecated: true as const }) })),
    }));
}
