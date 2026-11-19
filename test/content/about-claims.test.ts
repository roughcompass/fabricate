import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type Claim, aboutClaims, aboutLinks } from "@/content/about";
import { getConfig, withOverrides } from "@/lib/config";
import { findPage, loadDocsSite } from "@/lib/docs/site";

/*
 * The claims test (establish-frontend-registry, task 10.10; product-site
 * spec, "The marketing page claims only what the running release does"):
 * every claim on the marketing page names the route that shows it, and the
 * test fails when that route doesn't exist in the running configuration,
 * as the template demo's pages don't while the demo is disabled.
 */

const APP = path.resolve("src/app");

interface Route {
  /** The address pattern, such as `/repositories/[^/]+`. */
  readonly pattern: RegExp;
  /** Whether it answers only while the template demo is enabled: its page, handler, or a layout above it checks the demo switch. */
  readonly demoOnly: boolean;
}

const DEMO_GUARD = /\b(requireDemo|demoUnavailable)\(/;

/** Every page and route handler under src/app, as address patterns. */
function appRoutes(directory = APP, segments: string[] = [], guarded = false): Route[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const read = (name: string) => (entries.some((entry) => entry.isFile() && entry.name === name) ? fs.readFileSync(path.join(directory, name), "utf8") : "");
  const demo = guarded || DEMO_GUARD.test(read("layout.tsx"));
  const routes: Route[] = [];
  for (const file of ["page.tsx", "route.ts"]) {
    if (!entries.some((entry) => entry.isFile() && entry.name === file)) continue;
    const source = segments
      .map((segment) => (/^\[\[\.\.\.\w+\]\]$/.test(segment) ? "(?:/.*)?" : /^\[\.\.\.\w+\]$/.test(segment) ? "/.+" : /^\[\w+\]$/.test(segment) ? "/[^/]+" : `/${segment.replace(/[.]/g, "\\.")}`))
      .join("");
    routes.push({ pattern: new RegExp(`^${source || "/"}$`), demoOnly: demo || DEMO_GUARD.test(read(file)) });
  }
  for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith("@") && !item.name.startsWith("_"))) {
    const grouped = /^\(.+\)$/.test(entry.name);
    routes.push(...appRoutes(path.join(directory, entry.name), grouped ? segments : [...segments, entry.name], demo));
  }
  return routes;
}

/** Every claim whose route the running configuration doesn't serve, and why. */
function claimProblems(claims: readonly Claim[], configuration: { demoEnabled: boolean }): string[] {
  const routes = appRoutes();
  const docs = loadDocsSite(process.cwd());
  return claims.flatMap((claim) => {
    const address = claim.route.replace(/:\w+/g, "x0");
    const route = routes.find((candidate) => candidate.pattern.test(address));
    if (!route) return [`"${claim.text}" names ${claim.route}, which no page serves`];
    if (route.demoOnly && !configuration.demoEnabled) return [`"${claim.text}" names ${claim.route}, which the template demo serves, and it's disabled`];
    if (address.startsWith("/docs/") && !findPage(docs, address.slice("/docs/".length))) return [`"${claim.text}" names ${claim.route}, which isn't a docs page`];
    return [];
  });
}

describe("the marketing page's claims", () => {
  it("find the app's routes, and the template demo's among them", () => {
    const routes = appRoutes();
    const demoOnly = (address: string) => routes.find((route) => route.pattern.test(address))?.demoOnly;
    expect(demoOnly("/repositories/src_x/profile.json")).toBe(false);
    expect(demoOnly("/docs/get-started/what-it-is")).toBe(false);
    expect(demoOnly("/templates")).toBe(true);
    expect(demoOnly("/run/ref-market-watch/watch")).toBe(true);
    expect(routes.some((route) => route.pattern.test("/no-such-page"))).toBe(false);
  });

  it("each name a route the release serves, with the demo on and off", () => {
    expect(aboutClaims().length).toBeGreaterThan(20);
    for (const demoEnabled of [true, false]) expect(claimProblems(aboutClaims(), { demoEnabled }), `demo ${demoEnabled ? "on" : "off"}`).toEqual([]);
    expect(claimProblems(aboutLinks().map((route) => ({ text: route, route })), { demoEnabled: false })).toEqual([]);
  });

  it("fail for a claim about Salt Patterns when the demo is disabled, and pass while it's enabled", () => {
    const salt: Claim = { text: "Start an application from a Salt Pattern.", route: "/templates" };
    expect(claimProblems([salt], { demoEnabled: getConfig().demoEnabled })).toEqual([]);
    expect(claimProblems([salt], { demoEnabled: withOverrides(getConfig(), { demo: { enabled: false } }).demoEnabled })).toEqual([`"Start an application from a Salt Pattern." names /templates, which the template demo serves, and it's disabled`]);
  });

  it("fail for a claim about a page the release doesn't have, or a docs page that doesn't exist", () => {
    expect(claimProblems([{ text: "Claim a repository.", route: "/claims/new" }], { demoEnabled: true })).toEqual(['"Claim a repository." names /claims/new, which no page serves']);
    expect(claimProblems([{ text: "Read about MCP.", route: "/docs/guides/mcp-server" }], { demoEnabled: true })).toEqual(['"Read about MCP." names /docs/guides/mcp-server, which isn\'t a docs page']);
  });
});
