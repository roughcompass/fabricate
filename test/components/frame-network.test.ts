// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Untagged } from "@/components/toolbar/inspector/agent-post";
import { reportNetwork } from "@/components/toolbar/inspector/agent-network";

/*
 * The frame agent's network module (add-mock-sets, design decision 3, task
 * 9.1): it reports a page's WebSocket connections and service worker
 * registrations, which mock sets can't answer, without changing what the
 * page gets, and never a message's content; and it names the page to the
 * Frontend Registry's worker that controls it.
 */

const posted: Untagged[] = [];
/** What the page told each worker that controlled it, by the worker's script. */
const told: [string, unknown][] = [];
const controller = (scriptURL: string) => ({ scriptURL, postMessage: (message: unknown) => told.push([scriptURL, message]) });
const originalSocket = globalThis.WebSocket;

/** The browser's service worker container, as a page that registers its own sees it. */
class FakeContainer {
  controller: ReturnType<typeof controller> | null = null;
  readonly registered = Promise.resolve({ scope: "registered" });
  register(..._args: unknown[]): Promise<unknown> {
    return this.registered;
  }
}

const container = new FakeContainer();

beforeAll(() => {
  Object.assign(globalThis, { ServiceWorkerContainer: FakeContainer });
  Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  container.controller = controller(`${window.location.origin}/toolbar/routing-worker.js`);
  reportNetwork((message) => posted.push(message), "page-1");
});

afterEach(() => {
  posted.length = 0;
});

const sockets = () => posted.flatMap((message) => (message.kind === "websocket" ? [message.socket] : []));

describe("the page's WebSockets", () => {
  it("are real WebSockets, with their constants, and subclasses still work", () => {
    expect(globalThis.WebSocket).not.toBe(originalSocket);
    const socket = new WebSocket("ws://127.0.0.1:9/ticker");
    expect(socket instanceof WebSocket).toBe(true);
    expect(socket instanceof originalSocket).toBe(true);
    expect(WebSocket.OPEN).toBe(1);
    expect(socket.OPEN).toBe(1);
    expect(WebSocket.prototype).toBe(originalSocket.prototype);
    class Ticker extends WebSocket {
      kind = "ticker";
    }
    const ticker = new Ticker("ws://127.0.0.1:9/other");
    expect(ticker).toBeInstanceOf(Ticker);
    expect(ticker).toBeInstanceOf(WebSocket);
    expect(ticker.kind).toBe("ticker");
    socket.close();
    ticker.close();
  });

  it("are reported by address, then as failed when they never opened, without their messages", async () => {
    const url = "ws://127.0.0.1:9/v1/ticker";
    const socket = new WebSocket(url);
    const ticker = () => sockets().filter((each) => each.url === url);
    expect(ticker()).toEqual([{ id: expect.any(Number), url, state: "connecting" }]);
    await new Promise<void>((resolve) => socket.addEventListener("close", () => resolve()));
    expect(ticker().map((each) => each.state)).toEqual(["connecting", "failed"]);
    // Only addresses and states are ever reported.
    for (const message of posted) expect(Object.keys(message.kind === "websocket" ? message.socket : {}).sort()).toEqual(["id", "state", "url"]);
  });

  it("refuses what the browser refuses, as before", () => {
    expect(() => new WebSocket("http://127.0.0.1:9/")).toThrow();
    expect(sockets().filter((each) => each.state === "connecting")).toEqual([]);
  });
});

describe("the page's service worker registrations", () => {
  it("are reported with their script and scope, and register returns the original's promise", () => {
    const result = navigator.serviceWorker.register("sw.js");
    expect(result).toBe(container.registered);
    expect(posted).toContainEqual({ kind: "service-worker", registration: { script: new URL("sw.js", document.baseURI).href, scope: new URL("./", document.baseURI).href } });
    navigator.serviceWorker.register("/assets/sw.js", { scope: "/app/" });
    expect(posted).toContainEqual({ kind: "service-worker", registration: { script: `${window.location.origin}/assets/sw.js`, scope: `${window.location.origin}/app/` } });
  });
});

describe("the page's id", () => {
  it("is told to the Frontend Registry's worker that controls the page", () => {
    expect(told).toEqual([[`${window.location.origin}/toolbar/routing-worker.js`, { type: "frontend-registry:mocks", page: "page-1" }]]);
  });

  it("isn't told to another worker", () => {
    container.controller = controller(`${window.location.origin}/sw.js`);
    reportNetwork(() => {}, "page-2");
    expect(told.map(([script]) => script)).not.toContain(`${window.location.origin}/sw.js`);
  });
});
