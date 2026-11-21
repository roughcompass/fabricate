import { redactSecrets } from "@/lib/git/redact";
import type { RecordedBody, RecordedCall } from "./har-import";

/*
 * Removing credentials from a recorded call before anything is stored
 * (add-mock-sets, design decision 12, step 5; mock-set-import spec,
 * "Credentials are removed before anything is stored" and "Token-like
 * values are replaced"). Request headers aren't kept, apart from
 * Content-Type, since rules don't match on headers; HAR cookie arrays go
 * too. Response headers that carry credentials go, and so do transport
 * headers that no longer apply. Query values, header values, and bodies are
 * redacted value by value, so a pattern that runs to the end of a line stays
 * inside its value, and JSON stays valid JSON. Anything shaped like a JSON
 * Web Token becomes `[REDACTED-JWT]`. Binary bodies aren't scanned: they're
 * kept, unchecked, and flagged.
 */

/** The placeholder a token-like value becomes. */
export const JWT_PLACEHOLDER = "[REDACTED-JWT]";
const REDACTED = "[REDACTED]";

/** A JSON Web Token's shape: three base64url parts, the first a JSON header. */
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const HAS_JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]*/;
/** Header names that carry credentials, which are dropped. CORS headers, such as `Access-Control-Allow-Credentials`, only name them. */
export const CREDENTIAL_HEADER = /auth|token|secret|session|api[-_]?key|signature|credential/i;
const isCredentialHeader = (lower: string) => !lower.startsWith("access-control-") && CREDENTIAL_HEADER.test(lower);
/** JSON members, form fields, and query parameters whose values are credentials. */
export const CREDENTIAL_NAME = /pass(word)?|secret|token|api[-_]?key|authorization|session|signature|credential/i;
/** Request headers that always carry credentials, counted by name when dropped. */
const REQUEST_CREDENTIALS = new Set(["authorization", "proxy-authorization", "cookie"]);
/** Response headers that set cookies. */
const SET_COOKIE = new Set(["set-cookie", "set-cookie2"]);
/** Transport headers that no longer apply to a mocked answer. */
export const TRANSPORT_HEADERS: ReadonlySet<string> = new Set(["content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive", "alt-svc", "strict-transport-security", "report-to", "nel", "date"]);

/** Whether +value+ is already a placeholder, as an export of a sanitized set holds, which stays as it is. */
const isPlaceholder = (value: unknown) => value === REDACTED || value === JWT_PLACEHOLDER;

/** What sanitizing removed from one call, or from a whole file. */
export interface Removed {
  /** Credential headers dropped, by their name as recorded, with how often. */
  readonly headers: Record<string, number>;
  /** Cookies the HAR's cookie arrays held. */
  cookies: number;
  /** Values redacted as credentials: query values, JSON members, form fields, and patterns in text. */
  redacted: number;
  /** Values shaped like JSON Web Tokens, replaced by the placeholder. */
  tokens: number;
}

export function noneRemoved(): Removed {
  return { headers: {}, cookies: 0, redacted: 0, tokens: 0 };
}

/** Adds +more+ into +total+. */
export function addRemoved(total: Removed, more: Removed): void {
  for (const [name, count] of Object.entries(more.headers)) total.headers[name] = (total.headers[name] ?? 0) + count;
  total.cookies += more.cookies;
  total.redacted += more.redacted;
  total.tokens += more.tokens;
}

/** A body after sanitizing: its bytes, its type, and whether it couldn't be checked. */
export interface SanitizedBody {
  readonly bytes: Uint8Array;
  readonly type: string | null;
  /** A binary body, kept as recorded, which couldn't be checked for credentials or personal data. */
  readonly binary: boolean;
  /** Whether a value in it was redacted or replaced, so it can't be compared with a real request. */
  readonly changed: boolean;
}

export interface SanitizedCall {
  readonly index: number;
  readonly startedAt: number;
  readonly method: string;
  /** The address with every query value redacted where it needed to be. */
  readonly url: string;
  /** Query parameters whose values were credentials, which the rule ignores. */
  readonly redactedParams: readonly string[];
  readonly requestBody: SanitizedBody | null;
  readonly status: number;
  /** Response headers kept, without Content-Type, which the body's type holds. */
  readonly responseHeaders: readonly [string, string][];
  readonly responseBody: SanitizedBody | null;
  readonly latencyMs: number;
  readonly removed: Removed;
  readonly frontendRegistry: unknown;
}

/** +value+ with credentials and token-like values redacted, counting each in +removed+. */
export function redactText(value: string, removed: Removed): string {
  let tokens = 0;
  const replaced = value.replace(JWT, () => {
    tokens++;
    return JWT_PLACEHOLDER;
  });
  removed.tokens += tokens;
  const redacted = redactSecrets(replaced);
  if (redacted !== replaced) removed.redacted += (redacted.match(/\[REDACTED\]/g)?.length ?? 0) - (replaced.match(/\[REDACTED\]/g)?.length ?? 0) || 1;
  return redacted;
}

