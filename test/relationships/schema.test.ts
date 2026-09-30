import { type JsonObject, dump } from "@repo-facts/contract";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareDocument } from "@/lib/documents/digested";
import { resolveRelationships } from "@/lib/relationships/resolve";
import { type MapDocument, edgeId, mapProblems, nodeId } from "@/lib/relationships/schema";
import { contributed, manifest, missing } from "../support/profiles";

/** A deep copy with every object's keys inserted in reverse order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversedKeys(item)]));
  return value;
}

describe("Relationship Map document contract", () => {
  let document: JsonObject;
  let map: MapDocument;

  beforeAll(async () => {
    const targets = [
      await contributed("ui", { "package.json": manifest({ name: "@acme/ui", version: "1.0.0" }) }),
      await contributed("fork", { "package.json": manifest({ name: "@acme/ui", version: "1.1.0" }) }),
      await contributed("app", { "package.json": manifest({ name: "app", version: "1.0.0", dependencies: { "@acme/ui": "^1.0.0", react: "18.3.1" } }), "src/api.ts": 'export const f = () => fetch("https://api.example.test/x");\n' }),
      missing("billing", "failed"),
    ];
    document = resolveRelationships({ targets, outOfScope: [] });
    map = document as unknown as MapDocument;
  });

  it("accepts a resolved map with every resolution state it produced", () => {
    expect(mapProblems(document)).toEqual([]);
    expect(new Set(map.edges.map((edge) => edge.state))).toEqual(new Set(["resolved", "ambiguous", "unresolved"]));
    expect(document).toMatchObject({ schema: "fabricate.relationship_map", schema_version: 1, resolver_version: "1", coverage: { complete: false } });
  });

  it("derives identifiers from identity alone, independent of key insertion order", () => {
    expect(nodeId({ kind: "package", name: "@acme/ui" })).toBe(nodeId(reversedKeys({ kind: "package", name: "@acme/ui" }) as never));
    const reference = { type: "package", role: "consumer", identifier: { name: "@acme/ui", extra: "x" } };
    expect(edgeId({ type: "package_dependency", from: map.nodes[0]!.id, reference })).toBe(edgeId({ type: "package_dependency", from: map.nodes[0]!.id, reference: reversedKeys(reference) as never }));
    // Describing fields do not change a node's identity.
    const repository = map.nodes.find((node) => node.kind === "repository")!;
    expect(nodeId({ ...repository, commit: "0".repeat(40) } as never)).toBe(repository.id);
  });

  it("stores the same canonical text and digest regardless of key insertion order", () => {
    const forward = prepareDocument("relationshipMap", document);
    const reversed = prepareDocument("relationshipMap", reversedKeys(document) as JsonObject);
    expect(reversed.text).toBe(forward.text);
    expect(reversed.digest).toBe(forward.digest);
    expect(forward.text).toBe(dump(document));
  });

  it("orders nodes, edges, candidates, and evidence by identifier", () => {
    const sorted = (values: string[]) => [...values].sort();
    expect(map.nodes.map((node) => node.id)).toEqual(sorted(map.nodes.map((node) => node.id)));
    expect(map.edges.map((edge) => edge.id)).toEqual(sorted(map.edges.map((edge) => edge.id)));
    for (const edge of map.edges) {
      expect(edge.candidates).toEqual(sorted(edge.candidates));
      expect(edge.evidence).toEqual(sorted(edge.evidence));
    }
  });

  it.each<[string, (copy: MapDocument) => void, RegExp]>([
    ["a node whose identifier does not match its identity", (copy) => void ((copy.nodes.find((node) => node.kind === "package") as { name: string }).name = "renamed"), /does not match its identity/],
    ["an edge to a missing node", (copy) => void (copy.edges.find((edge) => edge.to)!.to = `node_${"0".repeat(24)}`), /refers to missing node/],
    ["an ambiguous edge without candidates", (copy) => void (copy.edges.find((edge) => edge.state === "ambiguous")!.candidates = []), /two or more candidates exactly when it is ambiguous/],
    ["an unresolved edge without a reason", (copy) => void (copy.edges.find((edge) => edge.state === "unresolved")!.reason = null), /must explain why it is unresolved/],
    ["an edge citing evidence the map does not embed", (copy) => void (copy.evidence = {}), /cites missing evidence/],
    ["edges out of order", (copy) => void copy.edges.reverse(), /Edges must be ordered by identifier/],
    ["coverage that claims completeness with a gap", (copy) => void (copy.coverage.complete = true), /Coverage is complete exactly when no target is missing/],
    ["an unknown resolution state", (copy) => void ((copy.edges[0] as { state: string }).state = "probably"), /state/],
  ])("rejects %s", (_name, tamper, problem) => {
    const copy = structuredClone(map);
    tamper(copy);
    expect(mapProblems(copy as unknown as JsonObject)).toContainEqual(expect.stringMatching(problem));
  });
});
