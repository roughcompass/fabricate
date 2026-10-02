import { describe, expect, it } from "vitest";
import { type PlacementPortal, type PlacementRepository, placeRepositories } from "@/lib/relationships/placement";

const repository = (nodeId: string, application: string | null, lineOfBusiness: string | null, portals: string[] = []): PlacementRepository => ({ nodeId, label: nodeId, application, lineOfBusiness, portals });
const portal = (id: string, lineOfBusiness: string | null, host: string | null = null): PlacementPortal => ({ id, lineOfBusiness, host });

describe("placement", () => {
  it("places a repository under both portals it's claimed in, marked with the other (Application in two portals)", () => {
    const { byNode } = placeRepositories([repository("fx-board", "sea_fx", "lob_markets", ["ptl_access", "ptl_markets"])], [portal("ptl_access", "lob_markets"), portal("ptl_markets", "lob_markets")], []);

    expect(byNode.get("fx-board")).toEqual([
      { kind: "portal", portal: "ptl_access", lineOfBusiness: "lob_markets", alsoIn: ["ptl_markets"], ownLineOfBusiness: null, host: false },
      { kind: "portal", portal: "ptl_markets", lineOfBusiness: "lob_markets", alsoIn: ["ptl_access"], ownLineOfBusiness: null, host: false },
    ]);
  });

  it("marks a repository with its own Line of Business in another's portal, and lists it under its own (Application from another Line of Business)", () => {
    const { byNode } = placeRepositories([repository("fx-board", "sea_fx", "lob_markets", ["ptl_access"])], [portal("ptl_access", "lob_payments")], []);

    expect(byNode.get("fx-board")).toEqual([
      { kind: "portal", portal: "ptl_access", lineOfBusiness: "lob_payments", alsoIn: [], ownLineOfBusiness: "lob_markets", host: false },
      { kind: "other_portal", portal: "ptl_access", lineOfBusiness: "lob_markets" },
    ]);
  });

  it("places a claimed repository in no portal under its Line of Business (Repository in no portal)", () => {
    const { byNode } = placeRepositories([repository("ledger", "sea_ledger", "lob_payments")], [], []);

    expect(byNode.get("ledger")).toEqual([{ kind: "line_of_business", lineOfBusiness: "lob_payments" }]);
  });

  it("places a portal's host under it, not in no portal, even when its application isn't claimed there", () => {
    const { byNode } = placeRepositories([repository("access-shell", "sea_shell", "lob_payments")], [portal("ptl_access", "lob_payments", "access-shell")], []);

    expect(byNode.get("access-shell")).toEqual([{ kind: "portal", portal: "ptl_access", lineOfBusiness: "lob_payments", alsoIn: [], ownLineOfBusiness: null, host: true }]);
  });

  it("groups linked unclaimed repositories into one runtime system named for its host, and leaves an unlinked one alone (Unclaimed runtime system)", () => {
    const { byNode, systems } = placeRepositories(
      [repository("orders", null, null), repository("shell", null, null), repository("reports", null, null), repository("tools", null, null)],
      [],
      [
        { from: "shell", to: "orders", type: "composition" },
        { from: "shell", to: "reports", type: "composition" },
        { from: "orders", to: "reports", type: "runtime_contract" },
      ],
    );

    expect(systems).toEqual([
      { id: "shell", name: "shell", host: "shell", members: ["orders", "reports", "shell"] },
      { id: "tools", name: "tools", host: null, members: ["tools"] },
    ]);
    expect(byNode.get("orders")).toEqual([{ kind: "unassigned", system: "shell" }]);
    expect(byNode.get("tools")).toEqual([{ kind: "unassigned", system: "tools" }]);
  });

  it("names a system with no host for its first repository by name", () => {
    const { systems } = placeRepositories([repository("b-iframe", null, null), repository("a-embedded", null, null)], [], [{ from: "b-iframe", to: "a-embedded", type: "iframe" }]);

    expect(systems.map((system) => [system.name, system.host])).toEqual([["a-embedded", null]]);
  });
});
