import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { PAGE_SIZE, applicationLevel, focusOf, furtherDependents, impactSentence, lineOfBusinessLevel, portalLevel, relationshipPage, runLevel, searchMap, systemLevel, unassignedLevel } from "@/lib/relationships/levels";
import { type MapView, loadMapView } from "@/lib/relationships/map-view";
import { buildInitiative, buildSource } from "../support/builders";
import { createTestDb } from "../support/db";
import { type MapWorld, claimMapWorld, seedMapWorld, seedMapWorldRun } from "../support/map-world";
import { createApplication, recordAssertion } from "@/lib/ownership/records";
import { manifest } from "../support/profiles";
import { seedAssessment } from "../support/scenarios";

const node = (view: MapView, label: string) => [...view.repositories.values()].find((repository) => repository.label === label)!.nodeId;
const labelOf = (view: MapView, id: string) => view.repositories.get(id)?.label ?? id;

describe("map levels", () => {
  let db: Db;
  let world: MapWorld;
  let view: MapView;

  beforeAll(async () => {
    db = createTestDb();
    world = await seedMapWorld(db, { runtimeContract: true });
    view = loadMapView(db, world.assessment)!;
  });

  it("opens on the Run's Lines of Business, each with its repositories, and the relationships between them (Opening the map)", () => {
    const run = runLevel(db, view);

    expect(run.groups.map((group) => [group.label, group.repositories])).toEqual([
      ["Markets", 2],
      ["Payments", 6],
      ["Unassigned", 4],
    ]);
    expect(run.relationships.map((relationship) => [relationship.from.label, relationship.to.label, relationship.repositoryRelationships])).toEqual([
      ["Markets", "Payments", 2],
      ["Payments", "Markets", 2],
      ["Payments", "Unassigned", 1],
    ]);
    expect(run.total).toBe(10);
    expect(run.shared.map((entry) => [entry.label, entry.kind, entry.dependents])).toEqual([["design-tokens", "library", 3]]);
  });

  it("lists a Line of Business's own portals and the portals of other Lines of Business its repositories appear in", () => {
    const markets = lineOfBusinessLevel(db, view, world.linesOfBusiness.markets.publicId)!;

    expect(markets.portals.map((group) => [group.label, group.repositories])).toEqual([["Markets", 1]]);
    expect(markets.otherPortals.map((group) => [group.label, group.repositories])).toEqual([["Access", 2]]);
    expect(markets.total).toBe(2);
    expect(lineOfBusinessLevel(db, view, "lob_missing0000000000")).toBeUndefined();
  });

  it("draws a portal's host above what it loads, the libraries they use, then the claimed applications it doesn't load (Host above the applications it loads)", () => {
    const access = portalLevel(db, view, world.portals.access.publicId)!;
    const rows = access.diagram.rows.map((row) => row.map((box) => box.label).sort());

    expect(rows).toEqual([["access-shell"], ["fx-board", "legacy-tool", "payee-hub", "rates"], ["design-tokens"], ["ledger"]]);
    const host = node(view, "access-shell");
    expect(access.diagram.model.arrows.filter((arrow) => arrow.from === host).map((arrow) => labelOf(view, arrow.to)).sort()).toEqual(["fx-board", "legacy-tool", "payee-hub", "rates"]);
    const marks = new Map(access.diagram.rows.flat().map((box) => [box.label, box.marks]));
    expect(marks.get("access-shell")).toEqual(["Host"]);
    expect(marks.get("fx-board")).toEqual(["Also in Markets", "Markets Line of Business"]);
    expect(marks.get("legacy-tool")).toEqual(["Not claimed here"]);
  });

  it("merges a host's two ways of loading an application into one arrow with both signals (Two rules, one arrow)", () => {
    const access = portalLevel(db, view, world.portals.access.publicId)!;
    const arrow = access.diagram.model.arrows.find((item) => item.from === node(view, "access-shell") && item.to === node(view, "fx-board"))!;

    expect(arrow.signals.map((signal) => signal.rule).sort()).toEqual(["composition.federation-name", "composition.import-map-specifier"]);
    for (const signal of arrow.signals) expect(signal.evidence.length).toBeGreaterThan(0);
  });

  it("counts the third-party packages a diagram leaves out, and draws the library built in the Run (Third-party packages omitted)", () => {
    const access = portalLevel(db, view, world.portals.access.publicId)!;

    expect(access.diagram.thirdParty.map((item) => item.name)).toEqual(["react", "webpack"]);
    expect(access.diagram.model.arrows.some((arrow) => arrow.to === node(view, "design-tokens"))).toBe(true);
  });

  it("compares a portal's claims with what its host loads (Claimed but not loaded, Loaded but not claimed, No host claimed)", () => {
    const access = portalLevel(db, view, world.portals.access.publicId)!;
    const markets = portalLevel(db, view, world.portals.markets.publicId)!;

    expect(access.membership.comparable).toBe(true);
    expect(access.membership.claimedNotLoaded.map((group) => group.label)).toEqual(["Ledger (SEAL-600)"]);
    expect(access.membership.loadedNotClaimed.map((item) => item.label)).toEqual(["legacy-tool"]);
    expect(markets.membership).toEqual({ comparable: false, claimedNotLoaded: [], loadedNotClaimed: [] });
  });

  it("lists the libraries built in the Run that a portal's applications depend on (Shared library in a portal)", () => {
    const access = portalLevel(db, view, world.portals.access.publicId)!;

    expect(access.shared.map((entry) => [entry.label, entry.kind, entry.dependents])).toEqual([["design-tokens", "library", 3]]);
  });

  it("draws an application with what depends on it above and what it depends on below", () => {
    const fx = applicationLevel(db, view, world.applications.fx.publicId)!;

    expect(fx.label).toBe("FX Board (SEAL-200)");
    expect(fx.diagram.rows.map((row) => row.map((box) => box.label))).toEqual([["access-shell"], ["fx-board"], ["design-tokens"]]);
    expect(fx.portals.map((portal) => portal.label)).toEqual(["Access", "Markets"]);
    expect(applicationLevel(db, view, "SEAL-200")).toBeUndefined();
    expect(applicationLevel(db, view, "wap_aaaaaaaaaaaaaaaa")).toBeUndefined();
  });

  it("groups unclaimed repositories into runtime systems, each with its own diagram (Unclaimed runtime system)", () => {
    const unassigned = unassignedLevel(db, view);
    const orphans = unassigned.systems.find((system) => system.label === "orphan-shell")!;

    expect(unassigned.systems.map((system) => [system.label, system.repositories])).toEqual([
      ["legacy-tool", 1],
      ["orphan-shell", 2],
      ["scratch", 1],
    ]);
    expect(orphans.internal).toBe(1);
    const system = systemLevel(db, view, orphans.href.split("/").at(-1)!)!;
    expect(system.diagram.rows[1]!.map((box) => box.label).sort()).toEqual(["orphan-shell", "orphan-widget"]);
  });

  it("leads a library's focus with its direct dependents, their portals, and the repositories that depend on it through them (Leading count)", () => {
    const focus = focusOf(db, view, view.base, node(view, "design-tokens"))!;

    expect(focus.sentence).toBe("Changing design-tokens directly affects 3 repositories in 2 portals; 1 more depends on it through them.");
    expect(focus.dependents.groups.map((group) => [group.label, group.rows.map((row) => row.label)])).toEqual([
      ["FX Board (SEAL-200) · Access, Markets", ["fx-board"]],
      ["Payee hub (SEAL-400) · Access", ["payee-hub"]],
      ["Rates (SEAL-300) · Access", ["rates"]],
    ]);
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

  it("describes a package no repository produces as third-party, with each declared range (Third-party package)", () => {
    const focus = focusOf(db, view, view.base, "package:react")!;

    expect(focus.sentence).toBe("react is third-party: no repository in this Run produces it. 6 repositories declare it in 2 portals.");
    expect(focus.producer).toBeNull();
    expect(focus.declarations.find((row) => row.label === "fx-board")).toMatchObject({ specifier: "^18.3.1", group: "FX Board (SEAL-200) · Access, Markets" });
  });

  it("names the repository that builds a package in the Run (Package built in the Run)", () => {
    const focus = focusOf(db, view, view.base, "package:@acme/design-tokens")!;

    expect(focus.producer?.label).toBe("design-tokens");
    expect(focus.sentence).toMatch(/^@acme\/design-tokens is built in this Run by design-tokens\. 3 repositories declare it in 2 portals\.$/);
  });

  it("finds repositories, applications, portals, services, and packages, exact matches first", () => {
    expect(searchMap(db, view, "SEAL-200").map((match) => [match.kind, match.label, match.detail, match.rank, match.href])).toEqual([["application", "FX Board", "SEAL-200", 0, `${view.base}/applications/${world.applications.fx.publicId}`]]);
    expect(searchMap(db, view, "react").map((match) => [match.kind, match.label])).toEqual([["package", "react"]]);
    expect(searchMap(db, view, "access").map((match) => [match.kind, match.label])).toEqual([
      ["repository", "access-shell"],
      ["application", "Access shell"],
      ["portal", "Access"],
    ]);
  });

  it("pages the relationships in scope, in reading order", () => {
    const all = relationshipPage(db, view, { kind: "from", nodes: new Set(view.repositories.keys()) });
    const host = relationshipPage(db, view, { kind: "touching", node: node(view, "access-shell") });

    expect(all.total).toBeLessThanOrEqual(PAGE_SIZE);
    expect(all.rows.map((row) => row.from.label)).toEqual([...all.rows.map((row) => row.from.label)].sort());
    expect(host.rows.every((row) => row.from.label === "access-shell" || row.to?.label === "access-shell")).toBe(true);
    expect(Object.keys(host.evidence).length).toBeGreaterThan(0);
  });
});

describe("map levels over time", () => {
  it("groups a Run started before its repositories were claimed by their current ownership (Earlier Run grouped by current ownership)", async () => {
    const db = createTestDb();
    const world = await seedMapWorldRun(db);
    expect(runLevel(db, loadMapView(db, world.assessment)!).groups.map((group) => group.label)).toEqual(["Unassigned"]);

    const claimedAt = new Date(Date.UTC(2026, 9, 2, 8, 0));
    claimMapWorld(db, world.sources, claimedAt);
    const view = loadMapView(db, world.assessment)!;

    expect(runLevel(db, view).groups.map((group) => group.label)).toEqual(["Markets", "Payments", "Unassigned"]);
    expect(view.asOf).toEqual(claimedAt);
  });
});

describe("indirect dependents", () => {
  it("counts each repository in a cycle once, never the focused library itself (Cycle among dependents)", async () => {
    const db = createTestDb();
    const sources = ["lib", "a", "b", "c"].map((name) => buildSource(db, { name }));
    const assessment = await seedAssessment(db, buildInitiative(db, { sources }), sources, [
      { "package.json": manifest({ name: "@acme/lib", version: "1.0.0", dependencies: { "@acme/a": "^1.0.0" } }) },
      { "package.json": manifest({ name: "@acme/a", version: "1.0.0", dependencies: { "@acme/lib": "^1.0.0", "@acme/b": "^1.0.0" } }) },
      { "package.json": manifest({ name: "@acme/b", version: "1.0.0", dependencies: { "@acme/lib": "^1.0.0", "@acme/a": "^1.0.0" } }) },
      { "package.json": manifest({ name: "@acme/c", version: "1.0.0", dependencies: { "@acme/a": "^1.0.0" } }) },
    ]);
    const view = loadMapView(db, assessment)!;
    const focus = focusOf(db, view, view.base, node(view, "lib"))!;

    expect(focus.dependents.total).toBe(2);
    expect(furtherDependents(db, view, node(view, "lib"), new Set([node(view, "a"), node(view, "b")]))).toBe(1);
    expect(focus.sentence).toBe("Changing lib directly affects 2 repositories; 1 more depends on it through them.");
  });

  it("states when nothing depends on a repository", () => {
    expect(impactSentence("scratch", 0, 0, 0)).toBe("Nothing in this Run depends on scratch.");
    expect(impactSentence("design-tokens", 162, 4, 40)).toBe("Changing design-tokens directly affects 162 repositories in 4 portals; 40 more depend on it through them.");
  });
});

describe("applications that share a SEAL ID", () => {
  it("groups each application's repositories apart, and addresses each by its own ID (Applications share one SEAL ID)", async () => {
    const db = createTestDb();
    const sources = ["payments-web", "payments-reports"].map((name) => buildSource(db, { name }));
    const assessment = await seedAssessment(db, buildInitiative(db, { sources }), sources, [
      { "package.json": manifest({ name: "payments-web", version: "1.0.0" }) },
      { "package.json": manifest({ name: "payments-reports", version: "1.0.0" }) },
    ]);
    const workspace = createApplication(db, { sealId: "88001", name: "Payments workspace" });
    const reporting = createApplication(db, { sealId: "88001", name: "Payments reporting" });
    const claim = { source: "person" as const, providedBy: "ana@example.com" };
    recordAssertion(db, { attribute: "application", repository: sources[0]!.id, application: workspace.id, ...claim });
    recordAssertion(db, { attribute: "application", repository: sources[1]!.id, application: reporting.id, ...claim });
    const view = loadMapView(db, assessment)!;

    expect([...view.applications.keys()].sort()).toEqual([workspace.publicId, reporting.publicId].sort());
    expect([...applicationLevel(db, view, workspace.publicId)!.members].map((member) => labelOf(view, member))).toEqual(["payments-web"]);
    expect([...applicationLevel(db, view, reporting.publicId)!.members].map((member) => labelOf(view, member))).toEqual(["payments-reports"]);
    expect(searchMap(db, view, "88001").map((match) => [match.label, match.href]).sort()).toEqual(
      [
        ["Payments reporting", `${view.base}/applications/${reporting.publicId}`],
        ["Payments workspace", `${view.base}/applications/${workspace.publicId}`],
      ].sort(),
    );
  });
});
