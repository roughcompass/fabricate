import { compareCodeUnits, dump, sha256 } from "@repo-facts/contract";
import { desc } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { type CatalogReadOutcome, type EnvironmentCatalogSource, environmentCatalogReads } from "@/lib/db/schema";
import { STALE_AFTER_MS } from "./external/evidence";
import { PINNED_CONTRACTS } from "./external/contracts";

/*
 * The environment catalog (simplify-web-onboarding design decision 1).
 * Environments are platform reference data: a Portal team selects the ones
 * its Portal enables, and an Application team selects, for each placement,
 * which of those it appears in. Nobody here creates, renames, or configures
 * one. The catalog is the latest list Studio returned under the pinned
 * contract; until Studio has answered, or when its answers can't be used,
 * it's the committed fallback set DEV, UAT, TEST, and PROD, always shown as
 * the fallback and never as Studio's.
 */

/** An environment key: lowercase letters, digits, and dashes, starting with a letter, such as uat or prod. */
export const ENVIRONMENT_KEY = /^[a-z][a-z0-9-]{0,31}$/;

export interface CatalogEnvironment {
  key: string;
  label: string;
  /** Where it's listed: its position in the fallback set, or Studio's ID. */
  order: number;
  /** Studio's ID for it, when Studio listed it. */
  studioId: number | null;
}

export interface EnvironmentDefinition {
  key: string;
  label: string;
  order?: number;
  studioId?: number | null;
}

/** Raised when a catalog definition repeats or misshapes an environment. */
export class CatalogDefinitionError extends Error {
  override name = "CatalogDefinitionError";
}

/**
 * A catalog definition in canonical form: each key and label trimmed, listed
 * by order and then key. A key that isn't an environment key, an empty or
 * overlong label, or a key or order given twice is refused, so one catalog
 * has one canonical form and digest whatever order it was written in.
 */
export function defineCatalog(definitions: readonly EnvironmentDefinition[]): CatalogEnvironment[] {
  const keys = new Set<string>();
  const orders = new Set<number>();
  const environments = definitions.map((definition, index) => {
    const key = definition.key.trim();
    const label = definition.label.trim();
    const order = definition.order ?? index;
    if (!ENVIRONMENT_KEY.test(key)) throw new CatalogDefinitionError(`${JSON.stringify(definition.key)} isn't an environment key`);
    if (!label || label.length > 100) throw new CatalogDefinitionError(`${key} needs a label of 100 characters or fewer`);
    if (!Number.isInteger(order) || order < 0) throw new CatalogDefinitionError(`${key} needs a whole, non-negative order`);
    if (keys.has(key)) throw new CatalogDefinitionError(`${key} is defined more than once`);
    if (orders.has(order)) throw new CatalogDefinitionError(`${key} takes order ${order}, which another environment has`);
    keys.add(key);
    orders.add(order);
    return { key, label, order, studioId: definition.studioId ?? null };
  });
  return environments.sort((a, b) => a.order - b.order || compareCodeUnits(a.key, b.key));
}

/** The committed fallback set, used whenever there's no usable Studio list. */
export const FALLBACK_ENVIRONMENTS: readonly CatalogEnvironment[] = Object.freeze(
  defineCatalog([
    { key: "dev", label: "DEV", order: 0 },
    { key: "uat", label: "UAT", order: 1 },
    { key: "test", label: "TEST", order: 2 },
    { key: "prod", label: "PROD", order: 3 },
  ]),
);

/** SHA-256 of a catalog's canonical environments: what a submitted revision records it was validated against. */
export function catalogDigest(environments: readonly CatalogEnvironment[]): string {
  return sha256(dump(environments.map(({ key, label, order, studioId }) => ({ key, label, order, studioId }))));
}

/** The environment key a Studio label names: lowercased, with each run of other characters a dash, or null when that's no key. */
export function keyOfLabel(label: string): string | null {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ENVIRONMENT_KEY.test(key) ? key : null;
}

/**
 * Studio's environment list as catalog environments, keyed by label and
 * ordered by Studio ID. A label that makes no key, or a key an
 * environment with a lower ID already has, is skipped and named, so the
 * same list in any order gives the same catalog.
 */
export function catalogFromStudio(list: readonly { id: number; label: string }[]): { environments: CatalogEnvironment[]; skipped: string[] } {
  const skipped: string[] = [];
  const taken = new Map<string, number>();
  for (const item of [...list].sort((a, b) => a.id - b.id)) {
    const key = keyOfLabel(item.label);
    if (!key || item.label.trim().length > 100) skipped.push(`${item.label.trim() || "(no label)"} (ID ${item.id}) has no usable environment key`);
    else if (taken.has(key)) skipped.push(`${item.label.trim()} (ID ${item.id}) repeats ${key.toUpperCase()}`);
    else taken.set(key, item.id);
  }
  const labels = new Map(list.map((item) => [item.id, item.label.trim()]));
  return { environments: defineCatalog([...taken].map(([key, id]) => ({ key, label: labels.get(id)!, order: id, studioId: id }))), skipped };
}

