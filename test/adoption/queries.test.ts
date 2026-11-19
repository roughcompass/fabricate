import { beforeEach, describe, expect, it } from "vitest";
import { componentAdoption, designSystemAdoption, packageAdoption, replaceableHtml, tokenUse } from "@/lib/adoption/queries";
import { designSystemCoverage } from "@/lib/adoption/fleet";
import { type TrackedDesignSystem, trackedDesignSystem } from "@/lib/adoption/tracked";
import { storeEntry } from "@/lib/catalog/entries";
import { getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { deleteRepository } from "@/lib/repositories/registration";
import { buildAssessment, buildRepository } from "../support/builders";
import { saltEntry } from "../support/catalog";
import { createTestDb } from "../support/db";
import { manifest } from "../support/profiles";
import { seedRun, seedSurvey } from "../support/scenarios";

/*
 * Adoption Analytics' queries (establish-frontend-registry, task 6.2) over a
 * seeded fleet: two Salt applications, a repository without a design system,
 * one with no Profile, one whose Profile predates the design-system facts,
 * and a deleted one.
 */

const lockfile = (name: string, versions: Record<string, string>) =>
  JSON.stringify({ name, lockfileVersion: 3, packages: { "": { name }, ...Object.fromEntries(Object.entries(versions).map(([dependency, version]) => [`node_modules/${dependency}`, { version }])) } });

const WEB = {
  "package.json": manifest({ name: "web", version: "1.0.0", dependencies: { "@salt-ds/core": "1.75.0", "@salt-ds/theme": "1.48.0" } }),
  "src/App.tsx": 'import { Button } from "@salt-ds/core";\nexport const App = () => (\n  <main>\n    <Button appearance="solid">Save</Button>\n    <Button appearance="bordered" className="wide">Cancel</Button>\n    <Button {...rest}>More</Button>\n    <button>Raw</button>\n  </main>\n);\n',
  "src/App.module.css": ".wide { padding: var(--salt-spacing-300); color: #0a6; }\n",
  "src/Button.stories.tsx": 'import { Button } from "@salt-ds/core";\nexport const Primary = () => <Button appearance="solid">Story</Button>;\n',
};

const ORDERS = {
  "package.json": manifest({ name: "orders", version: "1.0.0", dependencies: { "@salt-ds/core": "^1.75.0" } }),
  "package-lock.json": lockfile("orders", { "@salt-ds/core": "1.75.0" }),
  "src/Orders.tsx": 'import { Button, Text } from "@salt-ds/core";\nexport const Orders = () => (\n  <section>\n    <Text>Orders</Text>\n    <Text>Total</Text>\n    <Button appearance="solid">Pay</Button>\n    <button>Refund</button>\n    <button>Void</button>\n  </section>\n);\n',
};

const PLAIN = {
  "package.json": manifest({ name: "plain", version: "1.0.0", dependencies: { react: "19.3.1" } }),
  "src/App.tsx": "export const App = () => <button>Go</button>;\n",
};

describe("Adoption Analytics' queries", () => {
  let db: Db;
  let tracked: TrackedDesignSystem;
  const names = (items: readonly { name: string }[]) => items.map((item) => item.name);

  beforeEach(async () => {
    db = createTestDb();
    storeEntry(db, saltEntry());
    await seedSurvey(db, buildRepository(db, { name: "web" }), { files: WEB });
    await seedSurvey(db, buildRepository(db, { name: "orders" }), { files: ORDERS });
    await seedSurvey(db, buildRepository(db, { name: "plain" }), { files: PLAIN });
    buildRepository(db, { name: "unprofiled" });
    const legacy = [buildRepository(db, { name: "legacy" })];
    await seedRun(db, buildAssessment(db, { repositories: legacy }), legacy, [WEB], { profileVersion1: true });
    const gone = buildRepository(db, { name: "gone" });
    await seedSurvey(db, gone, { files: WEB });
    deleteRepository(db, gone.publicId, "gone");
    tracked = trackedDesignSystem(db, getConfig(), "salt")!;
  });

  it("counts registered Repositories as covered or not, and why not (Repository not yet profiled)", () => {
    const coverage = designSystemCoverage(db);
    expect(coverage.registered).toBe(5);
    expect(names(coverage.covered)).toEqual(["orders", "plain", "web"]);
    expect(coverage.notCovered.map((repository) => [repository.name, repository.reason])).toEqual([
      ["legacy", "facts_unknown"],
      ["unprofiled", "no_profile"],
    ]);
  });

  it("tracks the components of the newest Salt entry", () => {
    expect(tracked).toMatchObject({ id: "salt", name: "Salt", entry: { version: "1.75.0", digest: saltEntry().digest } });
    expect(tracked.components).toHaveLength(saltEntry().content.components!.length);
    expect(tracked.sources.find((source) => source.name === "@salt-ds/mcp")).toMatchObject({ snapshot_date: "2026-03-31" });
  });

  it("shows components tracked and used, total usages, the Repositories using Salt, and the most, rarely, and never used (Salt overview)", () => {
    const adoption = designSystemAdoption(db, designSystemCoverage(db), tracked, { rarelyUsedPercentile: 25 });

    expect(names(adoption.repositories)).toEqual(["orders", "web"]);
    expect(adoption.componentsTracked).toBe(tracked.components.length);
    expect(adoption.componentsUsed).toBe(2);
    expect(adoption.usages).toEqual({ app: 6, stories: 1, tests: 0 });
    expect(adoption.mostUsed.map((component) => [component.name, component.usages.app, component.repositories])).toEqual([
      ["Button", 4, 2],
      ["Text", 2, 1],
    ]);
    expect(names(adoption.rarelyUsed)).toEqual(["Text"]);
    expect(names(adoption.unused)).toContain("Avatar");
    expect(names(adoption.unused)).not.toContain("Button");
    expect(adoption.unused).toHaveLength(tracked.components.length - 2);
    // The legacy and unprofiled Repositories aren't counted as not using Salt.
    expect(adoption.coverage.covered).toHaveLength(3);
  });

  it("widens rarely used with the configured percentile", () => {
    const adoption = designSystemAdoption(db, designSystemCoverage(db), tracked, { rarelyUsedPercentile: 100 });
    expect(names(adoption.rarelyUsed)).toEqual(["Text", "Button"]);
  });

  it("shows where Button is used and how: Repositories, props and values, unused props, customization, and stories (Button detail)", () => {
    const button = componentAdoption(db, designSystemCoverage(db), tracked, "Button");

    expect(button.repositories.map((item) => [item.repository.name, item.usages])).toEqual([
      ["web", { app: 3, stories: 1, tests: 0 }],
      ["orders", { app: 1, stories: 0, tests: 0 }],
    ]);
    expect(button.props.find((prop) => prop.name === "appearance")).toEqual({ name: "appearance", usages: 3, values: { bordered: 1, solid: 2 } });
    expect(button.props.find((prop) => prop.name === "className")).toEqual({ name: "className", usages: 1, values: {} });
    expect(button.unknownProps).toBe(1);
    const listed = tracked.components.find((component) => component.name === "Button")!.props.map((prop) => prop.name);
    expect(button.unusedProps).toEqual(listed.filter((prop) => !["appearance", "className"].includes(prop)).sort());
    expect(button.customized.of).toBe(4);
    expect(button.customized.count).toBeGreaterThanOrEqual(1);
    expect(names(button.stories)).toEqual(["web"]);
  });

  it("lists the raw HTML Salt replaces, with usages and the Repositories that write it (Replaceable HTML)", () => {
    const [button, ...others] = replaceableHtml(db, designSystemCoverage(db), "salt");
    expect(others).toEqual([]);
    expect(button).toMatchObject({ tag: "button", replacement: "Button" });
    expect(button!.usages).toBeGreaterThanOrEqual(3);
    expect(names(button!.repositories)).toEqual(expect.arrayContaining(["orders", "web"]));
  });

  it("shows the share of token-capable declarations that use Salt's tokens, with the counts it divides", () => {
    expect(tokenUse(designSystemCoverage(db), "salt")).toEqual({ count: 1, of: 2 });
  });

  it("shows a package's resolved versions, the Repositories on each, and those that declare it without a lockfile (Salt core versions)", () => {
    const core = packageAdoption(db, "@salt-ds/core");
    expect(core.profiled).toBe(4);
    expect(core.repositories.map((item) => [item.repository.name, item.ranges, item.resolved])).toEqual([
      ["legacy", ["1.75.0"], []],
      ["orders", ["^1.75.0"], ["1.75.0"]],
      ["web", ["1.75.0"], []],
    ]);
    expect(core.versions).toEqual([{ version: "1.75.0", repositories: 1, newest: true }]);
    expect(names(core.unresolved)).toEqual(["legacy", "web"]);
    expect(packageAdoption(db, "left-pad")).toMatchObject({ repositories: [], versions: [], unresolved: [] });
  });
});
