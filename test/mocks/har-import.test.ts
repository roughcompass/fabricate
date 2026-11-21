import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HAR_ENTRY_LIMIT, HarFormatError, IMPORT_BODY_LIMIT, LEFT_OUT_REASONS, readHar } from "@/lib/mocks/har-import";

/*
 * Reading a HAR file (add-mock-sets, design decision 12, steps 2 to 4, tasks
 * 3.1 and 3.2; mock-set-import spec): Chrome's, Firefox's, and Safari's
 * exports of one session keep the same API calls; the page's files, the
 * preflight, the WebSocket, and the call with no answer are left out, each
 * saying why; and bodies are decoded.
 */

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "har", name), "utf8");
const har = (entries: unknown[], version = "1.2") => JSON.stringify({ log: { version, creator: { name: "test" }, entries } });

/** An entry for +url+ as Firefox records one, without a resource type. */
function entry(url: string, options: { method?: string; status?: number; dest?: string | null; mimeType?: string; text?: string; encoding?: string; size?: number; type?: string } = {}) {
  const headers = options.dest === null ? [] : [{ name: "Sec-Fetch-Dest", value: options.dest ?? "empty" }];
  return {
    startedDateTime: "2026-11-19T10:00:00.000Z",
    time: 12,
    ...(options.type && { _resourceType: options.type }),
    request: { method: options.method ?? "GET", url, headers, cookies: [], queryString: [] },
    response: { status: options.status ?? 200, headers: [], cookies: [], content: { mimeType: options.mimeType ?? "application/json", size: options.size ?? (options.text ?? "{}").length, ...(options.text !== undefined ? { text: options.text } : options.size === undefined ? { text: "{}" } : {}), ...(options.encoding && { encoding: options.encoding }) } },
    timings: { wait: 10 },
  };
}

describe("reading a HAR file", () => {
  const read = (browser: string) => readHar(fixture(`orders-portal.${browser}.har`));
  const kept = (browser: string) => read(browser).calls.map((call) => `${call.method} ${call.url} ${call.status}`);

  it("Firefox's export: keeps the same API calls as Chrome's export of the same session, and Safari's too", () => {
    const chrome = kept("chrome");
    expect(chrome).toHaveLength(14);
    expect(kept("firefox")).toEqual(chrome);
    expect(kept("safari")).toEqual(chrome);
    for (const browser of ["chrome", "firefox", "safari"]) expect(read(browser).entryCount).toBe(24);
  });

  it("leaves out the page's files, the preflight, the WebSocket, and the call with no answer, each with its reason", () => {
    for (const browser of ["chrome", "firefox", "safari"]) {
      const { leftOut } = read(browser);
      expect(leftOut.map((item) => item.reason), browser).toEqual(["page-file", "page-file", "page-file", "page-file", "page-file", "page-file", "preflight", "websocket", "cached-without-body", "no-response"]);
      expect(leftOut.find((item) => item.reason === "websocket")?.url).toBe("wss://dev-api.orders.test/v1/ticker");
    }
    expect(LEFT_OUT_REASONS).toMatchObject({ "page-file": "The page's own file, which mock sets never answer", websocket: "WebSocket connections can't be mocked yet", "no-response": "No response was recorded" });
  });

  it("A page's assets: keeps six API calls, and lists the page's own files as left out", () => {
    const page = ["document", "script", "script", "stylesheet", "font", "image"].map((type, index) => entry(`https://dev-portal.orders.test/file-${index}`, { type, mimeType: "text/html", text: "x" }));
    const api = ["fetch", "xhr", "fetch", "eventsource", "xhr", "fetch"].map((type, index) => entry(`https://dev-api.orders.test/v1/call-${index}`, { type }));
    const result = readHar(har([...page, ...api]));
    expect(result.calls).toHaveLength(6);
    expect(result.leftOut.map((item) => item.reason)).toEqual(Array(6).fill("page-file"));
  });

  it("recognizes calls without resource types by Sec-Fetch-Dest, or without it by a JSON, GraphQL, or event-stream answer", () => {
    const result = readHar(
      har([
        entry("https://api.test/v1/a", { dest: "empty", mimeType: "text/plain", text: "ok" }),
        entry("https://api.test/v1/b", { dest: "script", mimeType: "application/json" }),
        entry("https://api.test/v1/c", { dest: null, mimeType: "application/json" }),
        entry("https://api.test/v1/d", { dest: null, mimeType: "application/graphql-response+json" }),
        entry("https://api.test/v1/e", { dest: null, mimeType: "text/event-stream", text: "data: 1\n\n" }),
        entry("https://api.test/v1/f", { dest: null, mimeType: "text/html", text: "<p>" }),
      ]),
    );
    expect(result.calls.map((call) => call.url.slice(-1))).toEqual(["a", "c", "d", "e"]);
  });

  it("Not a HAR file: refuses JSON with no log.entries, other versions, and what isn't JSON, saying how to export one", () => {
    for (const source of ['{"log":{}}', '{"entries":[]}', har([], "2.0"), "not json"]) {
      expect(() => readHar(source)).toThrow(HarFormatError);
    }
    expect(() => readHar("{}")).toThrow(/isn't a HAR file. Export one from the browser's network panel/);
    expect(readHar(har([], "1.1")).calls).toEqual([]);
  });

  it(`reads at most ${HAR_ENTRY_LIMIT} entries, and says how many it left out past them`, () => {
    const entries = Array.from({ length: HAR_ENTRY_LIMIT + 3 }, (_, index) => entry(`https://api.test/v1/items/${index}`));
    const result = readHar(har(entries));
    expect([result.calls.length, result.entryCount, result.beyondLimit]).toEqual([HAR_ENTRY_LIMIT, HAR_ENTRY_LIMIT + 3, 3]);
  });

  it("drops HTTP/2 pseudo-headers, and keeps the latency recorded up to 30 seconds", () => {
    const chrome = read("chrome").calls[1]!;
    expect(chrome.requestHeaders.some(([name]) => name.startsWith(":"))).toBe(false);
    const slow = { ...entry("https://api.test/v1/slow"), timings: { wait: 45_000 } };
    expect(readHar(har([slow])).calls[0]!.latencyMs).toBe(30_000);
  });
});

