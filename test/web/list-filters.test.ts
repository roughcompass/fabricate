import { describe, expect, it } from "vitest";
import { isConclusionFilter } from "@/lib/evaluations/conclusions";
import { assessmentsHref, repositoriesHref } from "@/lib/web/list-filters";

// page-patterns spec: the lists filter what Home counts, through one set of addresses.

const query = (href: string) => new URL(href, "http://fablab.test").searchParams;

describe("list filter addresses", () => {
  it("builds the Repositories list's address with its search", () => {
    const href = repositoriesHref({ q: "ord" });
    expect(href).toBe("/repositories?q=ord");
    expect(query(href).get("q")).toBe("ord");
    expect(repositoriesHref()).toBe("/repositories");
    expect(repositoriesHref({ q: "" })).toBe("/repositories");
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