/** A JSON value walked: credential members redacted, every string redacted on its own. */
function sanitizeJson(value: unknown, removed: Removed): unknown {
  if (typeof value === "string") return redactText(value, removed);
  if (Array.isArray(value)) return value.map((item) => sanitizeJson(item, removed));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, member]) => {
        if (CREDENTIAL_NAME.test(name) && member !== null && member !== "" && !isPlaceholder(member)) {
          // A token-like value keeps its placeholder, so the review can say a token was replaced.
          if (typeof member === "string" && HAS_JWT.test(member)) return [name, redactText(member, removed)];
          removed.redacted++;
          return [name, REDACTED];
        }
        return [name, sanitizeJson(member, removed)];
      }),
    );
  }
  return value;
}

const isJson = (type: string | null) => !!type && /^[^;]*[/+]json\b/i.test(type);
const isForm = (type: string | null) => !!type && /^\s*application\/x-www-form-urlencoded\b/i.test(type);
const isMultipart = (type: string | null) => !!type && /^\s*multipart\//i.test(type);
const isTextType = (type: string | null) => !!type && /^\s*(text\/|application\/(?:[\w.+-]*\+)?(?:json|xml|javascript|graphql|x-www-form-urlencoded)\b)/i.test(type);

function utf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** A body sanitized by its type: JSON value by value, forms field by field, other text whole; binary bodies kept as recorded and flagged. */
export function sanitizeBody(body: RecordedBody, removed: Removed): SanitizedBody {
  const decoded = utf8(body.bytes);
  const textual = decoded !== null && (isTextType(body.type) || isMultipart(body.type) || (body.type === null && decoded !== ""));
  if (!textual || decoded === null) return { bytes: body.bytes, type: body.type, binary: true, changed: false };
  const before = removed.redacted + removed.tokens;
  let result = decoded;
  if (isJson(body.type) || (body.type === null && /^\s*[[{]/.test(decoded))) {
    try {
      result = JSON.stringify(sanitizeJson(JSON.parse(decoded) as unknown, removed));
    } catch {
      result = redactText(decoded, removed);
    }
  } else if (isForm(body.type)) {
    const fields = new URLSearchParams(decoded);
    const sanitized = new URLSearchParams();
    for (const [name, value] of fields) {
      if (CREDENTIAL_NAME.test(name) && value !== "" && !isPlaceholder(value)) {
        removed.redacted++;
        sanitized.append(name, REDACTED);
      } else sanitized.append(name, redactText(value, removed));
    }
    result = sanitized.toString();
  } else result = redactText(decoded, removed);
  const changed = removed.redacted + removed.tokens > before;
  return { bytes: changed ? new TextEncoder().encode(result) : body.bytes, type: body.type, binary: false, changed };
}

/** The address with credential query values redacted, and the parameters that held them. */
function sanitizeUrl(address: string, removed: Removed): { url: string; redactedParams: string[] } {
  const url = new URL(address);
  if (url.username || url.password) {
    url.username = "";
    url.password = "";
    removed.redacted++;
  }
  const redactedParams = new Set<string>();
  const query = new URLSearchParams();
  for (const [name, value] of url.searchParams) {
    if (CREDENTIAL_NAME.test(name) && value !== "") {
      if (!isPlaceholder(value)) removed.redacted++;
      redactedParams.add(name);
      query.append(name, REDACTED);
      continue;
    }
    const sanitized = redactText(value, removed);
    if (sanitized !== value) redactedParams.add(name);
    query.append(name, sanitized);
  }
  url.search = query.size ? `?${query.toString()}` : "";
  const path = url.pathname.replace(JWT, () => {
    removed.tokens++;
    return JWT_PLACEHOLDER;
  });
  return { url: `${url.origin}${path}${url.search}`, redactedParams: [...redactedParams] };
}

/** Counts a dropped credential header by its name as recorded. */
function dropped(removed: Removed, name: string): void {
  removed.headers[name] = (removed.headers[name] ?? 0) + 1;
}

/** +call+ with every credential and token-like value removed, and what was removed. */
export function sanitizeCall(call: RecordedCall): SanitizedCall {
  const removed = noneRemoved();
  removed.cookies = call.cookies;
  for (const [name] of call.requestHeaders) {
    const lower = name.toLowerCase();
    if (REQUEST_CREDENTIALS.has(lower) || isCredentialHeader(lower)) dropped(removed, name);
  }
  const responseHeaders: [string, string][] = [];
  let responseType = call.responseBody?.type ?? null;
  for (const [name, value] of call.responseHeaders) {
    const lower = name.toLowerCase();
    if (SET_COOKIE.has(lower) || isCredentialHeader(lower)) dropped(removed, name);
    else if (lower === "content-type") responseType ??= value;
    else if (!TRANSPORT_HEADERS.has(lower)) responseHeaders.push([name, redactText(value, removed)]);
  }
  const { url, redactedParams } = sanitizeUrl(call.url, removed);
  return {
    index: call.index,
    startedAt: call.startedAt,
    method: call.method,
    url,
    redactedParams,
    requestBody: call.requestBody ? sanitizeBody(call.requestBody, removed) : null,
    status: call.status,
    responseHeaders,
    responseBody: call.responseBody ? sanitizeBody({ ...call.responseBody, type: call.responseBody.type ?? responseType }, removed) : null,
    latencyMs: call.latencyMs,
    removed,
    frontendRegistry: call.frontendRegistry,
  };
}

/** Whether +type+ is a multipart body, which is never compared, since its boundary differs on every request. */
export function isMultipartType(type: string | null): boolean {
  return isMultipart(type);
}