describe("bodies are decoded (task 3.2)", () => {
  it("A base64 body: the rule's response holds the decoded JSON", () => {
    const account = readHar(fixture("orders-portal.chrome.har")).calls.find((call) => call.url.endsWith("/v1/accounts/42"))!;
    expect(JSON.parse(new TextDecoder().decode(account.responseBody!.bytes)).name).toBe("Northwind Traders");
    const encoded = entry("https://api.test/v1/b64", { text: Buffer.from('{"ok":true}').toString("base64"), encoding: "base64" });
    expect(new TextDecoder().decode(readHar(har([encoded])).calls[0]!.responseBody!.bytes)).toBe('{"ok":true}');
  });

  it("keeps a 304 with a recorded body as a 200, and leaves one without a body out", () => {
    const result = readHar(har([entry("https://api.test/v1/settings", { status: 304, text: '{"digest":true}' }), entry("https://api.test/v1/preferences", { status: 304, size: 0 })]));
    expect(result.calls.map((call) => [call.url, call.status])).toEqual([["https://api.test/v1/settings", 200]]);
    expect(result.leftOut.map((item) => item.reason)).toEqual(["cached-without-body"]);
  });

  it("Exported without content: leaves calls out, saying to export the HAR with content, apart from those with no body to export", () => {
    const result = readHar(har([entry("https://api.test/v1/orders", { size: 120 }), entry("https://api.test/v1/done", { status: 204, size: -1 }), entry("https://api.test/v1/empty", { size: 0 })]));
    expect(result.leftOut).toEqual([{ method: "GET", url: "https://api.test/v1/orders", reason: "no-content" }]);
    expect(LEFT_OUT_REASONS["no-content"]).toBe("Its body wasn't exported. Export the HAR with content.");
    expect(result.calls.map((call) => [call.status, call.responseBody])).toEqual([
      [204, null],
      [200, null],
    ]);
  });

  it("leaves out a body over 5 MB", () => {
    const large = entry("https://api.test/v1/large", { text: "x".repeat(IMPORT_BODY_LIMIT + 1) });
    expect(readHar(har([large])).leftOut.map((item) => item.reason)).toEqual(["too-large"]);
  });
});
