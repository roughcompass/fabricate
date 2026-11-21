import type { CompiledResponse, CompiledSet } from "@/lib/mocks/compiled";
import { BODILESS_STATUSES, type Sequences, answerHeaders, inlineBytes, latencyFor, match, notMocked } from "@/lib/mocks/engine";
import { CONNECT_ERROR, type CallOutcome, type LoggedCall, MOCKS_CHANNEL } from "./mock-log";
import { type ArmedMocks, type MocksReadiness, type ViewTable, prefixes, rewriteImportMap, routeOf } from "./table";

/*
 * How the view's worker answers a view's API calls from its mock set
 * (add-mock-sets, design decision 2). The worker holds each view's compiled
 * set, fetched by revision before it says the view is armed, and counts
 * each rule's answers for the view, from the frame's latest document. For an
 * API-like call (`request.destination === ""`: fetch, XHR, and event
 * streams) from a client it handles, in order:
 *
 * 1. a request under a routed microfrontend's entry directory goes to the
 *    chosen build, as routing does;
 * 2. under the build's own path, the build answers first, and only its 404
 *    or 405 lets a rule answer, so a rule never hides a file of the build;
 * 3. the set's rule answers, or, when the set answers unmatched calls as not
 *    mocked, the 501 does;
 * 4. a request on a routed remote's origin follows routing's origin mapping;
 * 5. the rest go to their own address, fetched here with the original
 *    request, which keeps the browser's CORS and credential rules.
 *
 * Each call is logged on the `frontend-registry:mocks` channel with what
 * answered it.
 */

/** A view's set as the worker holds it: compiled, the revision the toolbar asked for, and each rule's answers since the frame's document loaded. */
interface HeldSet {
  /** The Frontend Registry's origin, which serves the set's endpoints. */
  readonly origin: string;
  readonly application: string;
  readonly compiled: CompiledSet;
  readonly asked: number;
  sequences: Sequences;
}

/** Each view's set, by view (viewId). */
const held = new Map<string, HeldSet>();
/** Response bodies too large to inline, by set and digest, fetched once when first used. */
const bodies = new Map<string, Promise<Uint8Array>>();

/** The longest request body kept for matching and for the log. */
const BODY_LIMIT = 64 * 1024;

/** The address of one of a set's endpoints, on the Frontend Registry's +origin+. */
const endpoint = (origin: string, application: string, set: string, rest: string) => new URL(`/api/applications/${encodeURIComponent(application)}/mock-sets/${encodeURIComponent(set)}/${rest}`, origin).href;

/**
 * Makes +mocks+, a set at a revision, ready for +view+: the set it holds
 * already when it's the one asked for, or the compiled set fetched now,
 * which may be newer than asked. A change of revision starts the rules'
 * answers over. Returns the revision ready, or why there's none.
 */
export async function readySet(view: string, mocks: ArmedMocks, origin: string): Promise<MocksReadiness> {
  const current = held.get(view);
  if (current && current.compiled.set === mocks.set && current.asked === mocks.revision) return { ok: true, revision: current.compiled.revision };
  held.delete(view);
  try {
    const response = await fetch(`${endpoint(origin, mocks.application, mocks.set, "compiled")}?revision=${mocks.revision}`, { cache: "no-store", credentials: "same-origin" });
    if (response.status === 404) return { ok: false, reason: "The mock set no longer exists." };
    if (!response.ok) return { ok: false, reason: `The mock set couldn't be fetched: the Frontend Registry answered ${response.status}.` };
    const compiled = (await response.json()) as CompiledSet;
    held.set(view, { origin, application: mocks.application, compiled, asked: mocks.revision, sequences: current?.compiled.set === compiled.set && current.compiled.revision === compiled.revision ? current.sequences : new Map() });
    return { ok: true, revision: compiled.revision };
  } catch {
    return { ok: false, reason: "The mock set couldn't be fetched from the Frontend Registry." };
  }
}

