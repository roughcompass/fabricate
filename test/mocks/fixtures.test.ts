import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The HAR fixtures (add-mock-sets, design decision 20, task 1.3), written by
 * hand with made-up data in each browser's export layout. Orders portal's
 * session was recorded on a development host, so the build, which calls
 * https://api.orders.test, needs a set that matches any host.
 */

const DIRECTORY = path.join(import.meta.dirname, "..", "fixtures", "har");
const FILES = ["orders-portal.chrome.har", "orders-portal.firefox.har", "orders-portal.safari.har", "orders-portal.two-hosts.har", "quotes-desk.har"];

interface Header {
  name: string;
  value: string;
}
interface Entry {
  _resourceType?: string;
  _webSocketMessages?: unknown[];
  request: { method: string; url: string; headers: Header[]; cookies: unknown[]; postData?: { mimeType: string; text: string } };
  response: { status: number; headers: Header[]; cookies: unknown[]; content: { mimeType: string; text?: string; encoding?: string } };
}

const read = (file: string) => JSON.parse(fs.readFileSync(path.join(DIRECTORY, file), "utf8")) as { log: { version: string; creator: { name: string }; entries: Entry[] } };
const header = (headers: Header[], name: string) => headers.find((item) => item.name.toLowerCase() === name)?.value;
const body = (entry: Entry) => (entry.response.content.encoding === "base64" ? Buffer.from(entry.response.content.text ?? "", "base64").toString("utf8") : (entry.response.content.text ?? ""));

describe("the HAR fixtures", () => {
  it("are HAR 1.2 JSON, each in its browser's layout", () => {
    for (const file of FILES) {
      const har = read(file);
      expect(har.log.version, file).toBe("1.2");
      expect(Array.isArray(har.log.entries), file).toBe(true);
    }
    expect(read("orders-portal.chrome.har").log.creator.name).toBe("WebInspector");
    expect(read("orders-portal.firefox.har").log.creator.name).toBe("Firefox");
    expect(read("orders-portal.safari.har").log.creator.name).toBe("WebKit Web Inspector");
  });

  it("Firefox's and Safari's have no resource types, and record the same session as Chrome's", () => {
    const chrome = read("orders-portal.chrome.har").log.entries;
    for (const file of ["orders-portal.firefox.har", "orders-portal.safari.har"]) {
      const entries = read(file).log.entries;
      expect(fs.readFileSync(path.join(DIRECTORY, file), "utf8"), file).not.toContain("_resourceType");
      expect(entries.map((entry) => [entry.request.method, entry.request.url, entry.response.status]), file).toEqual(chrome.map((entry) => [entry.request.method, entry.request.url, entry.response.status]));
    }
  });

  it("Chrome's holds every planted case of design decision 20", () => {
    const entries = read("orders-portal.chrome.har").log.entries;
    const calls = entries.map((entry) => `${entry.request.method} ${entry.request.url}`);
    const api = "https://dev-api.orders.test/v1";
    // Every call the build makes, recorded on the development host, apart from the rates worker's.
    expect(calls).toEqual(
      expect.arrayContaining([
        `GET ${api}/orders?limit=5&_=1763650000000`,
        `GET ${api}/orders?limit=5&_=1763650004000`,
        `GET ${api}/accounts/42`,
        `POST ${api}/orders/search`,
        `POST ${api}/exports`,
        `GET ${api}/exports/9`,
        `GET ${api}/orders/stream`,
        "GET wss://dev-api.orders.test/v1/ticker",
      ]),
    );
    expect(calls.filter((call) => call.includes("/v1/rates"))).toEqual([]);
    // The page's own files.
    expect(entries.filter((entry) => ["document", "script", "stylesheet", "font", "image"].includes(entry._resourceType ?? "")).map((entry) => entry._resourceType)).toEqual(["document", "script", "script", "stylesheet", "font", "image"]);
    // Credentials: an Authorization header, cookies, Set-Cookie, a key in the query, a JWT, and a password.
    expect(entries.some((entry) => header(entry.request.headers, "authorization")?.startsWith("Bearer eyJ"))).toBe(true);
    expect(entries.some((entry) => header(entry.request.headers, "cookie") && entry.request.cookies.length > 0)).toBe(true);
    expect(entries.some((entry) => header(entry.response.headers, "set-cookie"))).toBe(true);
    expect(calls).toContain(`GET ${api}/regions?api_key=sk_test_123&limit=5`);
    const login = entries.find((entry) => entry.request.url === `${api}/session` && entry.request.method === "POST")!;
    expect(JSON.parse(body(login)).token).toMatch(/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/);
    expect(JSON.parse(login.request.postData!.text)).toEqual({ user: "test01", password: "hunter2" });
    // A base64 JSON body, and a 304 with a recorded body and one without.
    const account = entries.find((entry) => entry.request.url === `${api}/accounts/42`)!;
    expect([account.response.content.encoding, JSON.parse(body(account)).name]).toEqual(["base64", "Northwind Traders"]);
    const notModified = entries.filter((entry) => entry.response.status === 304);
    expect(notModified.map((entry) => entry.response.content.text !== undefined)).toEqual([true, false]);
    // Two search bodies, three polls, and two calls differing only by `_`.
    expect(entries.filter((entry) => entry.request.url === `${api}/orders/search`).map((entry) => entry.request.postData?.text)).toEqual(['{"status":"open"}', '{"status":"closed"}']);
    expect(entries.filter((entry) => entry.request.url === `${api}/exports/9`).map((entry) => JSON.parse(body(entry)).status)).toEqual(["pending", "pending", "ready"]);
    expect(entries.filter((entry) => entry.request.url.startsWith(`${api}/orders?`)).map((entry) => body(entry))).toHaveLength(2);
    // A PDF, a preflight, a WebSocket with its messages, and a call that got no answer.
    const pdf = entries.find((entry) => entry.response.content.mimeType === "application/pdf")!;
    expect(Buffer.from(pdf.response.content.text!, "base64").subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(entries.some((entry) => entry.request.method === "OPTIONS" && header(entry.request.headers, "access-control-request-method") === "POST")).toBe(true);
    expect(entries.find((entry) => entry._resourceType === "websocket")?._webSocketMessages?.length).toBeGreaterThan(0);
    expect(entries.filter((entry) => entry.response.status === 0)).toHaveLength(1);
  });

  it("records GET /v1/config on two hosts with different answers, and the desk's name for Quotes desk", () => {
    const configs = read("orders-portal.two-hosts.har").log.entries.filter((entry) => new URL(entry.request.url).pathname === "/v1/config");
    expect(configs.map((entry) => new URL(entry.request.url).origin)).toEqual(["https://dev-api.orders.test", "https://dev-auth.orders.test"]);
    expect(new Set(configs.map(body)).size).toBe(2);
    const desk = read("quotes-desk.har").log.entries.find((entry) => entry.request.url === "https://dev-api.quotes.test/v1/desk")!;
    expect(JSON.parse(body(desk)).name).toBe("FX desk");
  });
});
