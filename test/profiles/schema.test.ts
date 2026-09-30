import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceCandidate } from "@/lib/detectors/contract";
import { prepareDocument } from "@/lib/documents/digested";
import { type DetectedFact, type Findings, reconcileProfile } from "@/lib/profiles/reconcile";
import { CATEGORY_IDS, type ProfileDocument, SERVICE_FACTS, categoryState, isCharacterizable, profileProblems } from "@/lib/profiles/schema";
import { type Evidence, lineEvidence, pointerEvidence } from "@/lib/snapshot/evidence";
import type { BlobContent, SnapshotReader } from "@/lib/snapshot/reader";
import { SnapshotFixture } from "../support/snapshot";

const PACKAGE_JSON = `{
  "name": "orders-ui",
  "packageManager": "pnpm@9.1.0",
  "engines": { "node": ">=20" }
}
`;
const NVMRC = "18\n";
const CLIENT = `export const load = () => fetch("https://api.example.test/orders");\n`;

describe("Profile document contract", () => {
  let snapshots: SnapshotFixture;
  let reader: SnapshotReader;
  let manifest: BlobContent;
  let nvmrc: BlobContent;
  let client: BlobContent;

  const cited = (rule: string) => ({ commit: reader.commitSha, detector: "test", rule });
  const at = (content: BlobContent, rule: string, line = 1): Evidence => lineEvidence(content, cited(rule), line);
  const pointer = (content: BlobContent, rule: string, path: string): Evidence => pointerEvidence(content, cited(rule), "json", path);

  beforeAll(async () => {
    snapshots = SnapshotFixture.create("profile-schema");
    reader = await snapshots.open({ "package.json": PACKAGE_JSON, ".nvmrc": NVMRC, "src/client.ts": CLIENT });
    const read = async (path: string) => {
      const result = await reader.read(path);
      if (!result.ok) throw new Error(`${path} was skipped`);
      return result.content;
    };
    [manifest, nvmrc, client] = await Promise.all([read("package.json"), read(".nvmrc"), read("src/client.ts")]);
  });

  afterAll(() => snapshots.cleanup());

  const findings = (): Findings => {
    const facts: DetectedFact[] = [
      { category: "package_managers", key: ".", value: "pnpm", basis: "observed", evidence: [pointer(manifest, "manifest.package-manager", "/packageManager")], rule: "manifest.package-manager", detector: "test" },
      { category: "runtime_requirements", key: "node", value: ">=20", basis: "observed", evidence: [pointer(manifest, "manifest.engines", "/engines/node")], rule: "manifest.engines", detector: "test" },
      { category: "runtime_requirements", key: "node", value: "18", basis: "observed", evidence: [at(nvmrc, "runtime.nvmrc")], rule: "runtime.nvmrc", detector: "test" },
      {
        category: "frameworks",
        key: "react",
        value: "react",
        basis: "inferred",
        evidence: [at(client, "architecture.spa")],
        rule: "architecture.spa",
        reasoning: "A client module calls fetch from browser code.",
        detector: "test",
      },
    ];
    const service: ServiceCandidate = {
      key: "https://api.example.test",
      client: { kind: "fetch", package: null },
      callSites: [at(client, "services.fetch")],
      facts: {
        endpoint: { basis: "observed", value: { kind: "literal", origin: "https://api.example.test", path: "/orders" }, evidence: [at(client, "services.fetch")], rule: "services.fetch" },
        protocol: { basis: "observed", value: "http", evidence: [at(client, "services.fetch")], rule: "services.fetch" },
        substitutes: { basis: "absent", value: null, evidence: [], rule: "services.substitutes", search: { surface: ["src/client.ts"], complete: true, skipped: [] } },
      },
    };
    return {
      facts,
      searches: [
        { category: "test_frameworks", rule: "manifest.test-frameworks", surface: ["package.json"], complete: true, skipped: [] },
        { category: "package_managers", rule: "manifest.package-manager", surface: ["package.json"], complete: true, skipped: [] },
      ],
      services: [service],
      references: [
        {
          type: "service",
          role: "caller",
          identifier: { origin: "https://api.example.test" },
          basis: "observed",
          evidence: [at(client, "services.fetch")],
          rule: "services.fetch",
        },
      ],
      diagnostics: [],
    };
  };

  const profile = (input = findings()): ProfileDocument => reconcileProfile(input, reader, snapshots.profileSource, "2026.09.1");
  const mutated = (change: (document: ProfileDocument) => void): string[] => {
    const document = structuredClone(profile());
    change(document);
    return profileProblems(document);
  };

  it("accepts a reconciled Profile with every category and epistemic state", () => {
    const document = profile();
    expect(profileProblems(document)).toEqual([]);
    expect(Object.keys(document.categories)).toEqual(CATEGORY_IDS);
    expect(document.categories.package_managers!.state).toBe("observed");
    expect(document.categories.runtime_requirements!.state).toBe("conflicting");
    expect(document.categories.frameworks!.state).toBe("inferred");
    expect(document.categories.test_frameworks!.state).toBe("absent");
    expect(document.categories.composition!.state).toBe("unknown");
    expect(document.service_dependencies[0]!.access.state).toBe("unknown");
    expect(document.service_dependencies[0]!.substitutes.state).toBe("absent");
  });

  it.each<[string, (document: ProfileDocument) => void, string]>([
    ["an observed fact without evidence", (document) => void (document.categories.package_managers!.facts[0]!.evidence = []), "asserts a fact without evidence"],
    ["an inferred fact without reasoning", (document) => void delete document.categories.frameworks!.facts[0]!.reasoning, "without explaining its reasoning"],
    ["a conflict without its candidates", (document) => void document.categories.runtime_requirements!.facts[0]!.candidates!.pop(), "conflicting without its candidates"],
    ["candidates without a conflict", (document) => void (document.categories.package_managers!.facts[0]!.candidates = []), "lists candidates without a conflict"],
    ["a citation of unknown evidence", (document) => void (document.categories.package_managers!.facts[0]!.evidence = [`ev_${"0".repeat(24)}`]), "cites unknown evidence"],
    ["evidence from another commit", (document) => void Object.values(document.evidence).forEach((item) => (item.commit = "f".repeat(40))), "names another commit"],
    ["a missing category", (document) => void delete document.categories.composition, "categories are missing: composition"],
    ["an unsupported category", (document) => void (document.categories.telemetry = structuredClone(document.categories.composition!)), "categories are not supported: telemetry"],
    ["a state its facts do not support", (document) => void (document.categories.composition!.state = "absent"), "composition is absent but its facts and search make it unknown"],
    ["absence after an incomplete search", (document) => void (document.categories.test_frameworks!.search.complete = false), "test_frameworks is absent"],
    ["an access claim", (document) => void ((document.service_dependencies[0]!.access as { state: string }).state = "accessible"), "access.state"],
    ["an absent service fact without a search", (document) => void delete document.service_dependencies[0]!.substitutes.search, "absent without a complete bounded search"],
    ["misreported missing evidence", (document) => void (document.service_dependencies[0]!.missing_evidence = []), "misreports its missing evidence"],
    ["a misreported boundary", (document) => void (document.service_dependencies[0]!.characterizable = true), "misreports whether its boundary is characterizable"],
    ["a fractional value", (document) => void (document.categories.package_managers!.facts[0]!.value = 1.5), "value"],
    ["an unexpected field", (document) => void ((document as unknown as Record<string, unknown>).access_granted = true), "access_granted"],
  ])("rejects %s", (_name, change, message) => {
    expect(mutated(change)).toContainEqual(expect.stringContaining(message));
  });

  it("derives category states from facts and search coverage", () => {
    expect(categoryState([], true, true)).toBe("absent");
    expect(categoryState([], true, false)).toBe("unknown");
    expect(categoryState([], false, true)).toBe("unknown");
    expect(categoryState([{ state: "observed" }, { state: "inferred" }], true, true)).toBe("mixed");
    expect(categoryState([{ state: "observed" }, { state: "conflicting" }], true, true)).toBe("conflicting");
  });

  it("characterizes a boundary only with endpoint, operations, and consumed response fields", () => {
    expect(isCharacterizable(["timeout", "retry"])).toBe(true);
    for (const name of ["endpoint", "operations", "consumed_response_fields"] as const) expect(isCharacterizable([name])).toBe(false);
    expect(profile().service_dependencies[0]!.missing_evidence).toEqual(SERVICE_FACTS.filter((name) => !["endpoint", "protocol", "substitutes"].includes(name)));
  });

  it("produces the same digest regardless of object key insertion order", () => {
    const document = profile();
    const reversed = reverseKeys(document);
    expect(Object.keys(reversed)).toEqual(Object.keys(document).reverse());
    expect(profileProblems(reversed)).toEqual([]);
    expect(prepareDocument("repositoryProfile", reversed as never).digest).toBe(prepareDocument("repositoryProfile", document as never).digest);
  });

  it("produces the same document regardless of candidate order", () => {
    const forward = findings();
    const backward: Findings = {
      facts: [...forward.facts].reverse().map(reverseKeys),
      searches: [...forward.searches].reverse(),
      services: [...forward.services].reverse(),
      references: [...forward.references].reverse(),
      diagnostics: [],
    };
    expect(prepareDocument("repositoryProfile", profile(backward) as never).text).toBe(prepareDocument("repositoryProfile", profile(forward) as never).text);
  });
});

/** A deep copy whose object keys were inserted in reverse order. */
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseKeys) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reverseKeys(entry)]),
  ) as T;
}
