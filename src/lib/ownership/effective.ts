import type { OwnershipSource, VerificationState } from "@/lib/db/schema";
import type { OwnershipAssertion } from "./records";

/*
 * Effective ownership, computed from the assertion history. Nothing here
 * reads the database, so the rules are tested directly.
 *
 * - An assertion is current until another supersedes it. A source's newer
 *   assertion also replaces its own older one: the DE Console's latest read,
 *   or one person's latest claim.
 * - Precedence: the DE Console's value, then a verified claim, then the most
 *   recent unverified claim.
 * - Current assertions that disagree put the attribute in conflict. Every
 *   candidate stays visible until an assertion supersedes them.
 */

/** Where a value came from and how far it can be trusted. */
export interface Provenance {
  assertion: string;
  source: OwnershipSource;
  providedBy: string;
  attributedTo: string | null;
  verification: VerificationState;
  verifiedAt: Date | null;
  readAt: Date | null;
  recordedAt: Date;
}

export interface Candidate<T> {
  value: T;
  provenance: Provenance;
}

export interface Effective<T> {
  /** The value that counts, or null when nothing has been asserted. */
  value: T | null;
  provenance: Provenance | null;
  /** True when current assertions disagree. */
  conflict: boolean;
  /** Every current value, highest precedence first. */
  candidates: Candidate<T>[];
}

export const UNKNOWN: Effective<never> = Object.freeze({ value: null, provenance: null, conflict: false, candidates: [] });

export function provenanceOf(assertion: OwnershipAssertion): Provenance {
  return {
    assertion: assertion.publicId,
    source: assertion.source,
    providedBy: assertion.providedBy,
    attributedTo: assertion.attributedTo,
    verification: assertion.verification,
    verifiedAt: assertion.verifiedAt,
    readAt: assertion.readAt,
    recordedAt: assertion.recordedAt,
  };
}

const rank = (assertion: OwnershipAssertion) => (assertion.source === "de_console" ? 3 : assertion.verification === "verified" ? 2 : 1);
const origin = (assertion: OwnershipAssertion) => (assertion.source === "de_console" ? "de_console" : `${assertion.source}\u0000${assertion.providedBy}`);
const newest = (a: OwnershipAssertion, b: OwnershipAssertion) => b.recordedAt.getTime() - a.recordedAt.getTime() || b.id - a.id;
const byPrecedence = (a: OwnershipAssertion, b: OwnershipAssertion) => rank(b) - rank(a) || newest(a, b);

/** Assertions no other assertion has replaced, keeping only each source's newest. */
export function currentAssertions(assertions: readonly OwnershipAssertion[], superseded: ReadonlySet<number>): OwnershipAssertion[] {
  const latest = new Map<string, OwnershipAssertion>();
  for (const assertion of [...assertions].filter((item) => !superseded.has(item.id)).sort(newest)) {
    if (!latest.has(origin(assertion))) latest.set(origin(assertion), assertion);
  }
  return [...latest.values()];
}

/** The effective value of a single-valued attribute. +key+ identifies equal values. */
export function effectiveValue<T>(assertions: readonly OwnershipAssertion[], superseded: ReadonlySet<number>, valueOf: (assertion: OwnershipAssertion) => T, key: (assertion: OwnershipAssertion) => string): Effective<T> {
  const current = currentAssertions(assertions, superseded).sort(byPrecedence);
  if (current.length === 0) return UNKNOWN;
  const winner = current[0]!;
  return {
    value: valueOf(winner),
    provenance: provenanceOf(winner),
    conflict: new Set(current.map(key)).size > 1,
    candidates: current.map((assertion) => ({ value: valueOf(assertion), provenance: provenanceOf(assertion) })),
  };
}

export interface PortalMembership {
  portalId: number;
  provenance: Provenance;
  /** A claimed portal the DE Console doesn't list for a DE Web application. */
  flagged: boolean;
}

/**
 * An application's portals: each portal added and not later removed. For a
 * DE Web application the DE Console's portals are the set, and any other
 * portal a claim adds is flagged.
 */
export function effectivePortals(assertions: readonly OwnershipAssertion[], superseded: ReadonlySet<number>, deWeb: boolean): PortalMembership[] {
  const live = assertions.filter((assertion) => !superseded.has(assertion.id));
  const memberships = (pool: readonly OwnershipAssertion[]) => {
    const latest = new Map<number, OwnershipAssertion>();
    for (const assertion of [...pool].sort(newest)) if (!latest.has(assertion.valuePortalId!)) latest.set(assertion.valuePortalId!, assertion);
    return [...latest.values()].filter((assertion) => assertion.operation === "add");
  };
  if (!deWeb) return memberships(live).map((assertion) => ({ portalId: assertion.valuePortalId!, provenance: provenanceOf(assertion), flagged: false }));

  const listed = memberships(live.filter((assertion) => assertion.source === "de_console"));
  const listedIds = new Set(listed.map((assertion) => assertion.valuePortalId!));
  const extra = memberships(live.filter((assertion) => assertion.source !== "de_console")).filter((assertion) => !listedIds.has(assertion.valuePortalId!));
  return [
    ...listed.map((assertion) => ({ portalId: assertion.valuePortalId!, provenance: provenanceOf(assertion), flagged: false })),
    ...extra.map((assertion) => ({ portalId: assertion.valuePortalId!, provenance: provenanceOf(assertion), flagged: true })),
  ];
}

/** The latest time among the assertions behind the given values: when this ownership was last stated. */
export function asOfLatest(...times: readonly (Date | null | undefined)[]): Date | null {
  let latest: Date | null = null;
  for (const time of times) if (time && (!latest || time.getTime() > latest.getTime())) latest = time;
  return latest;
}
