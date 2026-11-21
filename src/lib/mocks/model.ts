import type { mockRules, mockSets } from "@/lib/db/schema";
import type { MockBodyMode, MockHostMode, MockQueryMode, MockSetSource, MockUnmatched } from "@/lib/db/schema";

/*
 * Mock sets and their rules as the rest of the Frontend Registry reads them
 * (add-mock-sets, design decisions 9 and 10), with the limits of "Mock sets
 * are bounded". records.ts reads and changes them; checks.ts checks input.
 */

/** The limits of "Mock sets are bounded" and the import's (design decision 9). */
export const SET_LIMIT = 10;
export const RULE_LIMIT = 500;
export const RESPONSE_LIMIT = 20;
export const MB = 1024 * 1024;
export const SET_BODY_LIMIT = 20 * MB;
export const RESPONSE_BODY_LIMIT = 5 * MB;
export const NAME_LIMIT = 60;
export const DESCRIPTION_LIMIT = 280;
export const HOSTS_LIMIT = 20;
export const LATENCY_LIMIT_MS = 30_000;

/** Response headers a mocked answer computes, which are left out of what's stored (mock-sets spec, "A response has a status, headers, a body, and a latency"). */
export const COMPUTED_HEADERS: ReadonlySet<string> = new Set(["content-length", "content-encoding", "transfer-encoding"]);
/** Response headers a mocked answer can't have. */
export const REFUSED_HEADERS: ReadonlySet<string> = new Set(["set-cookie", "set-cookie2"]);


export interface HostMapping {
  readonly from: string;
  /** An origin, or `self`. */
  readonly to: string;
}

export interface MockSet {
  readonly id: number;
  readonly publicId: string;
  readonly applicationId: number;
  readonly name: string;
  readonly description: string | null;
  readonly source: MockSetSource;
  readonly sourceFile: string | null;
  readonly hostMode: MockHostMode;
  readonly hosts: readonly HostMapping[];
  readonly unmatched: MockUnmatched;
  readonly revision: number;
  readonly ruleCount: number;
  readonly bodyBytes: number;
  readonly createdByName: string | null;
  readonly updatedByName: string | null;
  readonly lockVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A stored body: its file's digest, its size in bytes, and its content type. */
export interface StoredBody {
  readonly digest: string;
  readonly size: number;
  readonly type: string | null;
}

export interface StoredResponse {
  readonly status: number;
  /** Its headers, without Content-Type, which its body's type holds. */
  readonly headers: readonly [string, string][];
  readonly body: StoredBody | null;
  readonly latencyMs: number;
}

export interface MockRule {
  readonly id: number;
  readonly publicId: string;
  readonly setId: number;
  readonly position: number;
  readonly enabled: boolean;
  /** An uppercase method, or `*` for any. */
  readonly method: string;
  readonly origin: string | null;
  readonly pattern: string;
  readonly queryMode: MockQueryMode;
  readonly query: readonly [string, string][];
  readonly queryIgnored: readonly string[];
  readonly bodyMode: MockBodyMode;
  /** The body to compare, for exact and JSON-equal matching. */
  readonly body: StoredBody | null;
  readonly responses: readonly StoredResponse[];
  readonly createdByName: string | null;
  readonly updatedByName: string | null;
  readonly lockVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Whether a rule still needs a response written before it can answer anything.
 * @public The set's page uses this (add-mock-sets, task 5.2).
 */
export function needsResponse(rule: Pick<MockRule, "responses">): boolean {
  return rule.responses.length === 0;
}

/** How a rule is named in lists: its method, or Any, and its pattern. */
export function ruleLabel(rule: Pick<MockRule, "method" | "pattern">): string {
  return `${rule.method === "*" ? "ANY" : rule.method} ${rule.pattern}`;
}

export interface SetInput {
  readonly name: string;
  readonly description?: string | null;
  readonly hostMode?: MockHostMode;
  readonly hosts?: readonly HostMapping[];
  readonly unmatched?: MockUnmatched;
}

/** A response's body as a form or an import gives it: new bytes, or the body the rule already stores, by its digest. */
export type BodyInput = Uint8Array | { readonly keep: string; readonly size: number };

export interface ResponseInput {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly contentType: string | null;
  readonly body: BodyInput | null;
  readonly latencyMs: number;
}

export interface RuleInput {
  /** A method such as GET, or `*` or ANY for any. */
  readonly method: string;
  readonly origin?: string | null;
  readonly pattern: string;
  readonly queryMode: MockQueryMode;
  readonly query: readonly (readonly [string, string])[];
  readonly queryIgnored: readonly string[];
  readonly bodyMode: MockBodyMode;
  /** The body to compare, for exact and JSON-equal matching. */
  readonly body?: { readonly bytes: Uint8Array; readonly type: string | null } | { readonly keep: string; readonly size: number; readonly type: string | null } | null;
  readonly responses: readonly ResponseInput[];
  /** Whether it's turned on; a rule without a response is always off. */
  readonly enabled?: boolean;
}

type SetRow = typeof mockSets.$inferSelect;
type RuleRow = typeof mockRules.$inferSelect;

export function toMockSet(row: SetRow): MockSet {
  return {
    id: row.id,
    publicId: row.publicId,
    applicationId: row.applicationId,
    name: row.name,
    description: row.description,
    source: row.source,
    sourceFile: row.sourceFile,
    hostMode: row.hostMode,
    hosts: row.hosts as unknown as HostMapping[],
    unmatched: row.unmatched,
    revision: row.revision,
    ruleCount: row.ruleCount,
    bodyBytes: row.bodyBytes,
    createdByName: row.createdByName,
    updatedByName: row.updatedByName,
    lockVersion: row.lockVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toMockRule(row: RuleRow): MockRule {
  return {
    id: row.id,
    publicId: row.publicId,
    setId: row.setId,
    position: row.position,
    enabled: row.enabled,
    method: row.method,
    origin: row.origin,
    pattern: row.pattern,
    queryMode: row.queryMode,
    query: row.query,
    queryIgnored: row.queryIgnored,
    bodyMode: row.bodyMode,
    body: row.bodyDigest === null ? null : { digest: row.bodyDigest, size: row.bodySize ?? 0, type: row.bodyType },
    responses: row.responses as unknown as StoredResponse[],
    createdByName: row.createdByName,
    updatedByName: row.updatedByName,
    lockVersion: row.lockVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
