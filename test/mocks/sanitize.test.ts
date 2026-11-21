import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type RecordedCall, readHar } from "@/lib/mocks/har-import";
import { JWT_PLACEHOLDER, noneRemoved, redactText, sanitizeBody, sanitizeCall } from "@/lib/mocks/sanitize";

/*
 * Removing credentials before anything is stored (add-mock-sets, design
 * decision 12, step 5, task 3.3; mock-set-import spec, "Credentials are
 * removed before anything is stored" and "Token-like values are replaced").
 */

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln";
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function call(values: Partial<RecordedCall>): RecordedCall {
  return { index: 0, startedAt: 0, method: "GET", url: "https://dev-api.orders.test/v1/orders", requestHeaders: [], cookies: 0, requestBody: null, status: 200, responseHeaders: [], responseBody: null, latencyMs: 0, frontendRegistry: undefined, ...values };
}

describe("sanitizing a call", () => {
  it("An Authorization header: no stored request header holds it, and every request header but Content-Type goes", () => {
    const sanitized = sanitizeCall(call({ requestHeaders: [["Authorization", `Bearer ${JWT}`], ["Cookie", "session=s3ss10n-f4k3-0001"], ["X-Api-Key", "ak_live_f4k3k3y0001"], ["Accept", "application/json"]], cookies: 2 }));
    expect(sanitized.removed).toEqual({ headers: { Authorization: 1, Cookie: 1, "X-Api-Key": 1 }, cookies: 2, redacted: 0, tokens: 0 });
    expect(JSON.stringify(sanitized)).not.toContain(JWT);
  });

  it("drops Set-Cookie, credential headers, and transport headers from responses, keeping the rest redacted", () => {
    const sanitized = sanitizeCall(
      call({
        responseHeaders: [
          ["Set-Cookie", "session=1; HttpOnly"],
          ["X-Session-Token", "tok_f4k3_0002"],
          ["Content-Length", "20"],
          ["Content-Encoding", "gzip"],
          ["Strict-Transport-Security", "max-age=1"],
          ["Date", "Thu"],
          ["Access-Control-Allow-Credentials", "true"],
          ["Content-Type", "application/json"],
          ["X-Request-Id", "req-1"],
          ["Link", `<https://api.test/next?token=${JWT}>`],
        ],
        responseBody: { bytes: encode("{}"), type: null },
      }),
    );
    expect(sanitized.responseHeaders).toEqual([
      ["Access-Control-Allow-Credentials", "true"],
      ["X-Request-Id", "req-1"],
      ["Link", "<https://api.test/next?token=[REDACTED]"],
    ]);
    expect(sanitized.responseBody?.type).toBe("application/json");
    expect(sanitized.removed.headers).toEqual({ "Set-Cookie": 1, "X-Session-Token": 1 });
    expect(sanitized.removed.tokens).toBe(1);
  });

  it("A key in the query: the query holds api_key redacted, and the rule will ignore it", () => {
    const sanitized = sanitizeCall(call({ url: "https://dev-api.orders.test/v1/regions?api_key=sk_test_123&limit=5" }));
    expect(sanitized.url).toBe("https://dev-api.orders.test/v1/regions?api_key=%5BREDACTED%5D&limit=5");
    expect(sanitized.redactedParams).toEqual(["api_key"]);
    expect(sanitized.removed.redacted).toBe(1);
  });

  it("replaces a token-like value in a query value or the path", () => {
    const sanitized = sanitizeCall(call({ url: `https://api.test/v1/reset/${JWT}?next=${JWT}` }));
    expect(sanitized.url).toBe(`https://api.test/v1/reset/${JWT_PLACEHOLDER}?next=%5BREDACTED-JWT%5D`);
    expect(sanitized.removed.tokens).toBe(2);
    expect(sanitized.redactedParams).toEqual(["next"]);
  });
});