/** Forgets +view+'s set, when it applies none or is disarmed. */
export function dropSet(view: string): void {
  held.delete(view);
}

/** Starts +view+'s rules' answers over, as its frame loads a new document. */
export function restartSequences(view: string): void {
  const set = held.get(view);
  if (set) set.sequences = new Map();
}

/** Whether +view+, armed with +table+, has its set ready to answer. */
export function appliesSet(view: string, table: ViewTable): boolean {
  const set = held.get(view);
  return Boolean(table.mocks && set && set.compiled.set === table.mocks.set);
}

/** Whether +request+ is an API call a set may answer: fetch, XHR, or an event stream, never a document, script, style, image, font, or worker. */
export function apiLike(request: Request): boolean {
  return request.destination === "";
}

/** +request+'s body as text, when it has one of at most 64 KB; null otherwise. */
async function bodyText(request: Request): Promise<string | null> {
  if (request.method === "GET" || request.method === "HEAD") return null;
  try {
    const copy = request.clone();
    const stream = copy.body;
    if (!stream) {
      const text = await copy.text();
      return text && new TextEncoder().encode(text).length <= BODY_LIMIT ? text : null;
    }
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) {
        // A copy's cancel settles only once the request's own body is read too, which happens later or never.
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return size ? new TextDecoder().decode(bytes) : null;
  } catch {
    return null;
  }
}

/** A stored body's bytes, fetched once. */
function storedBody(set: HeldSet, digest: string): Promise<Uint8Array> {
  const key = `${set.compiled.set}/${digest}`;
  let body = bodies.get(key);
  if (!body) {
    body = fetch(endpoint(set.origin, set.application, set.compiled.set, `bodies/${encodeURIComponent(digest)}`), { cache: "no-store", credentials: "same-origin" }).then(async (response) => {
      if (!response.ok) throw new Error(`The rule's body couldn't be fetched: the Frontend Registry answered ${response.status}.`);
      return new Uint8Array(await response.arrayBuffer());
    });
    bodies.set(key, body);
    body.catch(() => bodies.delete(key));
  }
  return body;
}

/** Headers to answer with, leaving out any the browser refuses on a response. */
function headersOf(pairs: readonly (readonly [string, string])[]): Headers {
  const headers = new Headers();
  for (const [name, value] of pairs) {
    try {
      headers.append(name, value);
    } catch {
      // A name or value a response can't carry is left out.
    }
  }
  return headers;
}

