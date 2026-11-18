import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS } from "@/lib/web/redirects";

/*
 * The permanent redirect table, resolved with Next's own matcher in table
 * order, the way next.config.ts applies it: the first source that matches
 * decides the destination.
 */

/** Where +address+ is sent, or null when no redirect applies. */
function redirectOf(address: string): string | null {
  const url = new URL(address, "http://fablab.test");
  const query = Object.fromEntries(url.searchParams);
  for (const redirect of LEGACY_REDIRECTS) {
    const params = getPathMatch(redirect.source, { removeUnnamedParams: true, strict: true })(url.pathname);
    if (!params) continue;
    const { parsedDestination } = prepareDestination({ appendParamsToQuery: false, destination: redirect.destination, params, query });
    const search = new URLSearchParams(parsedDestination.query as Record<string, string>).toString();
    return parsedDestination.pathname + (search ? `?${search}` : "");
  }
  return null;
}

describe("redirects from before the interface vocabulary changed", () => {
  it.each([
    ["/initiatives/new", "/assessments/new"],
    ["/initiatives/ini_aaaaaaaaaaaaaaaa/edit", "/assessments/ini_aaaaaaaaaaaaaaaa/edit"],
    ["/assessments/asm_bbbbbbbbbbbbbbbb/map", "/runs/asm_bbbbbbbbbbbbbbbb/map"],
    ["/sources/new", "/repositories/new"],
  ])("still sends %s to %s", (from, to) => {
    expect(redirectOf(from)).toBe(to);
  });
});

describe("addresses of removed pages", () => {
  it.each(["/onboarding", "/onboarding/portals", "/navigation", "/applications", "/applications/new", "/portals", "/portals/ptl_0123456789abcdef/editor/frame-zones", "/runtime-configuration"])("leaves %s to the not-found page", (address) => {
    expect(redirectOf(address)).toBeNull();
  });

  it("makes every redirect permanent", () => {
    expect(LEGACY_REDIRECTS.every((redirect) => redirect.permanent)).toBe(true);
  });
});
