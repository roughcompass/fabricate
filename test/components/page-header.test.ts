import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageHeader, type PageHeaderProps, TEMPLATES, type TemplateName } from "@/components/ui/page";

vi.mock("next/navigation", async () => ({ ...(await import("../support/next")).navigationStub, usePathname: () => "/" }));

// operator-interface/page-templates spec: each template fixes its page
// header's anatomy; page-patterns spec: breadcrumbs, the title row with the
// page's only h1, its status, and its actions, the meta row, the description,
// and the view tabs, in that order.

/** Every slot a page header can show, filled. */
const EVERYTHING = {
  breadcrumbs: [{ href: "/assessments", label: "Assessments" }],
  title: "Run #3",
  status: createElement("span", { "data-probe": "status" }, "Complete"),
  meta: [createElement("span", { key: "scope", "data-probe": "meta" }, "6 Repositories")],
  description: "Each repository is pinned to a commit.",
  primaryAction: createElement("button", { "data-variant": "primary", "data-probe": "primary" }, "Start Evaluation"),
  secondaryActions: [{ href: "/edit", label: "Edit" }],
  extraActions: createElement("button", { "data-probe": "extra" }, "Cancel Run"),
  tabs: createElement("nav", { "data-probe": "tabs" }, "Overview"),
};

/** What each template's header shows besides its title (page-templates spec). */
const EXPECTED: Record<TemplateName, readonly string[]> = {
  dashboard: ["description", "primary", "secondary"],
  index: ["breadcrumbs", "description", "primary", "secondary", "extra"],
  details: ["breadcrumbs", "status", "meta", "description", "primary", "secondary", "extra", "tabs"],
  analysis: ["breadcrumbs", "meta", "description", "secondary", "extra", "tabs"],
  form: ["breadcrumbs", "description"],
  flow: ["breadcrumbs", "description"],
  editor: ["breadcrumbs", "status", "meta", "description", "secondary", "extra"],
  settings: ["breadcrumbs", "description"],
  content: ["breadcrumbs", "description", "secondary", "extra"],
  system: [],
};

function render(props: Partial<PageHeaderProps> & { template: TemplateName }): string {
  return renderToStaticMarkup(createElement(PageHeader, { ...EVERYTHING, ...props } as PageHeaderProps));
}

/** The slots a rendered header shows. */
function shown(html: string): string[] {
  const found: string[] = [];
  if (html.includes('aria-label="Breadcrumb"')) found.push("breadcrumbs");
  for (const probe of ["status", "meta"]) if (html.includes(`data-probe="${probe}"`)) found.push(probe);
  if (html.includes(EVERYTHING.description)) found.push("description");
  for (const probe of ["primary"]) if (html.includes(`data-probe="${probe}"`)) found.push(probe);
  if (html.includes('href="/edit"')) found.push("secondary");
  for (const probe of ["extra", "tabs"]) if (html.includes(`data-probe="${probe}"`)) found.push(probe);
  return found;
}

describe("page header", () => {
  it.each(TEMPLATES)("shows only the %s template's slots", (template) => {
    const html = render({ template });
    expect(shown(html)).toEqual(EXPECTED[template]);
    expect(html).toContain(`data-template="${template}"`);
  });

  it.each(TEMPLATES)("renders the %s template's title as the page's only h1", (template) => {
    const html = render({ template });
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1 [^>]*title="Run #3"[^>]*>Run #3<\/h1>/);
  });

  it("orders the anatomy: breadcrumbs, the title row with its status and actions, the meta row, the description, and the tabs last", () => {
    const html = render({ template: "details" });
    const at = (needle: string) => html.indexOf(needle);
    const order = [at('aria-label="Breadcrumb"'), at("<h1"), at('data-probe="status"'), at("data-header-actions"), at('data-probe="meta"'), at(EVERYTHING.description), at('data-probe="tabs"')];
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The primary action ends the title row.
    expect(at('data-probe="primary"')).toBeGreaterThan(at('data-probe="extra"'));
  });

  it("keeps a System page's header to its title", () => {
    const html = render({ template: "system" });
    expect(html).not.toContain("data-header-actions");
    expect(html).not.toContain("data-header-meta");
    expect(html).not.toContain("data-header-tabs");
  });

  it("follows the header with the page-alert slot, which `alerts={false}` omits", () => {
    expect(render({ template: "index", alerts: "Alert" })).toMatch(/<\/header><div id="page-alerts"[^>]*>Alert<\/div>$/);
    expect(render({ template: "index", alerts: false })).not.toContain("page-alerts");
  });

  it("sets a gallery specimen's title as an h3, so the gallery keeps one h1", () => {
    const html = render({ template: "details", headingLevel: 3 });
    expect(html).not.toContain("<h1");
    expect(html).toMatch(/<h3 [^>]*>Run #3<\/h3>/);
  });

  it("moves secondary links into More actions on narrow screens only when there is a primary action", () => {
    expect(render({ template: "details" })).toContain('aria-label="More actions"');
    expect(render({ template: "details", primaryAction: undefined })).not.toContain('aria-label="More actions"');
  });
});
