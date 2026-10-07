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
  "/": null,
  "/assessments": ["assessments", "all-assessments"],
  "/assessments/new": ["assessments", "new-assessment"],
  "/assessments/[initiativeId]": ["assessments", "all-assessments"],
  "/assessments/[initiativeId]/edit": ["assessments", "all-assessments"],
  "/runs/[assessmentId]": ["assessments", "all-assessments"],
  "/runs/[assessmentId]/map": ["assessments", "all-assessments"],
  "/runs/[assessmentId]/map/lob/[lineOfBusiness]": ["assessments", "all-assessments"],
  "/runs/[assessmentId]/map/portal/[portal]": ["assessments", "all-assessments"],
  "/runs/[assessmentId]/map/applications/[applicationId]": ["assessments", "all-assessments"],
  "/runs/[assessmentId]/map/unassigned": ["assessments", "all-assessments"],
  "/runs/[assessmentId]/map/unassigned/[system]": ["assessments", "all-assessments"],
  "/runs/[assessmentId]/evidence/[evidenceId]": ["assessments", "all-assessments"],
  "/evaluations/[evaluationId]": ["assessments", "all-assessments"],
  "/evaluations/[evaluationId]/findings/[findingId]": ["assessments", "all-assessments"],
  "/profiles/[profileId]": ["assessments", "all-assessments"],
  "/repositories": ["assessments", "all-repositories"],
  "/repositories/new": ["assessments", "new-repository"],
  "/repositories/import": ["assessments", "import-repositories"],
  "/repositories/[sourceId]/edit": ["assessments", "all-repositories"],
  "/repositories/claim": ["assessments", "all-repositories"],
  "/repositories/claim/[sourceId]": ["assessments", "all-repositories"],
  "/repositories/claim/[sourceId]/correct": ["assessments", "all-repositories"],
  "/repositories/claim/[sourceId]/owner": ["assessments", "all-repositories"],
  "/standards": ["assessments", "all-standards"],
  "/standards/new": ["assessments", "new-standard"],
  "/standards/[standardId]": ["assessments", "all-standards"],
  "/standards/[standardId]/edit": ["assessments", "all-standards"],
  "/standards/[standardId]/draft": ["assessments", "all-standards"],
  "/standards/[standardId]/publish": ["assessments", "all-standards"],
  "/standards/[standardId]/releases/[releaseId]": ["assessments", "all-standards"],
  "/onboarding": ["web-onboarding", "portals"],
  "/onboarding/portals": ["web-onboarding", "portals"],
  "/onboarding/portals/new": ["web-onboarding", "portals"],
  "/onboarding/portals/[portalId]": ["web-onboarding", "portals"],
  "/onboarding/portals/[portalId]/draft/[step]": ["web-onboarding", "portals"],
  "/onboarding/portals/[portalId]/revisions/[revision]": ["web-onboarding", "portals"],
  "/onboarding/applications": ["web-onboarding", "web-applications"],
  "/onboarding/applications/new": ["web-onboarding", "web-applications"],
  "/onboarding/applications/[applicationId]": ["web-onboarding", "web-applications"],
  "/onboarding/applications/[applicationId]/draft/[step]": ["web-onboarding", "web-applications"],
  "/onboarding/applications/[applicationId]/revisions/[revision]": ["web-onboarding", "web-applications"],
  "/onboarding/applications/[applicationId]/microfrontends/new": ["web-onboarding", "web-applications"],
  "/onboarding/microfrontends": ["web-onboarding", "web-applications"],
  "/onboarding/microfrontends/[microfrontendId]": ["web-onboarding", "web-applications"],
  "/onboarding/microfrontends/[microfrontendId]/draft/[step]": ["web-onboarding", "web-applications"],
  "/onboarding/microfrontends/[microfrontendId]/revisions/[revision]": ["web-onboarding", "web-applications"],
  "/onboarding/reviews": ["web-onboarding", "reviews"],
  "/onboarding/reviews/[placementId]": ["web-onboarding", "reviews"],
  "/applications": ["applications", "all-applications"],
  "/applications/[applicationId]": ["applications", "all-applications"],
  "/applications/import": ["applications", "import-bitbucket"],
  "/applications/import/[project]/[repository]": ["applications", "import-bitbucket"],
  "/new": ["salt-patterns", "new-application"],
  "/templates": ["salt-patterns", "all-salt-patterns"],
  "/templates/[templateSlug]": ["salt-patterns", "all-salt-patterns"],
  "/templates/[templateSlug]/deploy": ["salt-patterns", "all-salt-patterns"],
  "/templates/[templateSlug]/preview": ["salt-patterns", "all-salt-patterns"],
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

  it("opens each section at its first sub-menu item, with the groups in the spec's order", () => {
    expect(SECTIONS.map((section) => [section.label, section.groups.map((group) => [group.label ?? null, group.items.map((item) => item.label)])])).toEqual([
      [
        "Assessments",
        [
          [null, ["All Assessments", "New Assessment"]],
          ["Repositories", ["All Repositories", "New Repository", "Import Repositories"]],
          ["Standards", ["All Standards", "New Standard"]],
        ],
      ],
      ["Web Onboarding", [[null, ["Portals", "Web Applications", "Reviews"]]]],
      ["Applications", [[null, ["All Applications", "Import from BitBucket"]]]],
      ["Salt Patterns", [[null, ["All Salt Patterns", "New application"]]]],
    ]);
    for (const section of SECTIONS) expect(section.items).toEqual(section.groups.flatMap((group) => group.items));
  });

  it("opens each section at the list titled with the section's name", () => {
    expect(SECTIONS.map((section) => [section.label, section.items[0]!.href])).toEqual([
      ["Assessments", "/assessments"],
      ["Web Onboarding", "/onboarding/portals"],
      ["Applications", "/applications"],
      ["Salt Patterns", "/templates"],
    ]);
  });

  it("marks a create or import page as its own item rather than the list", () => {
    expect(locate("/assessments/new", true)?.item.id).toBe("new-assessment");
    expect(locate("/repositories/new", true)?.item.id).toBe("new-repository");
    expect(locate("/repositories/import/", true)?.item.id).toBe("import-repositories");
    expect(locate("/applications/import", true)?.item.id).toBe("import-bitbucket");
    expect(locate("/applications/import/PAY/payee-hub", true)?.item.id).toBe("import-bitbucket");
    expect(locate("/applications/app_0123456789abcdef", true)?.item.id).toBe("all-applications");
  });

  it("marks Web Onboarding current on its deep pages, with the demo enabled or disabled (Web Onboarding section on a deep page)", () => {
    for (const demo of [true, false]) {
      expect([locate("/onboarding/microfrontends/mfe_0123456789abcdef", demo)?.section.id, locate("/onboarding/microfrontends/mfe_0123456789abcdef", demo)?.item.id]).toEqual(["web-onboarding", "web-applications"]);
      expect(locate("/onboarding/applications/wap_0123456789abcdef/draft/launch", demo)?.item.id).toBe("web-applications");
      expect(locate("/onboarding/reviews/plc_0123456789abcdef", demo)?.item.id).toBe("reviews");
      expect(locate("/onboarding/portals/new", demo)?.item.id).toBe("portals");
    }
  });

  it("shows Assessments and Web Onboarding, and leaves the demo's pages outside every section, while the demo is disabled (Demo disabled)", () => {
    expect(visibleSections(false).map((section) => section.label)).toEqual(["Assessments", "Web Onboarding"]);
    for (const route of ["/new", "/templates", "/templates/payments-hub/preview", "/applications", "/applications/app-1", "/applications/import/PAY/payee-hub"]) expect(locate(route, false), route).toBeNull();
  });
});
