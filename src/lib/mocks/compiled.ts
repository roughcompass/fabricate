/*
 * A mock set as the matching engine reads it (add-mock-sets, design decision
 * 4): its rules in precedence order, each with its request side parsed and
 * its responses ready to answer. `compile.ts` makes it from the stored rows;
 * the routing worker fetches it by revision, and screenshots read it in the
 * worker process. Plain data only, so it crosses `postMessage` and JSON as it
 * is. This module and `engine.ts` import nothing, so the worker's bundle can
 * hold them.
 */

/** The largest request body a rule compares, in bytes: the worker reads it on every matched call. */
export const MATCH_BODY_LIMIT = 64 * 1024;

/** The header on every answer given as not mocked, with the value `not-matched`. */
export const MOCK_HEADER = "X-Frontend-Registry-Mock";

/** What a rule's origin maps to: another origin, or `self`, the Frontend Registry's own origin that relative calls use. */
export const SELF_ORIGIN = "self";

/** Which hosts a set's rules match: any, comparing paths only, or each recorded origin as mapped. */
export type HostMatching = { readonly mode: "any" } | { readonly mode: "mapped"; readonly map: readonly HostMapping[] };

export interface HostMapping {
  /** An origin the rules recorded, such as `https://dev-api.orders.test`. */
  readonly from: string;
  /** The origin the build calls instead, or `self`. */
  readonly to: string;
}

/** A pattern's segment: a literal, already percent-decoded, or a named part that matches one segment. */
export type PatternSegment = { readonly literal: string } | { readonly param: string };

export interface CompiledPath {
  readonly segments: readonly PatternSegment[];
  /** Whether a final `*` matches the rest of the path, one segment or more. */
  readonly rest: boolean;
}

export type QueryMode = "exact" | "ignore-listed" | "ignore-all";

export interface CompiledQuery {
  readonly mode: QueryMode;
  /** The name and value pairs a call must have, in any order. */
  readonly params: readonly (readonly [string, string])[];
  /** The parameters ignore-listed leaves out on both sides. */
  readonly ignored: readonly string[];
}

export type CompiledBodyMatch = { readonly mode: "ignore" } | { readonly mode: "exact"; readonly text: string } | { readonly mode: "json"; readonly value: unknown };

/** A response's body: inline, as text or base64, or by its digest, fetched once when first used; null for none. */
export type CompiledBody = { readonly inline: string; readonly base64: boolean } | { readonly digest: string; readonly size: number } | null;

export interface CompiledResponse {
  readonly status: number;
  /** Its headers as written, without Content-Type, which `contentType` holds. */
  readonly headers: readonly (readonly [string, string])[];
  readonly contentType: string | null;
  /** The latency it was recorded or written with, which "As recorded" waits. */
  readonly latencyMs: number;
  readonly body: CompiledBody;
}

export interface CompiledRule {
  /** Its public ID, `mkr_…`. */
  readonly id: string;
  /** How it's named in lists, such as `GET /v1/accounts/:id`. */
  readonly label: string;
  /** An uppercase HTTP method, or null for any. */
  readonly method: string | null;
  /** The origin it was recorded on, or null for a rule written without one, which matches any. */
  readonly origin: string | null;
  readonly path: CompiledPath;
  readonly query: CompiledQuery;
  readonly body: CompiledBodyMatch;
  /** Between 1 and 20, answered in order, then the last again. */
  readonly responses: readonly CompiledResponse[];
}

export interface CompiledSet {
  /** The set's public ID, `mks_…`. */
  readonly set: string;
  readonly name: string;
  /** Goes up with every change to the set or its rules. */
  readonly revision: number;
  readonly hosts: HostMatching;
  /** What a call no rule matches gets: its own address, or the 501. */
  readonly unmatched: "pass" | "not-mocked";
  /** Enabled rules with a response, most specific first, then in the set's order. */
  readonly rules: readonly CompiledRule[];
}
