import { describe, expect, it } from "vitest";
import { compositionOf } from "@/lib/applications/composition";
import type { Fact, FactDocument } from "@/lib/profiles/states";

/*
 * What a build is composed of, from the Profile of its commit
 * (restore-toolbar-tools-and-branch-previews, design decisions 7 and 9,
 * tasks 9.1 and 11.1): its Module Federation remotes, import-map entries,
 * single-spa roles, the containers it is, and whether it renders a Salt
 * provider, which decides whether Settings offers the theme switch.
 */

const fact = (key: string, value: Fact["value"], evidence: string[] = ["e1"]): Fact => ({ key, state: "observed", value, evidence, rule: "test" });

function profile(categories: Record<string, Fact[]>, evidence: Record<string, string> = { e1: "src/index.html" }): FactDocument {
  return {
    detector_release: "0.7.0",
    categories: Object.fromEntries(Object.entries(categories).map(([id, facts]) => [id, { state: facts.length ? "observed" : "absent", facts, search: { complete: true, skipped: [], surface: [], rules: [] } }])),
    evidence: Object.fromEntries(Object.entries(evidence).map(([id, path]) => [id, { path, location: { kind: "lines", start: 1, end: 1 } }])),
  };
}

/** Quotes desk's Profile, as Surveyor reports it: a Module Federation host, an import map, a single-spa root configuration, and Salt with its provider. */
const QUOTES_DESK = profile({
  composition: [
    fact("module-federation:quotesDesk", {
      mechanism: "module-federation",
      package: "@rspack/core",
      api: "ModuleFederationPluginV1",
      name: { kind: "literal", value: "quotesDesk" },
      remotes: [{ alias: "quotesPanel", federation_name: "quotesPanel", entry: { kind: "literal", value: "http://127.0.0.1:9311/remoteEntry.js" } }],
      exposes: [],
      shared: ["@salt-ds/core", "react", "react-dom"],
    }),
    fact("import-map:@fixtures/quotes-panel", { mechanism: "import-map", specifier: "@fixtures/quotes-panel", url: "http://127.0.0.1:9312/ticker.js", source: "src/index.html" }),
    fact("single-spa:root-config", { mechanism: "single-spa", role: "root-config" }),
  ],
  design_systems: [fact("salt", { catalog: "salt", name: "Salt", packages: [], imported: true, theme_stylesheet: true, provider: true })],
});

/** Orders portal's: none of these. */
const ORDERS_PORTAL = profile({ composition: [], design_systems: [] });

describe("a build's composition", () => {
  it("reads Quotes desk's remote, import-map entry, root configuration, and Salt provider", () => {
    expect(compositionOf(QUOTES_DESK)).toEqual({
      remotes: [{ alias: "quotesPanel", container: "quotesPanel", entry: "http://127.0.0.1:9311/remoteEntry.js" }],
      imports: [{ specifier: "@fixtures/quotes-panel", url: "http://127.0.0.1:9312/ticker.js" }],
      singleSpa: { rootConfig: true, application: false },
      containers: [],
      saltProvider: true,
    });
  });

  it("offers no theme switch for Orders portal, whose Profile shows no Salt provider, or for a build with no Profile", () => {
    expect(compositionOf(ORDERS_PORTAL).saltProvider).toBe(false);
    expect(compositionOf(null).saltProvider).toBe(false);
    // Salt declared and imported, but never rendered through its provider, isn't enough.
    const declared = profile({ design_systems: [fact("salt", { catalog: "salt", name: "Salt", packages: [], imported: true, theme_stylesheet: false, provider: false })] });
    expect(compositionOf(declared).saltProvider).toBe(false);
  });

  it("names a remote a host loads by code with no address, and the containers a remote is", () => {
    const shell = profile({
      composition: [
        fact("module-federation:mfShell", {
          mechanism: "module-federation",
          name: { kind: "literal", value: "mfShell" },
          remotes: [
            { alias: "mfAdmin", federation_name: "mfAdmin", entry: { kind: "literal", value: "http://127.0.0.1:9101/remoteEntry.js" } },
            { alias: "mfBilling", federation_name: null, entry: { kind: "unresolved", reason: "computed", detail: "The remote is loaded by code" } },
          ],
          exposes: [],
        }),
        fact("module-federation:quotesPanel", { mechanism: "module-federation", name: { kind: "literal", value: "quotesPanel" }, remotes: [], exposes: ["./Quotes"] }),
      ],
    });
    const composition = compositionOf(shell);
    expect(composition.remotes).toEqual([
      { alias: "mfAdmin", container: "mfAdmin", entry: "http://127.0.0.1:9101/remoteEntry.js" },
      { alias: "mfBilling", container: null, entry: null },
    ]);
    expect(composition.containers).toEqual([{ name: "quotesPanel", exposes: ["./Quotes"] }]);
  });

  it("takes only the facts about the package in a monorepo's directory", () => {
    const monorepo = profile(
      { design_systems: [fact("salt", { catalog: "salt", name: "Salt", packages: [], provider: true }, ["admin"])] },
      { admin: "apps/admin/src/main.tsx" },
    );
    expect(compositionOf(monorepo, "apps/admin").saltProvider).toBe(true);
    expect(compositionOf(monorepo, "apps/orders").saltProvider).toBe(false);
  });
});
