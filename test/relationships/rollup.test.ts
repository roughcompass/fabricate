import { describe, expect, it } from "vitest";
import { type PlacementPortal, type PlacementRepository, placeRepositories } from "@/lib/relationships/placement";
import { type Labels, groupKey, lineOfBusinessGroups, portalGroups, rollUp, runLevelGroups } from "@/lib/relationships/rollup";

const labels: Labels = { lineOfBusiness: (id) => id ?? "None", portal: (id) => id, application: (id) => id, system: (id) => id };
const repository = (nodeId: string, application: string, lineOfBusiness: string, portals: string[] = []): PlacementRepository => ({ nodeId, label: nodeId, application, lineOfBusiness, portals });
const portal = (id: string, lineOfBusiness: string, host: string | null = null): PlacementPortal => ({ id, lineOfBusiness, host });
const edge = (from: string, to: string, edgeId = `${from}->${to}`) => ({ edgeId, from, to });

describe("rollup", () => {
  it("rolls three host relationships into one between two Lines of Business (Relationships roll up into groups)", () => {
    // Three Payments hosts each compose an application whose SEAL aligns to Markets.
    const { byNode } = placeRepositories(
      [
        repository("host-a", "sea_hosts", "lob_payments"),
        repository("host-b", "sea_hosts", "lob_payments"),
        repository("host-c", "sea_hosts", "lob_payments"),
        repository("fx-board", "sea_fx", "lob_markets"),
        repository("rates", "sea_rates", "lob_markets"),
      ],
      [],
      [],
    );
    const rollup = rollUp(runLevelGroups(byNode, labels), [edge("host-a", "fx-board"), edge("host-b", "fx-board"), edge("host-c", "rates")]);

    expect(rollup.relationships).toEqual([{ from: groupKey.lineOfBusiness("lob_payments"), to: groupKey.lineOfBusiness("lob_markets"), repositoryRelationships: 3, edgeIds: ["host-a->fx-board", "host-b->fx-board", "host-c->rates"] }]);
    expect(rollup.groups.map((group) => [group.key, group.repositories])).toEqual([
      [groupKey.lineOfBusiness("lob_markets"), 2],
      [groupKey.lineOfBusiness("lob_payments"), 3],
    ]);
  });

  it("folds a relationship between two repositories of one SEAL application into it (Relationship inside a group)", () => {
    const { byNode } = placeRepositories([repository("ui", "sea_fx", "lob_markets", ["ptl_markets"]), repository("api-client", "sea_fx", "lob_markets", ["ptl_markets"])], [portal("ptl_markets", "lob_markets")], []);
    const applicationOf = new Map([
      ["ui", "sea_fx"],
      ["api-client", "sea_fx"],
    ]);
    const rollup = rollUp(portalGroups(byNode, "ptl_markets", applicationOf, labels), [edge("ui", "api-client"), edge("api-client", "ui")]);

    expect(rollup.relationships).toEqual([]);
    expect(rollup.groups).toEqual([{ key: groupKey.application("sea_fx"), label: "sea_fx", repositories: 2, internal: 2 }]);
  });

  it("counts a repository in two portals once in its Line of Business's total", () => {
    const { byNode } = placeRepositories([repository("fx-board", "sea_fx", "lob_markets", ["ptl_access", "ptl_markets"]), repository("rates", "sea_rates", "lob_markets", ["ptl_markets"])], [portal("ptl_access", "lob_markets"), portal("ptl_markets", "lob_markets")], []);
    const applicationOf = new Map([
      ["fx-board", "sea_fx"],
      ["rates", "sea_rates"],
    ]);
    const { portals } = lineOfBusinessGroups(byNode, "lob_markets", applicationOf, labels);
    const rollup = rollUp(portals, []);

    expect(rollup.groups.map((group) => [group.key, group.repositories])).toEqual([
      [groupKey.portal("ptl_access"), 1],
      [groupKey.portal("ptl_markets"), 2],
    ]);
    expect(rollup.total).toBe(2);
  });

  it("counts two rules between the same repositories as one repository relationship", () => {
    const { byNode } = placeRepositories([repository("shell", "sea_shell", "lob_payments"), repository("fx-board", "sea_fx", "lob_markets")], [], []);
    const rollup = rollUp(runLevelGroups(byNode, labels), [edge("shell", "fx-board", "edge-1"), edge("shell", "fx-board", "edge-2")]);

    expect(rollup.relationships).toEqual([{ from: groupKey.lineOfBusiness("lob_payments"), to: groupKey.lineOfBusiness("lob_markets"), repositoryRelationships: 1, edgeIds: ["edge-1", "edge-2"] }]);
  });
});
