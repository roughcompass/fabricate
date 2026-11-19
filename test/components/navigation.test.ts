import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOME, NO_OPTIONAL_AREAS, type NavFlags, locate, visibleGroups } from "@/components/shell/navigation";

// operator-interface/page-patterns spec: the primary menu groups areas under
// headings and dividers.

const OPERATOR = path.resolve("src/app/(operator)");

const BASE = NO_OPTIONAL_AREAS;
const ALL: NavFlags = { demo: true };

/** Every operator page, as its route template ("/standards/[standardId]/draft"). */
function routes(directory = OPERATOR): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    // A parallel route's slot, such as the shell header's @header, mirrors pages that exist on their own.
    if (entry.isDirectory()) return entry.name.startsWith("@") ? [] : routes(full);
    // Route groups such as (operator) aren't part of the address.
    return entry.name === "page.tsx" ? [`/${path.relative(OPERATOR, directory).split(path.sep).filter((segment) => !/^\(.*\)$/.test(segment)).join("/")}`.replace(/\/$/, "") || "/"] : [];
  });
}

/** The menu item each route marks current; null for pages outside every one. Pages not built yet are listed too. */
const EXPECTED: Record<string, string | null> = {
  "/": "home",
  "/assessments": "all-assessments",
  "/assessments/new": "all-assessments",
  "/assessments/[assessmentId]": "all-assessments",
  "/assessments/[assessmentId]/edit": "all-assessments",
  "/runs/[runId]": "all-assessments",
  "/runs/[runId]/map": "all-assessments",
  "/runs/[runId]/map/systems/[system]": "all-assessments",
  "/runs/[runId]/evidence/[evidenceId]": "all-assessments",
  "/evaluations/[evaluationId]": "all-assessments",
  "/evaluations/[evaluationId]/findings/[findingId]": "all-assessments",
  "/profiles/[profileId]": "all-assessments",
  "/profiles/[profileId]/evidence/[evidenceId]": "all-assessments",
  "/repositories": "repositories",
  "/repositories/new": "repositories",
  "/repositories/bulk": "repositories",
  "/repositories/[repositoryId]": "repositories",
  "/repositories/[repositoryId]/settings": "repositories",
  "/repositories/[repositoryId]/versions": "repositories",
  "/repositories/[repositoryId]/versions/[version]": "repositories",
  "/repositories/[repositoryId]/previews/[preview]": "repositories",
  "/standards": "standards",
  "/standards/new": "standards",
  "/standards/[standardId]": "standards",
  "/standards/[standardId]/edit": "standards",
  "/standards/[standardId]/draft": "standards",
  "/standards/[standardId]/publish": "standards",
  "/standards/[standardId]/releases/[releaseId]": "standards",
  "/templates": "salt-patterns",
  "/templates/[templateSlug]": "salt-patterns",
  "/templates/[templateSlug]/preview": "salt-patterns",
  "/admin": "system",
  "/admin/system": "system",
  "/admin/bitbucket-tokens": "bitbucket-tokens",
  "/admin/bitbucket-tokens/new": "bitbucket-tokens",
  "/adoption": "adoption",
  "/adoption/design-systems/[designSystemId]": "adoption",
  "/adoption/design-systems/[designSystemId]/components/[componentName]": "adoption",
  "/adoption/packages/[...packageName]": "adoption",
  "/design-system": null,
  "/design-system/error-demo": null,
};

/** A concrete path for a route template: "[standardId]" becomes "standardid-example". */
const sample = (route: string) => route.replace(/\[([^\]]+)\]/g, (_, name: string) => `${name.toLowerCase()}-example`);

/** What a path marks current. */
function current(pathname: string, flags: NavFlags): string | null {
  return locate(pathname, flags)?.item.id ?? null;
}

const shape = (flags: NavFlags) => visibleGroups(flags).map((group) => [group.heading ?? null, group.items.map((item) => item.label)]);

describe("primary menu", () => {
  it("maps every operator page to the item the spec names", () => {
    const found = routes();
    expect(found.length).toBeGreaterThan(20);
    for (const route of found) {
      expect(EXPECTED, `${route} needs an entry in EXPECTED`).toHaveProperty([route]);
      expect(current(sample(route), ALL), route).toEqual(EXPECTED[route]);
    }
  });

  it("marks the item the spec names on every page it lists, including pages not built yet", () => {
    for (const [route, expected] of Object.entries(EXPECTED)) expect(current(sample(route), ALL), route).toEqual(expected);
  });

  it("lists Home, then the Assessments, Templates, and Admin groups under their headings (Full menu)", () => {
    expect(shape(ALL)).toEqual([
      [null, ["Home"]],
      ["Assessments", ["Repositories", "All Assessments", "Standards"]],
      ["Templates", ["Salt Patterns"]],
      ["Insights", ["Adoption"]],
      ["Admin", ["System", "Bitbucket tokens"]],
    ]);
    expect(visibleGroups(ALL)[0]!.items[0]).toBe(HOME);
    for (const item of visibleGroups(ALL).flatMap((group) => group.items)) expect(item.icon, item.id).toBeTruthy();
  });

  it("has no Templates group while the demo is disabled, and leaves its pages outside the menu (Demo disabled)", () => {
    expect(shape(BASE)).toEqual([
      [null, ["Home"]],
      ["Assessments", ["Repositories", "All Assessments", "Standards"]],
      ["Insights", ["Adoption"]],
      ["Admin", ["System", "Bitbucket tokens"]],
    ]);
    for (const route of ["/templates", "/templates/payments-hub/preview"]) expect(locate(route, BASE), route).toBeNull();
  });

  it("marks each create or import page as its list's item (Create page)", () => {
    expect(current("/assessments/new", ALL)).toBe("all-assessments");
    expect(current("/repositories/new", ALL)).toBe("repositories");
    expect(current("/repositories/bulk/", ALL)).toBe("repositories");
    expect(current("/standards/new", ALL)).toBe("standards");
  });

  it("marks nothing on the removed Applications, Portals, and Prototypes addresses", () => {
    for (const path of ["/applications", "/portals", "/portals/ptl_0123456789abcdef/editor/frame-zones", "/runtime-configuration", "/prototypes", "/prototypes/personas"]) expect(current(path, ALL), path).toBeNull();
  });
});
