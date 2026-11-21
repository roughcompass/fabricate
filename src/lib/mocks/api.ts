import { applicationsUnavailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { type ViewedApplication, viewedApplication, viewedPreview } from "@/lib/workspaces/access";
import { attempt, fromOwnOrigin, notFound } from "@/lib/workspaces/api";
import { writableWorkspace } from "@/lib/workspaces/request";
import { findShare } from "@/lib/workspaces/shares";
import type { SharedMocks } from "./active";
import type { MockRule, MockSet, ResponseInput, RuleInput, SetInput } from "./model";
import { StaleMockRuleError, StaleMockSetError, findSet } from "./records";

/*
 * Shared plumbing for the mock sets' route handlers (add-mock-sets, task
 * 4): each answers not found while previews are off, for an unknown
 * application, and for a set of another application. Reads need nothing
 * more, as reading the application's presets doesn't; changes add the
 * presets route's same-origin and workspace checks. Every answer is
 * `Cache-Control: no-store`, so a deleted set never lingers in a cache.
 */

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The application +slug+ names, or a response that refuses it. */
export function mockApplication(slug: string): ViewedApplication | Response {
  const unavailable = applicationsUnavailable();
  if (unavailable) return unavailable;
  return viewedApplication(getDb(), slug) ?? notFound();
}

/** The application and its set the address names, or a response that refuses them. */
export function mockSetOf(slug: string, setPublicId: string): { application: ViewedApplication; set: MockSet } | Response {
  const application = mockApplication(slug);
  if (application instanceof Response) return application;
  const set = isPublicId(setPublicId, "mks") ? findSet(getDb(), application.id, setPublicId) : undefined;
  return set ? { application, set } : notFound();
}

/** A set as an endpoint answers with it, dates as ISO strings. */
export function shownSet(set: MockSet) {
  const { id: _id, applicationId: _applicationId, ...shown } = set;
  return { ...shown, createdAt: set.createdAt.toISOString(), updatedAt: set.updatedAt.toISOString() };
}

/** A rule as an endpoint answers with it, dates as ISO strings. */
export function shownRule(rule: MockRule) {
  const { id: _id, setId: _setId, ...shown } = rule;
  return { ...shown, needsResponse: rule.responses.length === 0, createdAt: rule.createdAt.toISOString(), updatedAt: rule.updatedAt.toISOString() };
}

/**
 * A stale edit as 409, with the record as it stands, or a deleted one as 404; anything else is thrown again.
 * @public The mock sets' change endpoints use this (add-mock-sets, task 4.2).
 */
export function refusedChange(error: unknown): Response {
  if (error instanceof StaleMockRuleError) return Response.json({ errors: { base: [error.message] }, rule: shownRule(error.current) }, { status: 409, headers: NO_STORE });
  if (error instanceof StaleMockSetError) return Response.json({ errors: { base: [error.message] }, set: shownSet(error.current) }, { status: 409, headers: NO_STORE });
  if (error instanceof StaleRecordError) return Response.json({ errors: { base: [error.message] } }, { status: 409, headers: NO_STORE });
  if (error instanceof NotFoundError) return Response.json({ errors: { base: [error.message] } }, { status: 404, headers: NO_STORE });
  throw error;
}

/** The largest JSON body a rule's endpoint reads: a response body of 5 MB, in base64, with the rest of the rule. */
const RULE_BODY_LIMIT = 8 * 1024 * 1024;

/** Reads a JSON object body of at most +limit+ bytes, or answers why it can't. */
export async function jsonObject(request: Request, limit = RULE_BODY_LIMIT): Promise<Record<string, unknown> | Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) return Response.json({ error: "Request too large" }, { status: 413, headers: NO_STORE });
  const text = await request.text();
  if (text.length > limit) return Response.json({ error: "Request too large" }, { status: 413, headers: NO_STORE });
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Falls through to the error below.
  }
  return Response.json({ error: "Expected a JSON object" }, { status: 400, headers: NO_STORE });
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const string = (value: unknown, max = 4096): string => (typeof value === "string" ? value.slice(0, max) : "");
const pairs = (value: unknown): [string, string][] => (Array.isArray(value) ? value.filter(Array.isArray).map((pair) => [string(pair[0], 256), string(pair[1])] as [string, string]) : []);