// ---------------------------------------------------------------------------
// Reads and resolution

export type CatalogReadResult = { outcome: "found"; environments: CatalogEnvironment[]; skipped?: string[] } | { outcome: "incompatible"; error: string } | { outcome: "unavailable"; error: string };

export type CatalogRead = typeof environmentCatalogReads.$inferSelect;

/** Records one read of Studio's environment list, under the contract it was read with. */
export function recordCatalogRead(db: Executor, result: CatalogReadResult, options: { contractDigest?: string; readAt?: Date } = {}): CatalogRead {
  const found = result.outcome === "found" ? defineCatalog(result.environments) : null;
  return db
    .insert(environmentCatalogReads)
    .values({
      outcome: result.outcome satisfies CatalogReadOutcome,
      contractDigest: options.contractDigest ?? PINNED_CONTRACTS.studio.digest,
      environments: found ? JSON.stringify(found) : null,
      environmentsDigest: found ? catalogDigest(found) : null,
      error: result.outcome === "found" ? null : result.error.slice(0, 500) || "The read failed",
      readAt: options.readAt ?? new Date(),
    })
    .returning()
    .get();
}

export interface EnvironmentCatalog {
  source: EnvironmentCatalogSource;
  environments: readonly CatalogEnvironment[];
  digest: string;
  /** When Studio returned the list in use; null for the fallback. */
  observedAt: Date | null;
  /** True when Studio's list is older than the limit, or Studio's reads have failed since. */
  stale: boolean;
  /** Why the fallback is in use, or what's become of Studio's reads since its list; null when there's nothing to say. */
  note: string | null;
  /** The latest read of Studio's list, which may have failed. */
  lastRead: Pick<CatalogRead, "outcome" | "error" | "readAt"> | null;
}

/**
 * The catalog teams select from now: the latest list Studio returned under
 * the pinned contract, or the fallback set when there's none. A failed or
 * incompatible read never replaces a list, it makes it stale; a list read
 * under an earlier contract, or one with no usable environment, isn't used.
 */
export function environmentCatalog(db: Executor, options: { studioConfigured?: boolean; now?: Date; staleAfterMs?: number } = {}): EnvironmentCatalog {
  const now = options.now ?? new Date();
  const reads = db.select().from(environmentCatalogReads).orderBy(desc(environmentCatalogReads.readAt), desc(environmentCatalogReads.id)).limit(200).all();
  const lastRead = reads[0] ?? null;
  const last = lastRead ? { outcome: lastRead.outcome, error: lastRead.error, readAt: lastRead.readAt } : null;
  const found = reads.find((read) => read.outcome === "found");
  const pinned = PINNED_CONTRACTS.studio.digest;
  const environments = found?.environments ? (JSON.parse(found.environments) as CatalogEnvironment[]) : [];
  if (found && found.contractDigest === pinned && environments.length > 0) {
    const failedSince = lastRead !== null && lastRead.id !== found.id;
    const aged = now.getTime() - found.readAt.getTime() > (options.staleAfterMs ?? STALE_AFTER_MS);
    const note = failedSince ? `Studio couldn't be read since this list: ${lastRead.error ?? lastRead.outcome}` : aged ? "Studio hasn't been read recently" : null;
    return { source: "studio", environments, digest: found.environmentsDigest!, observedAt: found.readAt, stale: failedSince || aged, note, lastRead: last };
  }
  let note: string;
  if (found && found.contractDigest !== pinned) note = "Studio's latest list was read under an earlier contract, so the fallback set is in use";
  else if (found) note = "Studio listed no usable environment, so the fallback set is in use";
  else if (lastRead) note = `Studio couldn't be read (${lastRead.error ?? lastRead.outcome}), so the fallback set is in use`;
  else note = options.studioConfigured === false ? "Studio isn't configured, so the fallback set is in use" : "Studio's environments haven't been read yet, so the fallback set is in use";
  return { source: "fallback", environments: FALLBACK_ENVIRONMENTS, digest: catalogDigest(FALLBACK_ENVIRONMENTS), observedAt: null, stale: false, note, lastRead: last };
}

/** How an environment key reads: its catalog label, or the key in capitals when the catalog doesn't list it. */
export function environmentLabel(catalog: Pick<EnvironmentCatalog, "environments">, key: string): string {
  return catalog.environments.find((environment) => environment.key === key)?.label ?? key.toUpperCase();
}

/** Keys in catalog order; keys the catalog doesn't list follow, in key order. */
export function inCatalogOrder(catalog: Pick<EnvironmentCatalog, "environments">, keys: Iterable<string>): string[] {
  const position = new Map(catalog.environments.map((environment, index) => [environment.key, index]));
  return [...new Set(keys)].sort((a, b) => (position.get(a) ?? Infinity) - (position.get(b) ?? Infinity) || compareCodeUnits(a, b));
}
