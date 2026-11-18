import { describe, expect, it } from "vitest";
import { isConclusionFilter } from "@/lib/evaluations/conclusions";
import { isOwnershipFilter } from "@/lib/ownership/coverage";
import { assessmentsHref, repositoriesHref } from "@/lib/web/list-filters";

// page-patterns spec: the lists filter what Home counts, through one set of addresses.

const query = (href: string) => new URL(href, "http://fablab.test").searchParams;

describe("list filter addresses", () => {
  it("builds the Repositories list's address, which the list parses back to the same filters", () => {
    const href = repositoriesHref({ ownership: "unclaimed", q: "ord" });
    expect(href).toBe("/repositories?ownership=unclaimed&q=ord");
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
});
