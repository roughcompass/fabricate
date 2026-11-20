import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundPage } from "@/components/shell/system-page";
import { getConfig, setConfig, withOverrides } from "@/lib/config";

vi.mock("next/navigation", async () => ({ ...(await import("../support/next")).navigationStub, usePathname: () => "/" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

// operator-interface/page-patterns spec: a not-found page never links to a page
// that is itself not found.

const original = getConfig();
afterEach(() => setConfig(original));

describe("not-found pages", () => {
  it("links an unknown address to Home (Unknown address)", async () => {
    const { default: NotFound } = await import("@/app/not-found");
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain("Page not found");
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Go to Home<\/a>/);
  });

  it("falls back to the generic page for an area that isn't available", () => {
    const html = renderToStaticMarkup(createElement(NotFoundPage, { noun: "Application", listHref: "/applications", listLabel: "Applications", available: false }));
    expect(html).toContain("Page not found");
    expect(html).not.toContain("Application not found");
  });
});

// page-patterns spec, "Share links that no longer resolve lead back to Applications".
describe("a running application that isn't available", () => {
  const render = async () => renderToStaticMarkup(createElement((await import("@/app/(runtime)/run/not-found")).default));

  it("leads back to Applications while previews are on (Share link to a deleted application)", async () => {
    setConfig(withOverrides(original, { previews: { enabled: true } }));
    const html = await render();
    expect(html).toContain("This link no longer opens an application.");
    expect(html).toMatch(/<a [^>]*href="\/applications"[^>]*>Go to Applications<\/a>/);
  });

  it("leads Home while previews are off (Share link while previews are disabled)", async () => {
    setConfig(withOverrides(original, { previews: { enabled: false } }));
    expect(await render()).toMatch(/<a [^>]*href="\/"[^>]*>Go to Home<\/a>/);
  });
});
