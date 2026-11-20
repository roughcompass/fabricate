import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { WORKSPACE_COOKIE, isWorkspaceKey } from "@/lib/workspaces/workspace-key";
import { config, proxy } from "@/proxy";

const request = (path: string, cookie?: string) => new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

// The request proxy issues the anonymous workspace cookie (design.md, decision 3).
describe("workspace proxy", () => {
  it("issues an httpOnly, SameSite=Lax workspace cookie on a first request for applications", () => {
    const response = proxy(request("/applications"));
    const setCookie = response.headers.get("set-cookie") ?? "";
    const value = response.cookies.get(WORKSPACE_COOKIE)?.value;

    expect(isWorkspaceKey(value)).toBe(true);
    expect(setCookie).toMatch(new RegExp(`^${WORKSPACE_COOKIE}=`));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=34560000/);
    expect(setCookie).not.toMatch(/Secure/i);
  });

  it("marks the cookie Secure over HTTPS", () => {
    const response = proxy(new NextRequest("https://registry.example.com/applications"));
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("forwards the new cookie to the page rendering the same request", () => {
    const response = proxy(request("/applications", "theme=dark"));
    const value = response.cookies.get(WORKSPACE_COOKIE)!.value;
    const forwarded = response.headers.get("x-middleware-request-cookie") ?? "";

    expect(forwarded).toContain(`${WORKSPACE_COOKIE}=${value}`);
    expect(forwarded).toContain("theme=dark");
  });

  it("issues the cookie only once", () => {
    const first = proxy(request("/applications")).cookies.get(WORKSPACE_COOKIE)!.value;
    const second = proxy(request("/run/orders-portal/accounts", `${WORKSPACE_COOKIE}=${first}`));

    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("replaces a malformed credential", () => {
    const response = proxy(request("/applications", `${WORKSPACE_COOKIE}=not-a-key`));
    expect(isWorkspaceKey(response.cookies.get(WORKSPACE_COOKIE)?.value)).toBe(true);
  });

  it("gives every visitor a different credential", () => {
    const keys = new Set(Array.from({ length: 50 }, () => proxy(request("/applications")).cookies.get(WORKSPACE_COOKIE)!.value));
    expect(keys.size).toBe(50);
  });

  it.each(["/s/abc", "/applications", "/applications/orders-portal", "/run/orders-portal/accounts", "/api/workspace/hints", "/api/workspace/threads"])(
    "runs on the applications path %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    },
  );

  it.each(["/", "/repositories", "/standards", "/assessments/new", "/runs/asm_0000000000000001", "/design-system", "/api/health", "/api/test/reset", "/templates", "/templates/market-watch/preview", "/running", "/newsroom", "/applicationsx"])(
    "issues no credential on the operator path %s",
    (url) => {
      const response = proxy(request(url));
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it.each(["/_next/static/chunks/app.js", "/_next/image?url=x", "/specimens/placeholder-markets.svg", "/icon.svg", "/toolbar/inspector.js", "/toolbar/axe.js"])("never runs on the asset %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});
