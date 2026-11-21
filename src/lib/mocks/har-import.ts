import { MB } from "./model";

/*
 * Reading a HAR file (add-mock-sets, design decision 12, steps 2 to 4;
 * mock-set-import spec): HAR 1.1 and 1.2 as Chrome, Firefox, and Safari
 * export them, at most 5,000 entries. Only API calls are kept: fetch, XHR,
 * and event streams. Chrome's `_resourceType` decides when it's there;
 * otherwise `Sec-Fetch-Dest: empty`, or a JSON, GraphQL, or event-stream
 * answer. Everything left out says why. Kept calls have their bodies decoded,
 * ready for sanitize.ts; nothing here is stored.
 */

export const HAR_UPLOAD_LIMIT = 50 * MB;
export const HAR_ENTRY_LIMIT = 5000;
/** The largest response body an import keeps. */
export const IMPORT_BODY_LIMIT = 5 * MB;
/** The longest latency a response records. */
const LATENCY_LIMIT_MS = 30_000;

/** Why an entry was left out, each with the review's words. */
export const LEFT_OUT_REASONS = {
  "page-file": "The page's own file, which mock sets never answer",
  preflight: "A CORS preflight, which mocked calls don't need",
  websocket: "WebSocket connections can't be mocked yet",
  "no-response": "No response was recorded",
  "no-content": "Its body wasn't exported. Export the HAR with content.",
  "too-large": "Its body is over 5 MB",
  "cached-without-body": "Answered from the browser's cache, with no body recorded",
  unsupported: "Not an address a mock set can answer",
} as const;
export type LeftOutReason = keyof typeof LEFT_OUT_REASONS;

export interface LeftOut {
  readonly method: string;
  readonly url: string;
  readonly reason: LeftOutReason;
}

/** A body as recorded: its bytes and content type. */
export interface RecordedBody {
  readonly bytes: Uint8Array;
  readonly type: string | null;
}

/** A kept call, decoded, before anything is removed from it. */
export interface RecordedCall {
  /** Its place in the file, from 0. */
  readonly index: number;
  readonly startedAt: number;
  readonly method: string;
  readonly url: string;
  /** Request headers, without HTTP/2 pseudo-headers. */
  readonly requestHeaders: readonly [string, string][];
  /** How many cookies the HAR's request and response `cookies` arrays held. */
  readonly cookies: number;
  readonly requestBody: RecordedBody | null;
  readonly status: number;
  readonly responseHeaders: readonly [string, string][];
  readonly responseBody: RecordedBody | null;
  readonly latencyMs: number;
  /** A round-tripped export's own record of its rule (export.ts). */
  readonly frontendRegistry: unknown;
}

export interface ReadHar {
  readonly calls: RecordedCall[];
  readonly leftOut: LeftOut[];
  /** How many entries the file has, and how many past the 5,000th were left out. */
  readonly entryCount: number;
  readonly beyondLimit: number;
}

/** Raised for a file that isn't a HAR, with what to do instead. */
export class HarFormatError extends Error {
  override name = "HarFormatError";
}

const NOT_HAR = "This file isn't a HAR file. Export one from the browser's network panel: in Chrome or Edge, choose Export HAR; in Firefox, Save All As HAR; in Safari, Export.";

/** Chrome's resource types that are API calls. */
const API_TYPES = new Set(["fetch", "xhr", "eventsource"]);
/** A content type an API answers with: JSON, GraphQL, or an event stream. */
const API_CONTENT = /^\s*(application\/(?:[\w.+-]*\+)?json|application\/graphql|application\/graphql-response\+json|text\/event-stream)\b/i;

type Json = Record<string, unknown>;

const record = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function headersOf(value: unknown): [string, string][] {
  return list(value)
    .map(record)
    .map((header): [string, string] => [text(header.name), text(header.value)])
    .filter(([name]) => name !== "" && !name.startsWith(":"));
}

const headerValue = (headers: readonly [string, string][], name: string) => headers.find(([key]) => key.toLowerCase() === name)?.[1];

/** The entries of a HAR document, refusing anything that isn't HAR 1.1 or 1.2 with entries. */
export function harEntries(source: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new HarFormatError(NOT_HAR);
  }
  const log = record(record(parsed).log);
  if (!Array.isArray(log.entries) || !["1.1", "1.2"].includes(text(log.version))) throw new HarFormatError(NOT_HAR);
  return log.entries;
}