/** An event stream's body: its events, then the stream stays open, so the page doesn't reconnect and receive them again. */
function openStream(bytes: Uint8Array | null): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (bytes?.byteLength) controller.enqueue(bytes);
    },
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A rule's response as the browser receives it, after the view's latency. */
async function ruleResponse(set: HeldSet, response: CompiledResponse, latency: ArmedMocks["latency"]): Promise<Response> {
  const ms = latencyFor(response, latency);
  if (ms) await wait(ms);
  const bytes = response.body === null ? null : "inline" in response.body ? inlineBytes(response.body) : await storedBody(set, response.body.digest);
  const headers = headersOf(answerHeaders(response));
  if (BODILESS_STATUSES.has(response.status)) return new Response(null, { status: response.status, headers });
  const stream = (headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream");
  return new Response(stream ? openStream(bytes) : (bytes as BodyInit | null), { status: response.status, headers });
}

/** An import map's JSON, rewritten for the view's routes; anything else as it is. */
async function routedJson(request: Request, response: Response, table: ViewTable): Promise<Response> {
  if (!/\.json(\?|#|$)|importmap/i.test(new URL(request.url).pathname) || !(response.headers.get("content-type") ?? "").includes("json")) return response;
  const rewritten = rewriteImportMap(await response.clone().text(), table.routes);
  if (rewritten === null) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  return new Response(rewritten, { status: response.status, statusText: response.statusText, headers });
}

let channel: BroadcastChannel | null = null;
let nextEntry = 0;

/** Tells the toolbar about a call. */
function log(entry: Omit<LoggedCall, "type" | "id">): void {
  try {
    channel ??= new BroadcastChannel(MOCKS_CHANNEL);
    channel.postMessage({ type: MOCKS_CHANNEL, id: `${Date.now().toString(36)}-${(nextEntry++).toString(36)}`, ...entry } satisfies LoggedCall);
  } catch {
    // A log that can't be sent leaves the call as it was answered.
  }
}

/** Where a call came from, for its log entry. */
export interface CallSource {
  readonly view: string;
  /** The page that made the call, once it's known: a page names itself to the worker as it starts, which can be after its first calls. */
  readonly page: () => string | null;
  /** The Frontend Registry's origin, which relative calls use. */
  readonly origin: string;
}

/**
 * Answers +request+, an API-like call from a client of the view +source+
 * names, armed with +table+, whose set is ready (appliesSet), in the order
 * of handling, and logs what answered it.
 */
export async function answerCall(request: Request, table: ViewTable, source: CallSource): Promise<Response> {
  const set = held.get(source.view)!;
  const started = Date.now();
  const routed = routeOf(request.url, prefixes(table));
  const method = request.method.toUpperCase();
  const record = (outcome: CallOutcome, details: { status?: number | null; error?: string | null; rule?: LoggedCall["rule"]; body?: string | null }) =>
    log({ view: source.view, page: source.page(), method, url: request.url, outcome, rule: details.rule ?? null, status: details.status ?? null, error: details.error ?? null, at: started, durationMs: Date.now() - started, body: details.body ?? null, set: set.compiled.set, revision: set.compiled.revision });
  /** A call answered at its own address, or one routing sent elsewhere: passed through, or failed with a status of 400 or more. */
  const passed = (response: Response, body: string | null) => {
    const failed = response.type !== "opaque" && response.status >= 400;
    record(failed ? "failed" : "passed", { status: response.type === "opaque" ? null : response.status, body: failed ? body : null });
    return routedJson(request, response, table);
  };
  const unreachable = (body: string | null) => {
    record("failed", { error: CONNECT_ERROR, body });
    return Response.error();
  };

  // 1. A routed microfrontend's own files go to the chosen build.
  if (routed?.kind === "entry" && method === "GET") return passed(await fetch(routed.to, { credentials: "same-origin" }), null);

  const body = await bodyText(request);
  // 2. Under the build's own path, the build answers first.
  let own: Response | null = null;
  if (request.url.startsWith(new URL(table.scope, source.origin).href)) {
    try {
      own = await fetch(request.clone());
    } catch {
      return unreachable(body);
    }
    if (own.status !== 404 && own.status !== 405) return passed(own, body);
  }

  // 3. The set's rule, or its answer for calls no rule matches.
  const result = match(set.compiled, { method, url: request.url, body }, { origin: source.origin, base: table.scope }, set.sequences);
  if (result.kind === "rule") {
    const rule = { id: result.rule.id, label: result.rule.label, response: result.index + 1 };
    try {
      const response = await ruleResponse(set, result.response, table.mocks?.latency ?? "off");
      record("mocked", { status: result.response.status, rule });
      return response;
    } catch (error) {
      record("failed", { rule, error: error instanceof Error ? error.message : String(error), body });
      return Response.error();
    }
  }
  if (result.kind === "unmatched" && set.compiled.unmatched === "not-mocked") {
    const answer = notMocked(set.compiled, { method, url: request.url });
    record("not-matched", { status: answer.status, body });
    return new Response(answer.body, { status: answer.status, headers: headersOf(answer.headers) });
  }

  // The build's own 404 is the call's own answer.
  if (own) return passed(own, body);
  try {
    // 4. A routed remote's origin follows routing's mapping.
    if (routed?.kind === "origin" && method === "GET") return await passed(await fetch(routed.to, { credentials: "same-origin" }), body);
    // 5. Anything else goes to its own address.
    return await passed(await fetch(request), body);
  } catch {
    return unreachable(body);
  }
}
