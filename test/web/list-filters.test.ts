import { describe, expect, it } from "vitest";
import { isConclusionFilter } from "@/lib/evaluations/conclusions";
import { isOwnershipFilter } from "@/lib/ownership/coverage";
import { applicationsHref, assessmentsHref, navigationListHref, repositoriesHref } from "@/lib/web/list-filters";

// page-patterns spec: the lists filter what Home counts, through one set of addresses.

const query = (href: string) => new URL(href, "http://fablab.test").searchParams;

describe("list filter addresses", () => {
  it("builds the Repositories list's address, which the list parses back to the same filters", () => {
    const href = repositoriesHref({ status: "enabled", ownership: "unclaimed" });
    expect(href).toBe("/repositories?status=enabled&ownership=unclaimed");
    expect(isOwnershipFilter(query(href).get("ownership"))).toBe(true);
    expect(repositoriesHref()).toBe("/repositories");
    expect(repositoriesHref({ ownership: null, q: "ord" })).toBe("/repositories?q=ord");
  });

  it("builds the Assessments list's address for each conclusion tab", () => {
    for (const conclusion of ["gaps", "undetermined", "conforms", "not_applicable", "none"] as const) {
      const href = assessmentsHref({ conclusion });
      expect(href).toBe(`/assessments?conclusion=${conclusion}`);
      expect(isConclusionFilter(query(href).get("conclusion"))).toBe(true);
    }
    expect(assessmentsHref()).toBe("/assessments");
  });

  it("builds the Applications page across all Portals, filtered to a rendering mode, and the Navigation list's tabs", () => {
    expect(applicationsHref({ portal: "all" })).toBe("/applications?portal=all");
    expect(applicationsHref({ portal: "all", rendering: "undetermined" })).toBe("/applications?portal=all&rendering=undetermined");
    expect(applicationsHref({ view: "grid" })).toBe("/applications");
    expect(navigationListHref({ tab: "production" })).toBe("/navigation?portal=all&tab=production");
    expect(navigationListHref({ tab: "all" })).toBe("/navigation?portal=all");
  });
});