describe("sanitizing bodies", () => {
  it("A password in a JSON body: the stored body is valid JSON with the password redacted, marked changed", () => {
    const removed = noneRemoved();
    const body = sanitizeBody({ bytes: encode('{"user":"test01","password":"hunter2"}'), type: "application/json" }, removed);
    expect(JSON.parse(decode(body.bytes))).toEqual({ user: "test01", password: "[REDACTED]" });
    expect([body.changed, removed.redacted]).toEqual([true, 1]);
  });

  it("A login response: the token becomes the placeholder, counted as one token-like value", () => {
    const removed = noneRemoved();
    const body = sanitizeBody({ bytes: encode(`{"token":"${JWT}","user":{"id":"u-1"}}`), type: "application/json" }, removed);
    expect(JSON.parse(decode(body.bytes))).toEqual({ token: JWT_PLACEHOLDER, user: { id: "u-1" } });
    expect([removed.tokens, removed.redacted]).toEqual([1, 0]);
  });

  it("keeps minified JSON valid, with later members intact, when a value holds a pattern that runs to the end of a line", () => {
    const removed = noneRemoved();
    const body = sanitizeBody({ bytes: encode('{"note":"authorization: x","items":[1,2],"next":"keep"}'), type: "application/json" }, removed);
    expect(JSON.parse(decode(body.bytes))).toEqual({ note: "authorization: [REDACTED]", items: [1, 2], next: "keep" });
  });

  it("walks nested members and arrays, and leaves an untouched body as recorded", () => {
    const removed = noneRemoved();
    const body = sanitizeBody({ bytes: encode('{"accounts":[{"name":"A","apiKey":"k1"},{"name":"B","credentials":{"user":"x"}}]}'), type: "application/json; charset=utf-8" }, removed);
    expect(JSON.parse(decode(body.bytes))).toEqual({ accounts: [{ name: "A", apiKey: "[REDACTED]" }, { name: "B", credentials: "[REDACTED]" }] });
    const plain = encode('{ "orders": [] }');
    const untouched = sanitizeBody({ bytes: plain, type: "application/json" }, noneRemoved());
    expect([untouched.bytes, untouched.changed]).toEqual([plain, false]);
  });

  it("redacts form fields one by one, and other text whole", () => {
    const form = sanitizeBody({ bytes: encode("user=test01&password=hunter2&note=hi"), type: "application/x-www-form-urlencoded" }, noneRemoved());
    expect(decode(form.bytes)).toBe("user=test01&password=%5BREDACTED%5D&note=hi");
    const text = sanitizeBody({ bytes: encode(`id: 1\nAuthorization: Bearer ${JWT}\ndone`), type: "text/plain" }, noneRemoved());
    expect(decode(text.bytes)).toBe(`id: 1\nAuthorization: [REDACTED]\ndone`);
  });

  it("A binary body: kept as recorded, unscanned, and flagged", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00]);
    const body = sanitizeBody({ bytes: pdf, type: "application/pdf" }, noneRemoved());
    expect([body.binary, body.bytes, body.changed]).toEqual([true, pdf, false]);
  });

  it("counts redactions in text", () => {
    const removed = noneRemoved();
    expect(redactText("NPM_TOKEN=abc and npm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", removed)).toBe("NPM_TOKEN=[REDACTED] and [REDACTED]");
    expect(removed.redacted).toBe(2);
  });
});

describe("the Chrome fixture", () => {
  it("keeps none of its planted secrets", () => {
    const calls = readHar(fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "har", "orders-portal.chrome.har"), "utf8")).calls.map(sanitizeCall);
    const stored = JSON.stringify(calls.map((call) => ({ ...call, requestBody: call.requestBody && decode(call.requestBody.bytes), responseBody: call.responseBody && !call.responseBody.binary ? decode(call.responseBody.bytes) : null })));
    for (const secret of [JWT, "hunter2", "sk_test_123", "s3ss10n-f4k3-0001", "tok_f4k3_0002", "ak_live_f4k3k3y0001"]) expect(stored, secret).not.toContain(secret);
  });
});
