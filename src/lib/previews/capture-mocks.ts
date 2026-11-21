import type { BrowserContext, CDPSession, Page, Request } from "playwright-core";
import { redact } from "@/lib/git/redact";
import type { CompiledSet } from "@/lib/mocks/compiled";
import { BODILESS_STATUSES, type Sequences, answerHeaders, inlineBytes, match, notMocked } from "@/lib/mocks/engine";
import { readBody } from "@/lib/mocks/storage";
import type { FailedCallKind } from "@/lib/db/schema";
import { type CaptureRecord, FAILED_CALLS_KEPT } from "./screenshots";

/*
 * Screenshots with mock sets (add-mock-sets, design decision 11): a capture
 * applies the default set of the build's target through the same matching
 * engine as the browser, and records the API calls that still failed.
 *
 * - Only fetch, XHR, and event-source requests are matched; a build's own
 *   files always load as built. Under the build's base, the build is asked
 *   first, and only a 404 or 405 lets a rule answer. Rules answer at once,
 *   without latency; a call no rule matches gets the 501 when the set says
 *   so, and otherwise goes to its own address.
 * - A failure is an API call no rule answered that answered 400 or more,
 *   couldn't connect, was blocked by CORS (which the CDP session's
 *   `Network.loadingFailed` tells apart), or was answered as not mocked, and
 *   a WebSocket that closed or failed before its handshake. A rule's own 4xx
 *   or 5xx isn't one. Distinct calls are keyed by method and redacted
 *   address, and counted.
 */

const API_TYPES = new Set(["fetch", "xhr", "eventsource"]);
const CDP_API_TYPES = new Set(["Fetch", "XHR", "EventSource"]);
/** The longest address a failed call keeps. */
const URL_LIMIT = 2048;

interface Failure {
  readonly method: string;
  readonly url: string;
  readonly kind: FailedCallKind;
  readonly status: number | null;
  readonly error: string | null;
}

/** The calls that failed during one capture, distinct by method and redacted address, in the order they first failed. */
class FailureRecorder {
  private readonly failures = new Map<string, Failure & { occurrences: number }>();

  add(failure: Failure): void {
    const url = redact(failure.url).slice(0, URL_LIMIT);
    const key = `${failure.method} ${url}`;
    const known = this.failures.get(key);
    if (known) known.occurrences++;
    else this.failures.set(key, { ...failure, url, error: failure.error ? redact(failure.error).slice(0, 200) : null, occurrences: 1 });
  }

  record(): CaptureRecord["failures"] {
    const calls = [...this.failures.values()];
    return { total: calls.length, calls: calls.slice(0, FAILED_CALLS_KEPT).map(({ method, url, kind, status, error, occurrences }) => ({ method: method.slice(0, 20), url, kind, status, error, occurrences })) };
  }
}

export interface CaptureMocks {
  /** The default set compiled, or null for none. */
  readonly set: CompiledSet | null;
  /** The directory its larger bodies are read from. */
  readonly directory: string | null;
}

/**
 * Applies +mocks+ to every request of +context+, and starts recording the
 * calls of +page+ that fail, through +session+, which must be open before
 * the page navigates. Returns what to call once the page settled, for the
 * record.
 */
export async function applyMocks(context: BrowserContext, page: Page, session: CDPSession, options: { origin: string; base: string; mocks: CaptureMocks }): Promise<() => CaptureRecord["failures"]> {
  const recorder = new FailureRecorder();
  const answered = new WeakSet<Request>();
  const { set, directory } = options.mocks;
  const sequences: Sequences = new Map();

  // CORS failures and WebSockets are only told apart in the DevTools protocol.
  const requests = new Map<string, { url: string; method: string; type: string }>();
  const cors = new Set<string>();
  const sockets = new Map<string, { url: string; opened: boolean; failed: boolean; closed: boolean }>();
  session.on("Network.requestWillBeSent", (event) => requests.set(event.requestId, { url: event.request.url, method: event.request.method, type: event.type ?? "" }));
  session.on("Network.loadingFailed", (event) => {
    if (event.corsErrorStatus && CDP_API_TYPES.has(event.type)) cors.add(`${requests.get(event.requestId)?.method ?? "GET"} ${requests.get(event.requestId)?.url ?? ""}`);
  });
  session.on("Network.webSocketCreated", (event) => sockets.set(event.requestId, { url: event.url, opened: false, failed: false, closed: false }));
  session.on("Network.webSocketHandshakeResponseReceived", (event) => {
    const socket = sockets.get(event.requestId);
    if (socket) socket.opened = true;
  });
  session.on("Network.webSocketFrameError", (event) => {
    const socket = sockets.get(event.requestId);
    if (socket) socket.failed = true;
  });
  session.on("Network.webSocketClosed", (event) => {
    const socket = sockets.get(event.requestId);
    if (socket) socket.closed = true;
  });
  await session.send("Network.enable");

  const failed: { method: string; url: string; error: string }[] = [];
  page.on("requestfailed", (request) => {
    if (!API_TYPES.has(request.resourceType()) || answered.has(request)) return;
    const error = request.failure()?.errorText ?? "";
    // A request the page itself cancelled, as navigating away does, didn't fail.
    if (/ERR_ABORTED/.test(error)) return;
    failed.push({ method: request.method(), url: request.url(), error });
  });
  page.on("response", (response) => {
    const request = response.request();
    if (!API_TYPES.has(request.resourceType()) || answered.has(request) || response.status() < 400) return;
    recorder.add({ method: request.method(), url: request.url(), kind: "status", status: response.status(), error: null });
  });

  if (set) {
    const scope = `${options.origin}${options.base}`;
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (!API_TYPES.has(request.resourceType())) return route.fallback();
      const url = request.url();
      // The build answers first under its own path: only a path it has no file for can be mocked.
      const fetched = url.startsWith(scope) ? await route.fetch() : null;
      if (fetched && fetched.status() !== 404 && fetched.status() !== 405) return route.fulfill({ response: fetched });
      const result = match(set, { method: request.method(), url, body: request.postData() }, { origin: options.origin, base: options.base }, sequences);
      if (result.kind === "rule") {
        answered.add(request);
        const { response } = result;
        const body = response.body === null || BODILESS_STATUSES.has(response.status) ? undefined : "inline" in response.body ? Buffer.from(inlineBytes(response.body)) : (readBody(directory ?? "", response.body.digest) ?? undefined);
        return route.fulfill({ status: response.status, headers: Object.fromEntries(answerHeaders(response)), body });
      }
      if (result.kind === "unmatched" && set.unmatched === "not-mocked") {
        answered.add(request);
        const answer = notMocked(set, { method: request.method(), url });
        recorder.add({ method: request.method(), url, kind: "not_mocked", status: answer.status, error: null });
        return route.fulfill({ status: answer.status, headers: Object.fromEntries(answer.headers), body: answer.body });
      }
      return fetched ? route.fulfill({ response: fetched }) : route.fallback();
    });
  }

  return () => {
    for (const call of failed) recorder.add({ method: call.method, url: call.url, kind: cors.has(`${call.method} ${call.url}`) ? "cors" : "connect", status: null, error: call.error });
    for (const socket of sockets.values()) if (!socket.opened && (socket.failed || socket.closed)) recorder.add({ method: "GET", url: socket.url, kind: "websocket", status: null, error: "The WebSocket closed before it opened" });
    return recorder.record();
  };
}
