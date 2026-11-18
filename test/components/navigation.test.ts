import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOME, NO_OPTIONAL_AREAS, type NavFlags, SALT_PATTERNS, homeLink, locate, menuItems, visibleGroups } from "@/components/shell/navigation";

// operator-interface/page-patterns spec: the primary menu groups areas under
// headings and dividers.

const OPERATOR = path.resolve("src/app/(operator)");

const BASE = NO_OPTIONAL_AREAS;
const DEMO: NavFlags = { demo: true, prototypes: false, hosted: false };
const PROTOTYPES: NavFlags = { demo: false, prototypes: true, hosted: false };
const ALL: NavFlags = { demo: true, prototypes: true, hosted: false };
const HOSTED: NavFlags = { demo: true, prototypes: true, hosted: true };

/** Every operator page, as its route template ("/standards/[standardId]/draft"). */
function routes(directory = OPERATOR): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return routes(full);
    // Route groups such as (operator) aren't part of the address.
    return entry.name === "page.tsx" ? [`/${path.relative(OPERATOR, directory).split(path.sep).filter((segment) => !/^\(.*\)$/.test(segment)).join("/")}`.replace(/\/$/, "") || "/"] : [];
  });
}

/** The menu item each route marks current; null for pages outside every one. Pages not built yet are listed too. */
const EXPECTED: Record<string, string | null> = {
  "/": "home",
  "/assessments": "all-assessments",
  "/assessments/new": "all-assessments",
  "/assessments/[initiativeId]": "all-assessments",
  "/assessments/[initiativeId]/edit": "all-assessments",
  "/runs/[assessmentId]": "all-assessments",
  "/runs/[assessmentId]/map": "all-assessments",
  "/runs/[assessmentId]/map/lob/[lineOfBusiness]": "all-assessments",
  "/runs/[assessmentId]/map/portal/[portal]": "all-assessments",
  "/runs/[assessmentId]/map/applications/[applicationId]": "all-assessments",
  "/runs/[assessmentId]/map/unassigned": "all-assessments",
  "/runs/[assessmentId]/map/unassigned/[system]": "all-assessments",
  "/runs/[assessmentId]/evidence/[evidenceId]": "all-assessments",
  "/evaluations/[evaluationId]": "all-assessments",
  "/evaluations/[evaluationId]/findings/[findingId]": "all-assessments",
  "/profiles/[profileId]": "all-assessments",
  "/repositories": "repositories",
  "/repositories/new": "repositories",
  "/repositories/bulk": "repositories",
  "/repositories/[sourceId]": "repositories",
  "/repositories/[sourceId]/settings": "repositories",
  "/repositories/[sourceId]/versions": "repositories",
  "/repositories/[sourceId]/versions/[version]": "repositories",
  "/repositories/de-console": "repositories",
  "/repositories/claim": "repositories",
  "/repositories/claim/[sourceId]": "repositories",
  "/repositories/claim/[sourceId]/correct": "repositories",
  "/repositories/claim/[sourceId]/owner": "repositories",
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
  "/prototypes": "prototypes",
  "/prototypes/new": "prototypes",
  "/prototypes/[prototypeId]": "prototypes",
  "/prototypes/[prototypeId]/accept": "prototypes",
  "/prototypes/[prototypeId]/compare": "prototypes",
  "/prototypes/generations/[generationId]": "prototypes",
  "/prototypes/generations/[generationId]/variants/[variantId]": "prototypes",
  "/prototypes/personas": "personas",
  "/prototypes/personas/new": "personas",
  "/prototypes/personas/[personaId]": "personas",
  "/prototypes/lessons": "lessons",
  "/prototypes/shell": "page-shell",
  "/prototypes/templates/[templateSlug]/preview": "prototypes",
  "/p/[token]": null,
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

  it("lists Home, then the Assessments and Salt Patterns & Prototypes groups under their headings (Full menu)", () => {
    expect(shape(ALL)).toEqual([
      [null, ["Home"]],
      ["Assessments", ["All Assessments", "Repositories", "Standards"]],
      ["Salt Patterns & Prototypes", ["Salt Patterns", "Prototypes", "Personas", "Lessons", "Page shell"]],
    ]);
    expect(visibleGroups(ALL)[0]!.items[0]).toBe(HOME);
    for (const item of menuItems(visibleGroups(ALL))) expect(item.icon, item.id).toBeTruthy();
  });

  it("lists only Salt Patterns in the last group while Prototypes is disabled (Prototypes disabled)", () => {
    expect(shape(DEMO)[2]).toEqual(["Salt Patterns & Prototypes", ["Salt Patterns"]]);
  });

  it("has no Salt Patterns & Prototypes group while the demo and Prototypes are disabled, and leaves their pages outside the menu (Demo disabled)", () => {
    expect(shape(BASE)).toEqual([
      [null, ["Home"]],
      ["Assessments", ["All Assessments", "Repositories", "Standards"]],
    ]);
    for (const route of ["/templates", "/templates/payments-hub/preview", "/prototypes", "/prototypes/personas"]) expect(locate(route, BASE), route).toBeNull();
  });

  it("shows Prototypes' pages but not Salt Patterns while only Prototypes is enabled", () => {
    expect(shape(PROTOTYPES)[2]).toEqual(["Salt Patterns & Prototypes", ["Prototypes", "Personas", "Lessons", "Page shell"]]);
  });

  it("shows only Prototypes' pages in the hosted profile, without Home (Hosted profile)", () => {
    expect(shape(HOSTED)).toEqual([["Salt Patterns & Prototypes", ["Prototypes", "Personas", "Lessons", "Page shell"]]]);
    for (const route of ["/", "/assessments", "/repositories"]) expect(locate(route, HOSTED), route).toBeNull();
    expect(visibleGroups({ ...HOSTED, prototypes: false })).toEqual([]);
  });

  it("marks each create or import page as its list's item (Create page)", () => {
    expect(current("/assessments/new", ALL)).toBe("all-assessments");
    expect(current("/repositories/new", ALL)).toBe("repositories");
    expect(current("/repositories/bulk/", ALL)).toBe("repositories");
    expect(current("/standards/new", ALL)).toBe("standards");
    expect(current("/prototypes/new", ALL)).toBe("prototypes");
  });

  it("marks nothing on the removed Applications and Portals addresses", () => {
    for (const path of ["/applications", "/portals", "/portals/ptl_0123456789abcdef/editor/frame-zones", "/runtime-configuration"]) expect(current(path, ALL), path).toBeNull();
  });

  it("leads links to Home while Assessments is shown, and to the menu's first page otherwise (Profile without Assessments)", () => {
    for (const flags of [BASE, DEMO, PROTOTYPES, ALL]) expect(homeLink(visibleGroups(flags))).toEqual({ href: "/", label: "Home" });
    expect(homeLink(visibleGroups(HOSTED))).toEqual({ href: "/prototypes", label: "Prototypes" });
    expect(homeLink([{ id: "build", heading: "Salt Patterns & Prototypes", items: [SALT_PATTERNS] }])).toEqual({ href: "/templates", label: "Salt Patterns" });
  });
});
