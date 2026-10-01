import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundPage } from "@/components/shell/system-page";
import { getConfig, setConfig, withOverrides } from "@/lib/config";

vi.mock("next/navigation", async () => ({ ...(await import("../support/next")).navigationStub, usePathname: () => "/" }));

// operator-interface/page-patterns spec: a not-found page never links to a page
// that is itself not found. While the demo is disabled, the demo's not-found
// pages name no record and link to the Assessments list.

const original = getConfig();
afterEach(() => setConfig(original));

const pages = {
  templates: () => import("@/app/(operator)/templates/not-found"),
  applications: () => import("@/app/(operator)/applications/not-found"),
  import: () => import("@/app/(operator)/applications/import/not-found"),
  create: () => import("@/app/(operator)/new/not-found"),
};

async function render(page: keyof typeof pages): Promise<string> {
  const { default: NotFound } = await pages[page]();
  return renderToStaticMarkup(createElement(NotFound));
}

describe("not-found pages", () => {
  it("names the record and links to its list while the demo is enabled", async () => {
    setConfig(withOverrides(original, { demo: { enabled: true } }));
    expect(await render("templates")).toContain('href="/templates"');
    expect(await render("templates")).toContain("Go to Salt Patterns");
    expect(await render("applications")).toContain("Go to Applications");
    expect(await render("import")).toContain("Go to Import from BitBucket");
  });

  it("links every demo page to Assessments while the demo is disabled", async () => {
    setConfig(withOverrides(original, { demo: { enabled: false } }));
    for (const page of Object.keys(pages) as (keyof typeof pages)[]) {
      const html = await render(page);
      expect(html, page).toContain("Page not found");
      expect(html, page).toContain('href="/assessments"');
      expect(html, page).toContain("Go to Assessments");
      expect(html, page).not.toMatch(/href="\/(templates|applications|new)/);
    }
  });

  it("falls back to the generic page for demo=false", () => {
    const html = renderToStaticMarkup(createElement(NotFoundPage, { noun: "Template", listHref: "/templates", listLabel: "Salt Patterns", demo: false }));
    expect(html).toContain("Page not found");
    expect(html).not.toContain("Template not found");
  });
});
