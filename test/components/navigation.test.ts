import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SECTIONS, locate, visibleSections } from "@/components/shell/navigation";

// operator-interface/page-patterns spec: sidebar navigation drills into each section.

const OPERATOR = path.resolve("src/app/(operator)");

/** Every operator page, as its route template ("/standards/[standardId]/draft"). */
function routes(directory = OPERATOR): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return routes(full);
    return entry.name === "page.tsx" ? [`/${path.relative(OPERATOR, directory).split(path.sep).join("/")}`.replace(/\/$/, "") || "/"] : [];
  });
}

/** The section and item each route marks current; null for pages outside every section. */
const EXPECTED: Record<string, [section: string, item: string] | null> = {
  "/": ["initiatives", "all-initiatives"],
  "/initiatives/new": ["initiatives", "new-initiative"],
  "/initiatives/[initiativeId]": ["initiatives", "all-initiatives"],
  "/initiatives/[initiativeId]/edit": ["initiatives", "all-initiatives"],
  "/assessments/[assessmentId]": ["initiatives", "all-initiatives"],
  "/assessments/[assessmentId]/map": ["initiatives", "all-initiatives"],
  "/assessments/[assessmentId]/evidence/[evidenceId]": ["initiatives", "all-initiatives"],
  "/evaluations/[evaluationId]": ["initiatives", "all-initiatives"],
  "/evaluations/[evaluationId]/findings/[findingId]": ["initiatives", "all-initiatives"],
  "/profiles/[profileId]": ["initiatives", "all-initiatives"],
  "/sources": ["sources", "all-sources"],
  "/sources/new": ["sources", "add-source"],
  "/sources/import": ["sources", "import-sources"],
  "/sources/[sourceId]/edit": ["sources", "all-sources"],
  "/standards": ["standards", "all-standards"],
  "/standards/new": ["standards", "new-standard"],
  "/standards/[standardId]": ["standards", "all-standards"],
  "/standards/[standardId]/edit": ["standards", "all-standards"],
  "/standards/[standardId]/draft": ["standards", "all-standards"],
  "/standards/[standardId]/publish": ["standards", "all-standards"],
  "/standards/[standardId]/releases/[releaseId]": ["standards", "all-standards"],
  "/new": ["templates", "new-application"],
  "/new/import": ["templates", "new-application"],
  "/templates": ["templates", "gallery"],
  "/templates/[templateSlug]": ["templates", "gallery"],
  "/templates/[templateSlug]/deploy": ["templates", "gallery"],
  "/templates/[templateSlug]/preview": ["templates", "gallery"],
  "/applications": ["templates", "applications"],
  "/applications/[applicationId]": ["templates", "applications"],
  "/design-system": null,
  "/design-system/error-demo": null,
};

/** A concrete path for a route template: "[standardId]" becomes "standardid-example". */
const sample = (route: string) => route.replace(/\[([^\]]+)\]/g, (_, name: string) => `${name.toLowerCase()}-example`);

describe("sidebar navigation", () => {
  it("maps every operator page to the section and item the spec names", () => {
    const found = routes();
    expect(found.length).toBeGreaterThan(20);
    for (const route of found) {
      expect(EXPECTED, `${route} needs an entry in EXPECTED`).toHaveProperty([route]);
      const located = locate(sample(route), true);
      expect(located && [located.section.id, located.item.id], route).toEqual(EXPECTED[route]);
    }
  });

  it("opens each section at its first sub-menu item, in the spec's order", () => {
    expect(SECTIONS.map((section) => [section.label, section.items.map((item) => item.label)])).toEqual([
      ["Initiatives", ["All Initiatives", "New Initiative"]],
      ["Sources", ["All Sources", "Add Source", "Import Sources"]],
      ["Standards", ["All Standards", "New Standard"]],
      ["Templates", ["New application", "Gallery", "Applications"]],
    ]);
    expect(SECTIONS.find((section) => section.id === "templates")!.items[0]!.href).toBe("/new");
  });

  it("marks a create page as its own item rather than the list", () => {
    expect(locate("/initiatives/new", true)?.item.id).toBe("new-initiative");
    expect(locate("/sources/new", true)?.item.id).toBe("add-source");
    expect(locate("/sources/import/", true)?.item.id).toBe("import-sources");
  });

  it("leaves Templates out, and its pages outside every section, while the demo is disabled", () => {
    expect(visibleSections(false).map((section) => section.label)).toEqual(["Initiatives", "Sources", "Standards"]);
    for (const route of ["/new", "/new/import", "/templates", "/templates/payments-hub/preview", "/applications/app-1"]) expect(locate(route, false), route).toBeNull();
  });
});