/** A response's body as JSON gives it: `{ text }`, `{ base64 }`, `{ keep, size }` for the body a rule already stores, or null. */
function bodyInput(value: unknown): ResponseInput["body"] {
  const body = record(value);
  if (typeof body.text === "string") return new TextEncoder().encode(body.text);
  if (typeof body.base64 === "string") return new Uint8Array(Buffer.from(body.base64, "base64"));
  if (typeof body.keep === "string") return { keep: body.keep, size: Number(body.size) || 0 };
  return null;
}

/** A rule's fields as a JSON body gives them: what Data's Create rule form and the endpoints' callers send. */
export function ruleInputFrom(body: Record<string, unknown>): RuleInput {
  const query = record(body.query);
  const match = record(body.body);
  const queryMode = string(query.mode, 20);
  const bodyMode = string(match.mode, 20);
  const matched = typeof match.text === "string" ? new TextEncoder().encode(match.text) : null;
  return {
    method: string(body.method, 20),
    origin: typeof body.origin === "string" && body.origin ? body.origin : null,
    pattern: string(body.pattern, 2048),
    queryMode: (["exact", "ignore_listed", "ignore_all"].includes(queryMode) ? queryMode : "ignore_all") as RuleInput["queryMode"],
    query: pairs(query.params),
    queryIgnored: Array.isArray(query.ignored) ? query.ignored.map((name) => string(name, 256)) : [],
    bodyMode: (["exact", "json"].includes(bodyMode) ? bodyMode : "ignore") as RuleInput["bodyMode"],
    body: matched ? { bytes: matched, type: typeof match.type === "string" ? match.type : null } : null,
    enabled: body.enabled !== false,
    responses: (Array.isArray(body.responses) ? body.responses : []).map((item) => {
      const response = record(item);
      return { status: Number(response.status), headers: pairs(response.headers), contentType: typeof response.contentType === "string" ? response.contentType : null, body: bodyInput(response.body), latencyMs: Number(response.latencyMs ?? 0) };
    }),
  };
}

/** A set's settings as a JSON body gives them. */
export function setInputFrom(body: Record<string, unknown>): SetInput {
  const hosts = Array.isArray(body.hosts) ? body.hosts.map((host) => ({ from: string(record(host).from, 255), to: string(record(host).to, 255) })) : [];
  return {
    name: string(body.name, 200),
    description: typeof body.description === "string" ? body.description.slice(0, 2000) : null,
    hostMode: body.hostMode === "mapped" ? "mapped" : "any",
    hosts,
    unmatched: body.unmatched === "not_mocked" ? "not_mocked" : "pass",
  };
}

/** The view a request names by its `preview` key and `share` token: the saved preview shown, and the share link's mock set, when it's one of this application's. */
export function requestedView(request: Request, application: ViewedApplication): { previewId: number | null; shared: SharedMocks | null } | Response {
  const query = new URL(request.url).searchParams;
  const key = query.get("preview");
  const db = getDb();
  const preview = key ? viewedPreview(db, application, key) : null;
  if (key && !preview) return notFound();
  const share = findShare(db, query.get("share"));
  const shared = share && share.applicationId === application.id ? ((share.view as { mocks?: SharedMocks }).mocks ?? null) : null;
  return { previewId: preview?.id ?? null, shared };
}

const forbidden = () => Response.json({ error: "Changes come only from the Frontend Registry's own pages" }, { status: 403, headers: NO_STORE });

/**
 * Runs a change for the visitor's workspace, on the Frontend Registry's own
 * origin: refuses another origin with 403, a browser with no workspace yet
 * with 400, invalid input with 400 by field, a stale edit with 409 and the
 * record as it stands, and a deleted record with 404.
 */
export async function mockChange(request: Request, work: (workspace: { id: number; displayName: string | null }) => Response): Promise<Response> {
  if (!fromOwnOrigin(request)) return forbidden();
  let workspace: { id: number; displayName: string | null };
  try {
    workspace = await writableWorkspace();
  } catch {
    return Response.json({ errors: { base: ["This browser has no workspace yet. Reload the page and try again."] } }, { status: 400, headers: NO_STORE });
  }
  return attempt(() => {
    try {
      return work(workspace);
    } catch (error) {
      return refusedChange(error);
    }
  });
}
