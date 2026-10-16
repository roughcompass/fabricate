import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS, ONBOARDING_REDIRECTS } from "@/lib/web/redirects";

/*
 * The permanent redirect table (make-applications-first-class task 1.3),
 * resolved with Next's own matcher in table order, the way next.config.ts
 * applies it: the first source that matches decides the destination.
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

describe("redirects from Web Onboarding's addresses", () => {
  it.each([
    ["/onboarding", "/applications"],
    ["/onboarding/portals", "/navigation"],
    ["/onboarding/portals/new", "/navigation/new"],
    ["/onboarding/portals/ptl_0123456789abcdef", "/navigation/ptl_0123456789abcdef"],
    ["/onboarding/portals/ptl_0123456789abcdef/draft/identity", "/navigation/ptl_0123456789abcdef"],
    ["/onboarding/portals/ptl_0123456789abcdef/revisions/2", "/navigation/ptl_0123456789abcdef"],
    ["/onboarding/reviews", "/navigation"],
    ["/onboarding/reviews/plc_0123456789abcdef", "/navigation"],
    ["/onboarding/applications", "/applications?portal=all"],
    ["/onboarding/applications?q=payee", "/applications?q=payee&portal=all"],
    ["/onboarding/applications/wap_0123456789abcdef", "/applications/wap_0123456789abcdef"],
    ["/onboarding/applications/sea_0123456789abcdef/draft/launch", "/applications/sea_0123456789abcdef"],
    ["/onboarding/applications/new", "/applications/new"],
    ["/onboarding/microfrontends", "/applications?portal=all"],
    ["/onboarding/microfrontends/mfe_0123456789abcdef/revisions/1", "/applications?portal=all"],
    ["/applications/import", "/applications/new"],
    ["/applications/import/PAY/payee-hub", "/applications/new"],
    ["/new", "/applications/new"],
    ["/new/import?project=PAY&repository=payee-hub", "/applications/new?project=PAY&repository=payee-hub"],
  ])("sends %s to %s", (from, to) => {
    expect(redirectOf(from)).toBe(to);
  });

  it.each(["/applications", "/applications/new", "/applications/new/create", "/applications/wap_0123456789abcdef", "/navigation", "/navigation/ptl_0123456789abcdef", "/newsroom", "/onboardings"])("leaves %s alone", (address) => {
    expect(redirectOf(address)).toBeNull();
  });

  it("makes every redirect permanent", () => {
    expect(ONBOARDING_REDIRECTS.every((redirect) => redirect.permanent)).toBe(true);
  });
});

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
