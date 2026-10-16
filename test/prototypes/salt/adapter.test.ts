import { describe, expect, it } from "vitest";
import { labComponentName, namesIn, registryRelease, runSaltTool, saltRegistry, stableEquivalent, validateSaltUsage } from "@/lib/prototypes/salt/adapter";

// Contract test for the @salt-ds/mcp snapshot behind the adapter (design.md,
// decision 6). If a snapshot upgrade changes these answers, this fails first.
describe("Salt adapter", () => {
  it("loads the committed registry, not the one bundled in @salt-ds/mcp", async () => {
    const registry = await saltRegistry();
    const core = registry.packages.find((entry) => entry.name === "@salt-ds/core");
    expect(core?.version).toBe(registryRelease().release);
    expect(core?.version).not.toBe("1.58.0");
    expect(await saltRegistry()).toBe(registry);
  });

  it("answers component queries for Button and Table", async () => {
    const registry = await saltRegistry();
    for (const name of ["Button", "Table"]) {
      const { result, lookup } = runSaltTool(registry, "get_component", { name });
      expect((result as { component: { name: string } }).component.name).toBe(name);
      expect(lookup).toMatchObject({ tool: "get_component", query: name });
      expect(lookup.entries).toContain(name);
    }
  });

  it("answers the App header pattern with the components it is composed of", async () => {
    const { result, lookup } = runSaltTool(await saltRegistry(), "get_pattern", { name: "App header" });
    expect((result as { pattern: { name: string } }).pattern.name).toBe("App header");
    expect(lookup.entries).toEqual(expect.arrayContaining(["App header", "Navigation item", "Button"]));
  });

  it("answers every generator tool without throwing", async () => {
    const registry = await saltRegistry();
    const inputs = {
      discover_salt: { query: "status indicator for payment state" },
      recommend_component: { task: "show a payment's status" },
      get_composition_recipe: { query: "form with validation" },
      get_component: { name: "Status indicator" },
      get_pattern: { name: "Vertical navigation" },
      get_examples: { target_name: "Table" },
      recommend_tokens: { query: "separator color" },
      search_api_surface: { query: "Button" },
    } as const;
    for (const [tool, input] of Object.entries(inputs)) {
      const { result } = runSaltTool(registry, tool as keyof typeof inputs, input);
      expect(result, tool).not.toHaveProperty("error");
    }
  });

  it("runs Salt's usage validator on a sample, reporting a deprecated prop with Salt's fix", async () => {
    const result = validateSaltUsage(await saltRegistry(), `import { Button } from "@salt-ds/core";\nexport default function Sample() { return <Button variant="cta">Release</Button>; }`, registryRelease().release);
    const issue = result.issues.find((entry) => entry.id.startsWith("deprecated.prop"));
    expect(issue).toMatchObject({ severity: "warning", title: "Deprecated prop used: variant", suggested_fix: "Replace variant with appearance." });
  });

  it("names a lab component and its stable equivalent from the registry", async () => {
    const registry = await saltRegistry();
    expect(labComponentName(registry, "TokenizedInput")).toBe("Tokenized input");
    expect(stableEquivalent(registry, "TokenizedInput")).toBeNull();
    expect(stableEquivalent(registry, "Tabs")).toEqual({ name: "Tabs", package: "@salt-ds/core" });
    expect(stableEquivalent(registry, "ComboBox")).toMatchObject({ package: "@salt-ds/core" });
  });

  it("collects the names an answer mentions", () => {
    expect(namesIn({ recommended: { name: "Table", summary: "x" }, alternatives: [{ name: "Data grid", package: "@salt-ds/ag-grid-theme" }], composed_of: [{ component: "Button" }] })).toEqual(["Table", "Data grid", "Button"]);
  });
});
