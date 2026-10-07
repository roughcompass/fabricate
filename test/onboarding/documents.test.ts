import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/db/errors";
import {
  type PortalContract,
  type RuntimeContract,
  canonicalize,
  cdaasViewProjection,
  digestOf,
  entitlementsSchema,
  externalLaunchSchema,
  hostConfigurationSchema,
  mfeLaunchSchema,
  originOf,
  portalContractSchema,
  runtimeContractSchema,
  studioModuleProjection,
  urlProblem,
} from "@/lib/onboarding/documents";

const portalContract: PortalContract = {
  capabilities: ["navigation", "theme", "events"],
  events: ["portal.navigate", "portal.theme-changed"],
  context: ["locale", "user"],
  allowedOrigins: ["https://cdn.example.com", "https://payments.example.com"],
  modes: {
    iframe: { sandbox: ["allow-scripts", "allow-forms"], permissions: ["clipboard-write"], loading: "lazy" },
    module_federation_2: { loading: "eager", shared: [{ name: "react", version: "^18.3.0", singleton: true }, { name: "@acme/design-tokens", version: "^4.0.0", singleton: false }], runtimeVersion: "^0.8.0" },
  },
};

const runtimeContract: RuntimeContract = {
  exports: [
    { name: "./Search", modes: ["module_federation_2", "esm"] },
    { name: "./Details", modes: ["module_federation_2"] },
  ],
  requires: { capabilities: ["theme", "navigation"], events: ["portal.navigate"], context: ["user", "locale"] },
  provides: { capabilities: [], events: ["payee.selected"], context: [] },
  shared: [{ name: "react", version: "^18.3.0", singleton: true }],
};

/** The same value with every object's keys and every list in reverse order. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return [...value].reverse().map(reversed);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversed(item)]));
  return value;
}

function fieldsOf(attempt: () => unknown): string[] {
  try {
    attempt();
  } catch (error) {
    if (error instanceof ValidationError) return error.issues.map((issue) => issue.field);
    throw error;
  }
  throw new Error("Expected a ValidationError");
}

describe("canonical onboarding documents", () => {
  it("gives equivalent documents one canonical text and digest, whatever their key and item order", () => {
    for (const [schema, value] of [
      [portalContractSchema, portalContract],
      [runtimeContractSchema, runtimeContract],
      [entitlementsSchema, { codes: ["PAYMENTS_VIEW", "PAYMENTS_APPROVE"], operator: "all" }],
      [hostConfigurationSchema, { pageSize: 25, variant: "compact", showHeader: false }],
      [externalLaunchSchema, { mode: "iframe", documentUrl: "https://payments.example.com/app", sandbox: ["allow-scripts", "allow-forms"], permissions: [] }],
      [mfeLaunchSchema, { mode: "module_federation_2", exposedModule: "./Search" }],
    ] as const) {
      const canonical = canonicalize(schema as never, value);
      const again = canonicalize(schema as never, reversed(value));
      expect(again.text).toBe(canonical.text);
      expect(again.digest).toBe(canonical.digest);
      expect(canonical.digest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("orders sets and named lists, and drops repeated set members", () => {
    const canonical = canonicalize(entitlementsSchema, { codes: ["B", "A", "B"], operator: "any" });
    expect(canonical.text).toBe('{"codes":["A","B"],"operator":"any"}');
    const contract = canonicalize(runtimeContractSchema, runtimeContract).value;
    expect(contract.exports.map((entry) => entry.name)).toEqual(["./Details", "./Search"]);
    expect(contract.exports[1]!.modes).toEqual(["esm", "module_federation_2"]);
    expect(digestOf({ b: 1, a: [2, 1] })).toBe(digestOf({ a: [1, 2], b: 1 }));
  });

  it("changes the digest when anything meaningful changes", () => {
    const changed = { ...portalContract, capabilities: ["navigation", "theme"] };
    expect(canonicalize(portalContractSchema, changed).digest).not.toBe(canonicalize(portalContractSchema, portalContract).digest);
  });

  it("refuses free-form or malformed contracts, naming every problem", () => {
    const fields = fieldsOf(() =>
      canonicalize(portalContractSchema, {
        ...portalContract,
        capabilities: ["navigation", "teleport"],
        allowedOrigins: ["https://cdn.example.com/assets", "http://insecure.example.com", "https://user:secret@cdn.example.com"],
        modes: { ...portalContract.modes, webcomponent: {} },
        extra: true,
      }),
    );
    expect(fields).toEqual(expect.arrayContaining(["document.capabilities.1", "document.allowedOrigins.0", "document.allowedOrigins.1", "document.allowedOrigins.2", "document.modes", "document"]));
    expect(fieldsOf(() => canonicalize(runtimeContractSchema, { ...runtimeContract, shared: [{ name: "react", version: "not a range", singleton: true }] }))).toEqual(["document.shared.0.version"]);
    expect(fieldsOf(() => canonicalize(runtimeContractSchema, { ...runtimeContract, exports: [{ name: "./Search", modes: [] }] }))).toEqual(["document.exports.0.modes"]);
    expect(fieldsOf(() => canonicalize(hostConfigurationSchema, { "1bad": "x", nested: { a: 1 } }))).toEqual(expect.arrayContaining(["document.1bad", "document.nested"]));
  });

  it("refuses launch locations that aren't credential-free https URLs, by rendering mode", () => {
    expect(fieldsOf(() => canonicalize(externalLaunchSchema, { mode: "iframe", documentUrl: "http://payments.example.com/app" }))).toEqual(["document.documentUrl"]);
    expect(fieldsOf(() => canonicalize(externalLaunchSchema, { mode: "esm", moduleUrl: "https://cdn.example.com/app.js#main" }))).toEqual(["document.moduleUrl", "document.exportedModule"]);
    expect(fieldsOf(() => canonicalize(externalLaunchSchema, { mode: "module_federation_2" }))).toEqual(["document.manifestUrl", "document.exposedModule"]);
    expect(fieldsOf(() => canonicalize(externalLaunchSchema, { mode: "module_federation_2", manifestUrl: "https://ci:token@cdn.example.com/mf-manifest.json", exposedModule: "./App" }))).toEqual(["document.manifestUrl"]);
    expect([urlProblem("https://cdn.example.com/@acme/app.js"), urlProblem("javascript:alert(1)"), urlProblem("https://a@b.example.com/"), urlProblem("not a url")]).toEqual([null, "scheme", "credentials", "malformed"]);
    expect(originOf("https://CDN.example.com:8443/app/")).toBe("https://cdn.example.com:8443");
  });

  it("refuses an oversized document, and lists longer than their limit", () => {
    const version = (index: number) => ({ name: `v${index}`, live: false, gitCommitHash: null, branch: null, buildNumber: null, repositoryUrl: `https://git.example.com/${"x".repeat(2000)}/${index}`, lastModified: null });
    expect(fieldsOf(() => canonicalize(cdaasViewProjection, { appId: "payments", viewId: "search", versions: Array.from({ length: 200 }, (_, index) => version(index)) }))).toEqual(["document"]);
    expect(fieldsOf(() => canonicalize(entitlementsSchema, { codes: Array.from({ length: 101 }, (_, index) => `CODE_${index}`), operator: "any" }))).toEqual(["document.codes"]);
    expect(canonicalize(studioModuleProjection, { uuid: "6f1d", title: "Payee search", appId: "payee", url: null, sealId: null, status: "Active", version: 3, typeLabels: ["MFE"] }).value.typeLabels).toEqual(["MFE"]);
  });
});
