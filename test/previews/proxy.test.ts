import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { config, proxy } from "@/proxy";
import { routes } from "@/lib/web/routes";

/*
 * The request proxy and repository previews (design decision 6): the proxy
 * never runs on /previews/, so no workspace cookie is issued there and a
 * preview's root keeps its trailing slash, and it takes over Next.js's
 * trailing-slash redirect for every other path, which next.config.ts turns
 * off for that reason.
 */

const request = (path: string) => new NextRequest(`http://localhost:3000${path}`);
const PREVIEW = "pvw_0123456789abcdef";

describe("the proxy and previews", () => {
  it.each([`/previews/${PREVIEW}/`, `/previews/${PREVIEW}`, `/previews/${PREVIEW}/assets/index-3f2a.js`, `/previews/${PREVIEW}/accounts/42/`, `/previews/${PREVIEW}/__host`, "/previews/anything"])("never runs on the preview path %s, so it neither redirects it nor issues a credential", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });

  it.each(["/previews", "/previewsx/", `/repositories/src_0123456789abcdef/previews/${PREVIEW}`])("still runs on %s, which isn't a preview's files", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it("serves a preview's root with its slash, since Next.js's own trailing-slash redirect is off", () => {
    expect(nextConfig.skipTrailingSlashRedirect).toBe(true);
  });

  it.each([
    ["an operator page", "/repositories/", "/repositories"],
    ["an operator page with a query", "/repositories/src_0123456789abcdef/?tab=previews", "/repositories/src_0123456789abcdef?tab=previews"],
    ["a running application", "/run/orders-portal/", "/run/orders-portal"],
    ["a running application's route", "/run/orders-portal/accounts/?share=abc", "/run/orders-portal/accounts?share=abc"],
    ["an endpoint", "/api/health//", "/api/health"],
    ["an old address", "/templates/", "/templates"],
  ])("redirects %s with a trailing slash to the address without it, as Next.js would", (_label, from, to) => {
    expect(unstable_doesMiddlewareMatch({ config, url: from })).toBe(true);
    const response = proxy(request(from));
    expect(response.status).toBe(308);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname + location.search).toBe(to);
    expect(location.host).toBe("localhost:3000");
    // A redirect issues no credential; the request it leads to does.
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["/", "/repositories", "/run/orders-portal/accounts"])("leaves %s, which has no trailing slash, alone", (url) => {
    const response = proxy(request(url));
    expect(response.headers.get("location")).toBeNull();
  });

  it("builds a running application's addresses without a trailing slash, so links never meet the redirect", () => {
    expect(routes.runningApplication("orders-portal", "/accounts")).toBe("/run/orders-portal/accounts");
    expect(routes.runningApplication("orders-portal", "/")).toBe("/run/orders-portal");
    expect(routes.runningApplication("orders-portal")).toBe("/run/orders-portal");
  });
});
