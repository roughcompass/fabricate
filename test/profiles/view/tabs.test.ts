import { SHARED_CATEGORIES } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { PROFILE_TABS, isProfileTab, profileSectionHref, profileTabHref, tabOf } from "@/lib/profiles/tabs";

describe("The Profile's views", () => {
  it("puts every shared category in exactly one view", () => {
    const placed = PROFILE_TABS.flatMap((tab) => tab.categories as readonly string[]);
    expect([...placed].sort()).toEqual(SHARED_CATEGORIES.map((definition) => definition.id).sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("opens a section in the view that holds it, and the Overview at the Profile's own address", () => {
    expect(profileSectionHref("/profiles/prf_1", "ci_systems")).toBe("/profiles/prf_1?tab=tooling#ci_systems");
    expect(profileSectionHref("/profiles/prf_1", "services")).toBe("/profiles/prf_1?tab=services#services");
    expect(profileSectionHref("/profiles/prf_1", "other-diagnostics")).toBe("/profiles/prf_1?tab=diagnostics#other-diagnostics");
    expect(profileSectionHref("/repositories/src_1", "overview")).toBe("/repositories/src_1");
    expect(profileTabHref("/repositories/src_1", "overview")).toBe("/repositories/src_1");
    expect(profileTabHref("/repositories/src_1", "design-system")).toBe("/repositories/src_1?tab=design-system");
    // An extension category has no view of its own; it's shown with Tooling.
    expect(tabOf("web-doctor.entry_points")).toBe("tooling");
  });

  it("recognizes only its own view names", () => {
    expect(isProfileTab("dependencies")).toBe(true);
    expect(isProfileTab("accessibility")).toBe(false);
    expect(isProfileTab(undefined)).toBe(false);
  });
});
