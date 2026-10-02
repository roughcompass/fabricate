import { SHARED_CATEGORY_IDS } from "@repo-facts/contract";
import { describe, expect, it } from "vitest";
import { SELECTORS, type SelectorDefinition, selectorCategoryProblems } from "@/lib/standards/registry";

describe("the categories repository selectors read", () => {
  it("names, for every repository selector, a category the installed contract defines", () => {
    expect(selectorCategoryProblems(SHARED_CATEGORY_IDS)).toEqual([]);
    expect(SELECTORS.filter((selector) => selector.scope === "repository").length).toBeGreaterThan(20);
  });

  it("fails a selector that names a missing category, or none", () => {
    const missing: SelectorDefinition = { ...SELECTORS[0]!, id: "repository.example", category: "no_such_category" };
    const unnamed: SelectorDefinition = { ...SELECTORS[0]!, id: "repository.unnamed", category: undefined };
    expect(selectorCategoryProblems(SHARED_CATEGORY_IDS, [missing, unnamed])).toEqual(["repository.example reads no_such_category, which isn't a category", "repository.unnamed names no category"]);
  });

  it("names the categories the interpreter reads", () => {
    const category = (id: string) => SELECTORS.find((selector) => selector.id === id)?.category;
    expect(category("repository.ci_systems")).toBe("ci_systems");
    expect(category("repository.verification_command_kinds")).toBe("verification_commands");
    expect(category("repository.node_range")).toBe("runtime_requirements");
    expect(category("repository.resolved_version")).toBe("resolved_dependencies");
    expect(category("repository.design_system_token_share")).toBe("style_values");
  });
});
