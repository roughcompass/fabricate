import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { PAGE_SIZE, focusOf, furtherDependents, impactSentence, relationshipPage, runLevel, searchMap, systemLevel } from "@/lib/relationships/levels";
import { type MapView, loadMapView } from "@/lib/relationships/map-view";
import { buildAssessment, buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";
import { type MapWorld, seedMapWorld } from "../support/map-world";
import { manifest } from "../support/profiles";
import { seedRun } from "../support/scenarios";

const node = (view: MapView, label: string) => [...view.repositories.values()].find((repository) => repository.label === label)!.nodeId;
const labelOf = (view: MapView, id: string) => view.repositories.get(id)?.label ?? id;

describe("map levels", () => {
  let db: Db;
  let world: MapWorld;
  let view: MapView;

  beforeAll(async () => {
    db = createTestDb();
    world = await seedMapWorld(db, { runtimeContract: true });
    view = loadMapView(db, world.run)!;
  });

  it("opens on the Run's runtime systems and lone repositories, each with its repositories, and the relationships between them (Opening the map)", () => {
    const run = runLevel(db, view);

    expect(run.groups.map((group) => [group.label, group.repositories, group.internal])).toEqual([
      ["access-shell", 5, 5],
      ["design-tokens", 1, 0],
      ["ledger", 1, 0],
      ["orphan-shell", 2, 1],
      ["scratch", 1, 0],
    ]);
    expect(run.relationships.map((relationship) => [relationship.from.label, relationship.to.label, relationship.repositoryRelationships])).toEqual([["access-shell", "design-tokens", 3]]);
    expect(run.total).toBe(10);
    expect(run.groups[0]!.href).toBe(`${view.base}/systems/${node(view, "access-shell")}`);
    expect(run.shared.map((entry) => [entry.label, entry.kind, entry.dependents])).toEqual([["design-tokens", "library", 3]]);
  });

  it("draws a runtime system's host above what it loads, then the libraries they use (Host above the repositories it loads)", () => {
    const access = systemLevel(db, view, node(view, "access-shell"))!;
    const rows = access.diagram.rows.map((row) => row.map((box) => box.label).sort());

    expect(access.label).toBe("access-shell");
    expect(rows).toEqual([[], ["access-shell"], ["fx-board", "legacy-tool", "payee-hub", "rates"], ["design-tokens"]]);
    const host = node(view, "access-shell");
    expect(access.diagram.model.arrows.filter((arrow) => arrow.from === host).map((arrow) => labelOf(view, arrow.to)).sort()).toEqual(["fx-board", "legacy-tool", "payee-hub", "rates"]);
    const marks = new Map(access.diagram.rows.flat().map((box) => [box.label, box.marks]));
    expect(marks.get("access-shell")).toEqual(["Host"]);
    expect(marks.get("fx-board")).toEqual([]);
    expect(systemLevel(db, view, "missing")).toBeUndefined();
  });

  it("merges a host's two ways of loading a repository into one arrow with both signals (Two rules, one arrow)", () => {
    const access = systemLevel(db, view, node(view, "access-shell"))!;
    const arrow = access.diagram.model.arrows.find((item) => item.from === node(view, "access-shell") && item.to === node(view, "fx-board"))!;

    expect(arrow.signals.map((signal) => signal.rule).sort()).toEqual(["composition.federation-name", "composition.import-map-specifier"]);
    for (const signal of arrow.signals) expect(signal.evidence.length).toBeGreaterThan(0);
  });

  it("counts the third-party packages a diagram leaves out, and draws the library built in the Run (Third-party packages omitted)", () => {
    const access = systemLevel(db, view, node(view, "access-shell"))!;

    expect(access.diagram.thirdParty.map((item) => item.name)).toEqual(["react", "webpack"]);
    expect(access.diagram.model.arrows.some((arrow) => arrow.to === node(view, "design-tokens"))).toBe(true);
  });

  it("lists the libraries built in the Run that a runtime system's repositories depend on (Shared library in a runtime system)", () => {
    const access = systemLevel(db, view, node(view, "access-shell"))!;

    expect(access.shared.map((entry) => [entry.label, entry.kind, entry.dependents])).toEqual([["design-tokens", "library", 3]]);
  });

  it("draws a second runtime system with its own host and the repository it loads", () => {
    const orphans = systemLevel(db, view, node(view, "orphan-shell"))!;

    expect(orphans.diagram.rows.map((row) => row.map((box) => box.label))).toEqual([[], ["orphan-shell"], ["orphan-widget"], []]);
    expect([...orphans.members].map((member) => labelOf(view, member)).sort()).toEqual(["orphan-shell", "orphan-widget"]);
  });

  it("leads a library's focus with its direct dependents, their runtime systems, and the repositories that depend on it through them (Leading count)", () => {
    const focus = focusOf(db, view, view.base, node(view, "design-tokens"))!;

    expect(focus.sentence).toBe("Changing design-tokens directly affects 3 repositories in 1 runtime system; 1 more depends on it through them.");
    expect(focus.dependents.groups.map((group) => [group.label, group.rows.map((row) => row.label)])).toEqual([["access-shell", ["fx-board", "payee-hub", "rates"]]]);
    const row = focus.dependents.groups[0]!.rows[0]!;
    expect(row.signals[0]).toMatchObject({ type: "package_dependency", rule: "package.exact-name" });
    for (const id of row.signals[0]!.evidence) expect(focus.evidence[id]).toMatchObject({ path: "package.json" });
  });

  it("lists a runtime contract among both dependents and dependencies (Runtime contract both ways)", () => {
    const focus = focusOf(db, view, view.base, node(view, "payee-hub"))!;
    const labels = (list: typeof focus.dependents) => list.groups.flatMap((group) => group.rows.map((row) => row.label));

    expect(labels(focus.dependents)).toContain("access-shell");
    expect(labels(focus.dependencies)).toContain("access-shell");
    expect(focus.thirdParty.map((item) => item.name)).toEqual(["react", "webpack"]);
  });

  it("describes a package no repository produces as third-party, with each declared range, by runtime system (Third-party package)", () => {
    const focus = focusOf(db, view, view.base, "package:react")!;

    expect(focus.sentence).toBe("react is third-party: no repository in this Run produces it. 6 repositories declare it in 3 runtime systems.");
    expect(focus.producer).toBeNull();
    expect(focus.declarations.find((row) => row.label === "fx-board")).toMatchObject({ specifier: "^18.3.1", group: "access-shell" });
    expect(focus.declarations.find((row) => row.label === "ledger")).toMatchObject({ group: "ledger" });
  });

  it("names the repository that builds a package in the Run (Package built in the Run)", () => {
    const focus = focusOf(db, view, view.base, "package:@acme/design-tokens")!;

    expect(focus.producer?.label).toBe("design-tokens");
    expect(focus.sentence).toBe("@acme/design-tokens is built in this Run by design-tokens. 3 repositories declare it in 1 runtime system.");
  });

  it("finds repositories, services, and packages, exact matches first, opening a repository in its runtime system", () => {
    const shell = node(view, "access-shell");

    expect(searchMap(db, view, "react").map((match) => [match.kind, match.label])).toEqual([["package", "react"]]);
    expect(searchMap(db, view, "access").map((match) => [match.kind, match.label, match.detail, match.rank, match.href])).toEqual([["repository", "access-shell", "In access-shell", 1, `${view.base}/systems/${shell}?focus=${shell}`]]);
    expect(searchMap(db, view, "scratch").map((match) => [match.label, match.detail, match.rank])).toEqual([["scratch", null, 0]]);
  });

  it("pages the relationships in scope, in reading order", () => {
    const all = relationshipPage(db, view, { kind: "from", nodes: new Set(view.repositories.keys()) });
    const host = relationshipPage(db, view, { kind: "touching", node: node(view, "access-shell") });

    expect(all.total).toBeLessThanOrEqual(PAGE_SIZE);
    expect(all.rows.map((row) => row.from.label)).toEqual([...all.rows.map((row) => row.from.label)].sort());
    expect(host.rows.every((row) => row.from.label === "access-shell" || row.to?.label === "access-shell")).toBe(true);
    expect(Object.keys(host.evidence).length).toBeGreaterThan(0);
    // Third-party packages are counted by name, not rows; a package's own focus keeps them as rows.
    expect(all.thirdParty.find((item) => item.name === "react")?.dependents).toBe(6);
    expect(all.rows.some((row) => row.to === null && row.candidates.length === 0 && row.state === "unresolved" && row.type === "package_dependency" && row.reason?.includes("react"))).toBe(false);
    expect(relationshipPage(db, view, { kind: "package", name: "react" }).total).toBe(6);
  });
});

describe("indirect dependents", () => {
  it("counts each repository in a cycle once, never the focused library itself (Cycle among dependents)", async () => {
    const db = createTestDb();
    const repositories = ["lib", "a", "b", "c"].map((name) => buildRepository(db, { name }));
    const run = await seedRun(db, buildAssessment(db, { repositories }), repositories, [
      { "package.json": manifest({ name: "@acme/lib", version: "1.0.0", dependencies: { "@acme/a": "^1.0.0" } }) },
      { "package.json": manifest({ name: "@acme/a", version: "1.0.0", dependencies: { "@acme/lib": "^1.0.0", "@acme/b": "^1.0.0" } }) },
      { "package.json": manifest({ name: "@acme/b", version: "1.0.0", dependencies: { "@acme/lib": "^1.0.0", "@acme/a": "^1.0.0" } }) },
      { "package.json": manifest({ name: "@acme/c", version: "1.0.0", dependencies: { "@acme/a": "^1.0.0" } }) },
    ]);
    const view = loadMapView(db, run)!;
    const focus = focusOf(db, view, view.base, node(view, "lib"))!;

    expect(focus.dependents.total).toBe(2);
    expect(furtherDependents(db, view, node(view, "lib"), new Set([node(view, "a"), node(view, "b")]))).toBe(1);
    expect(focus.sentence).toBe("Changing lib directly affects 2 repositories in 2 runtime systems; 1 more depends on it through them.");
  });

  it("states when nothing depends on a repository", () => {
    expect(impactSentence("scratch", 0, 0, 0)).toBe("Nothing in this Run depends on scratch.");
    expect(impactSentence("design-tokens", 162, 4, 40)).toBe("Changing design-tokens directly affects 162 repositories in 4 runtime systems; 40 more depend on it through them.");
  });
});
