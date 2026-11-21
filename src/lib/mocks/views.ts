import { and, asc, eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { type FailedCallKind, applicationPreviews, applications, previewScreenshots, screenshotFailedCalls } from "@/lib/db/schema";
import { formatBytes, formatNumber } from "@/components/ui/count";
import { type MockRule, type MockSet, type ResponseInput, type RuleInput, type StoredResponse, ruleLabel } from "./model";
import { readBody, setDirectory } from "./storage";
import type { FrontendRegistryConfig } from "@/lib/config";

/*
 * What the mock sets' pages show (add-mock-sets, design decision 18): the
 * words for a set's source, a rule's matching and state, the failed calls a
 * capture recorded, and a rule as its form edits it, as text that works
 * without JavaScript.
 */

export const SOURCE_LABELS: Record<MockSet["source"], string> = { har: "Uploaded HAR", written: "Written", calls: "From failed calls" };

/** A set's rules and size, such as "12 rules · 48 KB". */
export function setSummary(set: Pick<MockSet, "ruleCount" | "bodyBytes">): string {
  return `${formatNumber(set.ruleCount)} ${set.ruleCount === 1 ? "rule" : "rules"} · ${formatBytes(set.bodyBytes)}`;
}

/** How a rule matches beyond its method and path, such as "Query: limit=5, ignores _ · Body: JSON". */
export function matchingSummary(rule: Pick<MockRule, "queryMode" | "query" | "queryIgnored" | "bodyMode" | "origin">, mapped: boolean): string {
  const query = rule.queryMode === "ignore_all" ? "Any query" : `Query: ${rule.query.length ? rule.query.map(([name, value]) => `${name}=${value}`).join("&") : "none"}${rule.queryMode === "ignore_listed" && rule.queryIgnored.length ? `, ignores ${rule.queryIgnored.join(", ")}` : ""}`;
  const body = { ignore: "Any body", exact: "Body: exact", json: "Body: JSON" }[rule.bodyMode];
  return [mapped && rule.origin ? rule.origin : null, query, body].filter(Boolean).join(" · ");
}

/** A rule's responses in brief, such as "200, 200, 202" or "Needs a response". */
export function responsesSummary(rule: Pick<MockRule, "responses">): string {
  if (rule.responses.length === 0) return "Needs a response";
  return rule.responses.length <= 4 ? rule.responses.map((response) => response.status).join(", ") : `${rule.responses.length} responses, ${rule.responses[0]!.status} first`;
}

/** What happened to a failed call, as the alert says it. */
export const FAILURE_LABELS: Record<FailedCallKind, (status: number | null) => string> = {
  status: (status) => `Answered ${status}`,
  connect: () => "Couldn't connect",
  cors: () => "Blocked by CORS",
  not_mocked: () => "Answered as not mocked",
  websocket: () => "The WebSocket never opened",
};

export interface FailedCall {
  readonly position: number;
  readonly method: string;
  readonly url: string;
  readonly kind: FailedCallKind;
  readonly status: number | null;
  readonly error: string | null;
  readonly occurrences: number;
}

/** The calls that failed when a build's screenshot was captured, with the set it applied, and whether the alert was dismissed. */
export interface FailedCalls {
  readonly screenshotId: number;
  readonly total: number;
  readonly calls: readonly FailedCall[];
  readonly set: { readonly publicId: string; readonly name: string; readonly revision: number | null } | null;
  readonly dismissed: boolean;
}

/** What the capture of the build with row ID +previewId+ recorded as failed, or null when it recorded nothing. */
export function failedCallsOf(db: Executor, previewId: number | null): FailedCalls | null {
  if (previewId === null) return null;
  const screenshot = db.select().from(previewScreenshots).where(eq(previewScreenshots.previewId, previewId)).get();
  if (!screenshot || screenshot.failedCalls === 0) return null;
  const calls = db
    .select()
    .from(screenshotFailedCalls)
    .where(eq(screenshotFailedCalls.screenshotId, screenshot.id))
    .orderBy(asc(screenshotFailedCalls.position))
    .all()
    .map((row) => ({ position: row.position, method: row.method, url: row.url, kind: row.kind, status: row.status, error: row.error, occurrences: row.occurrences }));
  return {
    screenshotId: screenshot.id,
    total: screenshot.failedCalls,
    calls,
    set: screenshot.mockSetPublicId ? { publicId: screenshot.mockSetPublicId, name: screenshot.mockSetName ?? "", revision: screenshot.mockSetRevision } : null,
    dismissed: screenshot.failuresDismissedAt !== null,
  };
}

/** The row ID of the current build of the application +slug+, or of its saved preview +key+. */
export function currentBuildId(db: Executor, applicationId: number, key?: string | null): number | null {
  if (!key) return db.select({ id: applications.currentPreviewId }).from(applications).where(eq(applications.id, applicationId)).get()?.id ?? null;
  return (
    db
      .select({ id: applicationPreviews.currentPreviewId })
      .from(applicationPreviews)
      .where(and(eq(applicationPreviews.applicationId, applicationId), eq(applicationPreviews.key, key)))
      .get()?.id ?? null
  );
}

/** Dismisses the failed-calls alert for the screenshot +screenshotId+, so it shows again only for a later build. */
export function dismissFailedCalls(db: Executor, screenshotId: number): void {
  db.update(previewScreenshots).set({ failuresDismissedAt: new Date() }).where(eq(previewScreenshots.id, screenshotId)).run();
}

// -- The rule form -------------------------------------------------------------------

/** The most a response's body may hold to be edited as text in the form; a larger or binary one is kept as stored. */
const EDITABLE_BODY = 512 * 1024;

export interface ResponseFields {
  readonly status: string;
  readonly contentType: string;
  /** One `Name: value` a line. */
  readonly headers: string;
  readonly body: string;
  /** A stored body the form keeps as it is, by digest, with its size, when it can't be edited as text. */
  readonly keep: string;
  readonly keepSize: number;
  readonly latencyMs: string;
}

export interface RuleFields {
  readonly method: string;
  readonly pattern: string;
  readonly origin: string;
  readonly queryMode: string;
  /** One `name=value` a line. */
  readonly query: string;
  /** Names separated by commas. */
  readonly queryIgnored: string;
  readonly bodyMode: string;
  readonly body: string;
  readonly enabled: boolean;
  readonly responses: readonly ResponseFields[];
}

export const EMPTY_RESPONSE: ResponseFields = { status: "200", contentType: "application/json", headers: "", body: "", keep: "", keepSize: 0, latencyMs: "0" };

function textOf(bytes: Buffer | null): string | null {
  if (!bytes || bytes.byteLength > EDITABLE_BODY) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function responseFields(directory: string, response: StoredResponse): ResponseFields {
  const text = response.body ? textOf(readBody(directory, response.body.digest)) : "";
  return {
    status: String(response.status),
    contentType: response.body?.type ?? "",
    headers: response.headers.map(([name, value]) => `${name}: ${value}`).join("\n"),
    body: text ?? "",
    keep: text === null && response.body ? response.body.digest : "",
    keepSize: text === null && response.body ? response.body.size : 0,
    latencyMs: String(response.latencyMs),
  };
}

/** A stored rule as its form shows it. */
export function ruleFields(config: FrontendRegistryConfig, set: Pick<MockSet, "publicId">, rule: MockRule): RuleFields {
  const directory = setDirectory(config, set.publicId);
  return {
    method: rule.method,
    pattern: rule.pattern,
    origin: rule.origin ?? "",
    queryMode: rule.queryMode,
    query: rule.query.map(([name, value]) => `${name}=${value}`).join("\n"),
    queryIgnored: rule.queryIgnored.join(", "),
    bodyMode: rule.bodyMode,
    body: rule.body ? (textOf(readBody(directory, rule.body.digest)) ?? "") : "",
    enabled: rule.enabled,
    responses: rule.responses.map((response) => responseFields(directory, response)),
  };
}

/** `Name: value` lines as pairs, splitting each at its first colon. */
function headerPairs(text: string): [string, string][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(":");
      return colon === -1 ? [line, ""] : [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
    });
}

/** `name=value` lines, or one query string, as pairs. */
function queryPairs(text: string): [string, string][] {
  const lines = text
    .split(/\r?\n|&/)
    .map((line) => line.trim().replace(/^\?/, ""))
    .filter(Boolean);
  return lines.map((line) => {
    const pair = new URLSearchParams(line);
    const [entry] = [...pair.entries()];
    return entry ?? [line, ""];
  });
}

const encoder = new TextEncoder();

/** The form's fields as the records take a rule, each response at the index its fields had. */
export function ruleInputOf(fields: RuleFields): RuleInput {
  const responses: ResponseInput[] = fields.responses.map((response) => ({
      status: Number(response.status),
      headers: headerPairs(response.headers),
      contentType: response.contentType.trim() || null,
      body: response.keep ? { keep: response.keep, size: response.keepSize } : response.body === "" ? null : encoder.encode(response.body),
      latencyMs: response.latencyMs.trim() === "" ? 0 : Number(response.latencyMs),
  }));
  return {
    method: fields.method,
    origin: fields.origin.trim() || null,
    pattern: fields.pattern,
    queryMode: (["exact", "ignore_listed", "ignore_all"].includes(fields.queryMode) ? fields.queryMode : "ignore_all") as RuleInput["queryMode"],
    query: queryPairs(fields.query),
    queryIgnored: fields.queryIgnored.split(/[,\s]+/).filter(Boolean),
    bodyMode: (["exact", "json"].includes(fields.bodyMode) ? fields.bodyMode : "ignore") as RuleInput["bodyMode"],
    body: fields.bodyMode === "ignore" ? null : { bytes: encoder.encode(fields.body), type: fields.bodyMode === "json" ? "application/json" : "text/plain" },
    enabled: fields.enabled,
    responses,
  };
}

/** A rule's name in lists and titles, such as `GET /v1/accounts/:id`. */
export function ruleName(rule: Pick<MockRule, "method" | "pattern">): string {
  return ruleLabel(rule);
}
