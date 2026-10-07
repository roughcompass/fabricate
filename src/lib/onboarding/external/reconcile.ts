import type { JsonObject } from "@repo-facts/contract";
import type { ExternalSystem } from "@/lib/db/schema";
import type { Evidence } from "./evidence";
import { type ExternalReference, REFERENCE_TYPES } from "./references";

/*
 * Reconciliation (design decision 8): each expected value is compared with
 * the latest observation of the resource it's mapped to, and classified:
 *
 * - Matching: observed, current, and equal.
 * - Missing: the system says the resource doesn't exist.
 * - Conflicting: observed and current, but different.
 * - Unknown: no mapping, no read yet, a read that failed with nothing
 *   observed before, a response that didn't fit the contract, or an
 *   observation read under an earlier contract.
 * - Stale: observed, but too long ago or with reads failing since.
 *
 * Only Matching confirms anything. A failed read never becomes Missing.
 */

export const RECONCILIATION_STATES = ["matching", "missing", "conflicting", "unknown", "stale"] as const;
export type ReconciliationState = (typeof RECONCILIATION_STATES)[number];

export const RECONCILIATION_LABELS: Record<ReconciliationState, string> = { matching: "Matching", missing: "Missing", conflicting: "Conflicting", unknown: "Unknown", stale: "Stale" };

export interface Expectation {
  label: string;
  expected: string | null;
  /** The observed value, from the projection. */
  observed: (projection: JsonObject) => string | null;
}

export interface Comparison {
  state: ReconciliationState;
  /** Why, in a sentence. */
  reason: string;
  system: ExternalSystem;
  /** What the record expects of the resource, such as "Payee search revision 2". */
  desired: string;
  reference: Pick<ExternalReference, "publicId" | "system" | "resourceType" | "externalId" | "environment"> | null;
  values: { label: string; expected: string | null; observed: string | null; matches: boolean }[];
  observedAt: Date | null;
  readAt: Date | null;
}

/** Compares a record's expected values with the evidence of the resource it's mapped to. */
export function reconcile(input: { system: ExternalSystem; resourceLabel: string; desired: string; evidence: Evidence | null; expectations: readonly Expectation[] }): Comparison {
  const { evidence } = input;
  const base = {
    system: input.system,
    desired: input.desired,
    reference: evidence?.reference ?? null,
    observedAt: evidence?.observation?.observedAt ?? null,
    readAt: evidence?.lastRead?.readAt ?? null,
  };
  const unobserved = input.expectations.map((expectation) => ({ label: expectation.label, expected: expectation.expected, observed: null, matches: false }));
  if (!evidence) return { ...base, state: "unknown", reason: `No ${input.resourceLabel} is mapped, so nothing confirms it`, values: unobserved };
  const { observation, lastRead } = evidence;
  if (!observation) {
    const reason = lastRead ? `The ${input.resourceLabel} couldn't be read: ${lastRead.error ?? lastRead.outcome}` : `The ${input.resourceLabel} hasn't been read yet`;
    return { ...base, state: "unknown", reason, values: unobserved };
  }
  if (evidence.contractDrift) return { ...base, state: "unknown", reason: `The ${input.resourceLabel} was last read under an earlier contract`, values: unobserved };
  if (observation.outcome === "incompatible") return { ...base, state: "unknown", reason: `The ${input.resourceLabel}'s response didn't match its contract`, values: unobserved };
  const values =
    observation.outcome === "found" && observation.projectionValue
      ? input.expectations.map((expectation) => {
          const observed = expectation.observed(observation.projectionValue!);
          return { label: expectation.label, expected: expectation.expected, observed, matches: observed === expectation.expected };
        })
      : unobserved;
  if (evidence.stale) {
    const failing = lastRead && lastRead.outcome === "unavailable" && lastRead.readAt > observation.observedAt;
    return { ...base, state: "stale", reason: failing ? `The ${input.resourceLabel} couldn't be read since it was last observed: ${lastRead.error}` : `The ${input.resourceLabel} hasn't been observed recently`, values };
  }
  if (observation.outcome === "not_found") return { ...base, state: "missing", reason: `${systemLabel(input.system)} reports no such ${input.resourceLabel}`, values };
  const differing = values.filter((value) => !value.matches);
  if (differing.length > 0) return { ...base, state: "conflicting", reason: `${systemLabel(input.system)} has a different ${differing.map((value) => inSentence(value.label)).join(" and ")}`, values };
  return { ...base, state: "matching", reason: `${systemLabel(input.system)} confirms the ${input.resourceLabel}`, values };
}

export function systemLabel(system: ExternalSystem): string {
  return system === "studio" ? "Studio" : "CDaaS";
}

/** How a mapped resource reads, such as "Studio channel 6f1d...". */
export function referenceLabel(reference: Pick<ExternalReference, "system" | "resourceType" | "externalId" | "environment">): string {
  const type = REFERENCE_TYPES[reference.system][reference.resourceType]?.label ?? reference.resourceType;
  return `${type} ${reference.externalId}${reference.environment ? ` in ${reference.environment.toUpperCase()}` : ""}`;
}

/** A label as a word mid-sentence: "Route" becomes "route", while names such as appId or URL keep their case. */
function inSentence(label: string): string {
  return label.replace(/^[A-Z](?=[a-z])/, (letter) => letter.toLowerCase());
}
