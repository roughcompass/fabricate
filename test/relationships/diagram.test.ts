import { describe, expect, it } from "vitest";
import { type DiagramEdge, diagramModel } from "@/lib/relationships/diagram";

const edge = (overrides: Partial<DiagramEdge> & Pick<DiagramEdge, "edgeId" | "from">): DiagramEdge => ({
  to: null,
  type: "composition",
  state: "resolved",
  rule: "rule",
  basis: "observed",
  evidence: ["ev_1"],
  kind: "architecture",
  referenceIdentifier: {},
  candidates: [],
  ...overrides,
});

const groups = new Map([
  ["shell", "seal:shell"],
  ["fx-board", "seal:fx"],
  ["fx-api", "seal:fx"],
]);
const labelOf = (id: string) => id;

describe("diagram model", () => {
  it("merges two signals between a host and an application into one arrow (Two rules, one arrow)", () => {
    const model = diagramModel(groups, [
      edge({ edgeId: "edge-mf", from: "shell", to: "fx-board", rule: "composition.module-federation-remote", evidence: ["ev_mf"] }),
      edge({ edgeId: "edge-im", from: "shell", to: "fx-board", rule: "composition.import-map", evidence: ["ev_im"] }),
    ], labelOf);

    expect(model.arrows).toEqual([
      {
        from: "shell",
        to: "fx-board",
        signals: [
          { edgeId: "edge-im", type: "composition", rule: "composition.import-map", basis: "observed", evidence: ["ev_im"] },
          { edgeId: "edge-mf", type: "composition", rule: "composition.module-federation-remote", basis: "observed", evidence: ["ev_mf"] },
        ],
      },
    ]);
  });

  it("draws a stub on the repository that declared an unmatched reference (Unmatched reference)", () => {
    const model = diagramModel(groups, [
      edge({ edgeId: "edge-iframe", from: "shell", type: "iframe", state: "unresolved", rule: "iframe.unresolved", referenceIdentifier: { origin: "https://legacy.invalid" } }),
      edge({ edgeId: "edge-ui", from: "fx-board", type: "package_dependency", state: "ambiguous", referenceIdentifier: { name: "@acme/ui" }, candidates: ["ui-a", "ui-b"] }),
    ], labelOf);

    expect(model.arrows).toEqual([]);
    expect(model.stubs).toEqual([
      { box: "fx-board", edgeId: "edge-ui", type: "package_dependency", state: "ambiguous", label: "One of ui-a, ui-b", candidates: ["ui-a", "ui-b"] },
      { box: "shell", edgeId: "edge-iframe", type: "iframe", state: "unresolved", label: "https://legacy.invalid", candidates: [] },
    ]);
  });

  it("counts third-party packages and never draws them, and leaves out each repository's own package", () => {
    const model = diagramModel(groups, [
      edge({ edgeId: "edge-react-1", from: "shell", to: "node_react", type: "package_dependency", state: "unresolved", rule: "package.unresolved", kind: "third_party", referenceIdentifier: { name: "react" } }),
      edge({ edgeId: "edge-react-2", from: "fx-board", to: "node_react", type: "package_dependency", state: "unresolved", rule: "package.unresolved", kind: "third_party", referenceIdentifier: { name: "react" } }),
      edge({ edgeId: "edge-pad", from: "fx-board", to: "node_pad", type: "package_dependency", state: "unresolved", rule: "package.unresolved", kind: "third_party", referenceIdentifier: { name: "left-pad" } }),
      edge({ edgeId: "edge-own", from: "fx-board", to: "node_fx", type: "package_production", kind: "own_package" }),
    ], labelOf);

    expect(model.arrows).toEqual([]);
    expect(model.stubs).toEqual([]);
    expect(model.thirdPartyPackages).toEqual(["left-pad", "react"]);
  });

  it("folds a relationship inside a group, and turns a relationship to itself into a badge", () => {
    const model = diagramModel(groups, [
      edge({ edgeId: "edge-internal", from: "fx-board", to: "fx-api", type: "package_dependency" }),
      edge({ edgeId: "edge-self", from: "shell", to: "shell", type: "runtime_contract", kind: "self" }),
    ], labelOf);

    expect(model.arrows).toEqual([]);
    expect(model.internal).toEqual(new Map([["seal:fx", 1]]));
    expect(model.badges).toEqual([{ box: "shell", signals: [expect.objectContaining({ edgeId: "edge-self", type: "runtime_contract" })] }]);
  });
});