/** Why an entry isn't an API call, or null when it is one. */
function notApi(method: string, url: string, entry: Json, requestHeaders: readonly [string, string][], responseType: string): LeftOutReason | null {
  const resourceType = typeof entry._resourceType === "string" ? entry._resourceType.toLowerCase() : null;
  const status = Number(record(entry.response).status);
  if (/^wss?:/i.test(url) || resourceType === "websocket" || status === 101 || headerValue(requestHeaders, "upgrade")?.toLowerCase() === "websocket") return "websocket";
  if (resourceType === "preflight" || (method === "OPTIONS" && headerValue(requestHeaders, "access-control-request-method"))) return "preflight";
  if (!/^https?:/i.test(url)) return resourceType && !API_TYPES.has(resourceType) ? "page-file" : "unsupported";
  // An entry a mock set's export wrote is always one of its rules' answers.
  if (entry._frontendRegistry !== undefined) return null;
  if (resourceType) return API_TYPES.has(resourceType) ? null : "page-file";
  const destination = headerValue(requestHeaders, "sec-fetch-dest")?.toLowerCase();
  if (destination) return destination === "empty" ? null : "page-file";
  return API_CONTENT.test(responseType) ? null : "page-file";
}

/** A HAR content or postData body as bytes: base64 decoded, text as UTF-8. */
function bytesOf(content: Json): Uint8Array {
  const value = text(content.text);
  return content.encoding === "base64" ? new Uint8Array(Buffer.from(value, "base64")) : new TextEncoder().encode(value);
}

/** An entry's recorded latency: its wait for the first byte, or its whole time, up to 30 seconds. */
function latencyOf(entry: Json): number {
  const wait = Number(record(entry.timings).wait);
  const latency = Number.isFinite(wait) && wait >= 0 ? wait : Number(entry.time);
  return Number.isFinite(latency) && latency > 0 ? Math.min(Math.round(latency), LATENCY_LIMIT_MS) : 0;
}

/**
 * The API calls of a HAR document's text, decoded (steps 2 to 4), and every
 * entry left out, each with its reason. Throws HarFormatError for a file
 * that isn't a HAR.
 */
export function readHar(source: string): ReadHar {
  const entries = harEntries(source);
  const calls: RecordedCall[] = [];
  const leftOut: LeftOut[] = [];
  entries.slice(0, HAR_ENTRY_LIMIT).forEach((value, index) => {
    const entry = record(value);
    const request = record(entry.request);
    const response = record(entry.response);
    const content = record(response.content);
    const method = text(request.method).toUpperCase() || "GET";
    const url = text(request.url);
    const requestHeaders = headersOf(request.headers);
    const responseHeaders = headersOf(response.headers);
    const responseType = text(content.mimeType) || headerValue(responseHeaders, "content-type") || "";
    const leave = (reason: LeftOutReason) => leftOut.push({ method, url, reason });
    const excluded = notApi(method, url, entry, requestHeaders, responseType);
    if (excluded) return leave(excluded);
    let status = Number(response.status);
    if (!Number.isInteger(status) || status <= 0) return leave("no-response");
    const recorded = typeof content.text === "string";
    // A cached answer with its body becomes the 200 it stands for; without one there's nothing to answer with.
    if (status === 304) {
      if (!recorded || text(content.text) === "") return leave("cached-without-body");
      status = 200;
    }
    if (status < 200 || status > 599) return leave("unsupported");
    const size = Number(content.size);
    if (!recorded && status !== 204 && size !== 0) return leave("no-content");
    const responseBytes = recorded ? bytesOf(content) : null;
    if (responseBytes && responseBytes.byteLength > IMPORT_BODY_LIMIT) return leave("too-large");
    const postData = record(request.postData);
    const requestBytes = typeof postData.text === "string" && postData.text !== "" ? bytesOf(postData) : null;
    const started = Date.parse(text(entry.startedDateTime));
    calls.push({
      index,
      startedAt: Number.isFinite(started) ? started : index,
      method,
      url,
      requestHeaders,
      cookies: list(request.cookies).length + list(response.cookies).length,
      requestBody: requestBytes ? { bytes: requestBytes, type: text(postData.mimeType) || headerValue(requestHeaders, "content-type") || null } : null,
      status,
      responseHeaders,
      responseBody: responseBytes && (responseBytes.byteLength > 0 || status !== 204) ? { bytes: responseBytes, type: responseType || null } : null,
      latencyMs: latencyOf(entry),
      frontendRegistry: entry._frontendRegistry,
    });
  });
  return { calls, leftOut, entryCount: entries.length, beyondLimit: Math.max(0, entries.length - HAR_ENTRY_LIMIT) };
}
