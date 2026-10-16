import { describe, expect, it } from "vitest";
import { saltRegistry } from "@/lib/prototypes/salt/adapter";
import { KIT_VERSION, catalog, instructions, kitText, lessonRules } from "@/lib/prototypes/salt-kit";

// design.md, decision 6: the generator's instructions, built from the committed registry.
describe("Salt kit", () => {
  it("names only components the committed registry lists", async () => {
    const registry = await saltRegistry();
    const names = new Set(registry.components.map((component) => component.name));
    const entries = catalog(registry);
    expect(entries.length).toBeGreaterThan(60);
    for (const entry of entries) expect(names.has(entry.name), entry.name).toBe(true);
  });

  it("points Tabs to core and dates to date-components, not lab", async () => {
    const entries = catalog(await saltRegistry());
    expect(entries.find((entry) => entry.name === "Tabs")?.package).toBe("@salt-ds/core");
    for (const name of ["Date picker", "Date input", "Calendar"]) expect(entries.find((entry) => entry.name === name)?.package, name).toBe("@salt-ds/date-components");
    expect(entries.filter((entry) => entry.package === "@salt-ds/lab").map((entry) => entry.name).sort()).toEqual(["Avatar Group", "Static list", "System status", "Tokenized input"]);
    expect(kitText(await saltRegistry())).toContain("Tabs are in @salt-ds/core, and dates are in @salt-ds/date-components, not lab.");
  });

  it("leaves out what the frame provides and packages generated code can't import", async () => {
    const entries = catalog(await saltRegistry());
    for (const name of ["Salt provider", "Localization provider", "Chart", "Carousel", "Splitter"]) expect(entries.find((entry) => entry.name === name), name).toBeUndefined();
  });

  it("states the provider, shell, and data contracts, and carries a version stamp", async () => {
    const text = kitText(await saltRegistry());
    for (const phrase of ["Never render SaltProvider", "Write only the page body", 'import from it so every variant shows the same data', "If something can't be verified from Salt's sources, don't use it", "Salt 1.73.0"]) expect(text).toContain(phrase);
    expect(KIT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("appends active lessons as numbered rules with their scope", async () => {
    const lessons = [
      { id: "lsn_aaaaaaaaaaaaaaaa", text: "Always show amounts with currency codes, right-aligned.", scope: { kind: "general" }, category: "Content" },
      { id: "lsn_bbbbbbbbbbbbbbbb", text: "Show cut-off times in every row.", scope: { kind: "persona", personaId: "per_aaaaaaaaaaaaaaaa", personaName: "Maya Lindqvist" }, category: "Persona need" },
    ] as const;
    expect(lessonRules(lessons)).toContain("1. Always show amounts with currency codes, right-aligned. (Content; every persona)\n2. Show cut-off times in every row. (Persona need; for Maya Lindqvist)");
    expect(instructions(await saltRegistry(), [])).not.toContain("Lessons from this workspace");
  });
});
