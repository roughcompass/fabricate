import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ABOUT, type Claim, aboutClaims, aboutLinks } from "@/content/about";
import { getConfig, withOverrides } from "@/lib/config";
import { findPage, loadDocsSite } from "@/lib/docs/site";

/*
 * The claims test (establish-frontend-registry, task 10.10; product-site
 * spec, "The marketing page claims only what the running release does"):
 * every claim on the marketing page names the route that shows it, and the
 * test fails when that route doesn't exist in the running configuration,
 * as Applications' pages don't while previews are off (applications/onboarding
 * spec, "Applications are available while previews are").
 */

const APP = path.resolve("src/app");

interface Route {
  /** The address pattern, such as `/repositories/[^/]+`. */
  readonly pattern: RegExp;
  /** Whether it answers only while previews are on: its page, handler, or a layout above it checks that applications are available. */
  readonly previewsOnly: boolean;
}

const PREVIEWS_GUARD = /\b(requireApplications|applicationsUnavailable)\(/;

/** Every page and route handler under src/app, as address patterns. */
function appRoutes(directory = APP, segments: string[] = [], guarded = false): Route[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const read = (name: string) => (entries.some((entry) => entry.isFile() && entry.name === name) ? fs.readFileSync(path.join(directory, name), "utf8") : "");
  const gated = guarded || PREVIEWS_GUARD.test(read("layout.tsx"));
  const routes: Route[] = [];
  for (const file of ["page.tsx", "route.ts"]) {
    if (!entries.some((entry) => entry.isFile() && entry.name === file)) continue;
    const source = segments
      .map((segment) => (/^\[\[\.\.\.\w+\]\]$/.test(segment) ? "(?:/.*)?" : /^\[\.\.\.\w+\]$/.test(segment) ? "/.+" : /^\[\w+\]$/.test(segment) ? "/[^/]+" : `/${segment.replace(/[.]/g, "\\.")}`))
      .join("");
    routes.push({ pattern: new RegExp(`^${source || "/"}$`), previewsOnly: gated || PREVIEWS_GUARD.test(read(file)) });
  }
  for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith("@") && !item.name.startsWith("_"))) {
    const grouped = /^\(.+\)$/.test(entry.name);
    routes.push(...appRoutes(path.join(directory, entry.name), grouped ? segments : [...segments, entry.name], gated));
  }
  return routes;
}

/** Every claim whose route the running configuration doesn't serve, and why. */
function claimProblems(claims: readonly Claim[], configuration: { previewsEnabled: boolean }): string[] {
  const routes = appRoutes();
  const docs = loadDocsSite(process.cwd());
  return claims.flatMap((claim) => {
    const address = claim.route.replace(/:\w+/g, "x0");
    const route = routes.find((candidate) => candidate.pattern.test(address));
    if (!route) return [`"${claim.text}" names ${claim.route}, which no page serves`];
    if (route.previewsOnly && !configuration.previewsEnabled) return [`"${claim.text}" names ${claim.route}, which is served only while previews are on, and they're off`];
    if (address.startsWith("/docs/") && !findPage(docs, address.slice("/docs/".length))) return [`"${claim.text}" names ${claim.route}, which isn't a docs page`];
    return [];
  });
}

describe("the marketing page's claims", () => {
  it("find the app's routes, and those served only while previews are on among them", () => {
    const routes = appRoutes();
    const previewsOnly = (address: string) => routes.find((route) => route.pattern.test(address))?.previewsOnly;
    expect(previewsOnly("/repositories/src_x/profile.json")).toBe(false);
    expect(previewsOnly("/docs/get-started/what-it-is")).toBe(false);
    for (const address of ["/applications", "/applications/new", "/applications/orders-portal", "/run/orders-portal/accounts", "/api/workspace/threads"]) expect(previewsOnly(address), address).toBe(true);
    // The template demo's addresses are redirects to /applications now, not pages.
    expect(previewsOnly("/templates")).toBeUndefined();
    expect(routes.some((route) => route.pattern.test("/no-such-page"))).toBe(false);
  });

  it("each name a route the release serves, with previews on and off", () => {
    for (const previewsEnabled of [true, false]) {
      expect(aboutClaims(previewsEnabled).length).toBeGreaterThan(20);
      expect(claimProblems(aboutClaims(previewsEnabled), { previewsEnabled }), `previews ${previewsEnabled ? "on" : "off"}`).toEqual([]);
    }
    expect(claimProblems(aboutLinks().map((route) => ({ text: route, route })), { previewsEnabled: false })).toEqual([]);
  });

  it("claim Applications, naming /applications, only while previews are on", () => {
    const applications = (claims: readonly Claim[]) => claims.filter((claim) => claim.route === "/applications");
    expect(applications(aboutClaims(true))).toEqual([ABOUT.benefits.applications.benefit]);
    expect(applications(aboutClaims(false))).toEqual([]);
  });

  it("fail for a claim about Applications when previews are off, and pass while they're on", () => {
    const claim = ABOUT.benefits.applications.benefit;
    const enabled = (on: boolean) => withOverrides(getConfig(), { previews: { enabled: on } }).previews.enabled;
    expect(claimProblems([claim], { previewsEnabled: enabled(true) })).toEqual([]);
    expect(claimProblems([claim], { previewsEnabled: enabled(false) })).toEqual([`"${claim.text}" names /applications, which is served only while previews are on, and they're off`]);
  });

  it("fail for a claim about a page the release doesn't have, or a docs page that doesn't exist", () => {
    expect(claimProblems([{ text: "Claim a repository.", route: "/claims/new" }], { previewsEnabled: true })).toEqual(['"Claim a repository." names /claims/new, which no page serves']);
    expect(claimProblems([{ text: "Read about MCP.", route: "/docs/guides/mcp-server" }], { previewsEnabled: true })).toEqual(['"Read about MCP." names /docs/guides/mcp-server, which isn\'t a docs page']);
  });
});
