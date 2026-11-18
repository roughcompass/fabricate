import dns from "node:dns";
import net from "node:net";
import type { JsonObject } from "@repo-facts/contract";
import { describe, expect, it, vi } from "vitest";
import { type CatalogIdentity, type ResolverTarget, resolveRelationships } from "@/lib/relationships/resolve";
import { type MapDocument, type MapEdge, mapProblems } from "@/lib/relationships/schema";
import { contributed, manifest, missing } from "../support/profiles";

function resolved(targets: ResolverTarget[], outOfScope: CatalogIdentity[] = []) {
  const document = resolveRelationships({ targets, outOfScope });
  expect(mapProblems(document)).toEqual([]);
  return document as unknown as MapDocument;
}

/** Readable edges: `from -type/state-> to`, with ambiguous candidates in brackets. */
function view(map: MapDocument, filter: (edge: MapEdge) => boolean = () => true): string[] {
  const label = (id: string | null) => {
    const node = map.nodes.find((item) => item.id === id);
    if (!node) return String(id);
    switch (node.kind) {
      case "repository":
        return node.source.name;
      case "package":
        return `package:${node.name}`;
      case "external_service":
        return `service:${node.key}${node.scope ? `@${node.scope}` : ""}`;
      case "out_of_scope_source":
        return `catalog:${node.source.name}`;
      case "unresolved_endpoint":
        return `unresolved:${node.reference.type}`;
    }
  };
  return map.edges
    .filter(filter)
    .map((edge) => `${label(edge.from)} -${edge.type}/${edge.state}-> ${edge.to ? label(edge.to) : `[${edge.candidates.map(label).sort().join(", ")}]`}`)
    .sort();
}

const edgeFor = (map: MapDocument, type: string, identifier: Record<string, string>) => map.edges.find((edge) => edge.type === type && JSON.stringify(edge.reference.identifier) === JSON.stringify(identifier))!;
const evidencePaths = (map: MapDocument, edge: MapEdge) => edge.evidence.map((id) => `${String(map.evidence[id]!.commit).slice(0, 7)}:${String(map.evidence[id]!.path)}`).sort();

const ui = () => contributed("ui", { "package.json": manifest({ name: "@acme/ui", version: "1.0.0" }) });
const app = () => contributed("app", { "package.json": manifest({ name: "orders-app", version: "1.0.0", dependencies: { "@acme/ui": "^1.0.0", "@acme/ui-kit": "^2.0.0", react: "18.3.1" } }) });

describe("package relationships", () => {
  it("connects a consumer to the one repository that produces the exact package name, with both declarations as evidence", async () => {
    const map = resolved([await ui(), await app()]);
    const packages = view(map, (edge) => edge.type.startsWith("package"));

    expect(packages).toEqual([
      "app -package_dependency/resolved-> ui",
      "app -package_dependency/unresolved-> package:@acme/ui-kit",
      "app -package_dependency/unresolved-> package:react",
      "app -package_production/resolved-> package:orders-app",
      "ui -package_production/resolved-> package:@acme/ui",
    ]);
    const dependency = edgeFor(map, "package_dependency", { name: "@acme/ui" });
    expect(dependency).toMatchObject({ rule: "package.exact-name", basis: "observed", reason: null, details: { package: "@acme/ui" } });
    // The consumer's declaration and the producer's, from each repository's own commit.
    const paths = evidencePaths(map, dependency);
    expect(paths.some((path) => path.endsWith(":package.json") && path.startsWith(String(map.nodes.find((node) => node.kind === "repository" && node.source.name === "app")!["commit" as never]).slice(0, 7)))).toBe(true);
    expect(new Set(dependency.evidence.map((id) => map.evidence[id]!.commit)).size).toBe(2);
  });

  it("marks a package produced by more than one repository ambiguous and lists every candidate", async () => {
    const other = await contributed("ui-fork", { "package.json": manifest({ name: "@acme/ui", version: "1.1.0" }) });
    const map = resolved([await ui(), other, await app()]);

    expect(view(map, (edge) => edge.reference.identifier.name === "@acme/ui" && edge.type === "package_dependency")).toEqual(["app -package_dependency/ambiguous-> [ui, ui-fork]"]);
    expect(edgeFor(map, "package_dependency", { name: "@acme/ui" }).reason).toBe("2 repositories in this Run declare a package named @acme/ui");
  });

  it("resolves consumers of a workspace package to the repository that contains it, which uses the package internally", async () => {
    const monorepo = await contributed("monorepo", {
      "package.json": manifest({ name: "orders-monorepo", private: true, workspaces: ["packages/*"] }),
      "packages/api/package.json": manifest({ name: "@acme/api", version: "1.0.0" }),
      "packages/web/package.json": manifest({ name: "@acme/web", version: "1.0.0", dependencies: { "@acme/api": "1.0.0" } }),
    });
    const client = await contributed("client", { "package.json": manifest({ name: "api-client", version: "1.0.0", dependencies: { "@acme/api": "^1.0.0" } }) });
    const map = resolved([monorepo, client]);

    expect(view(map, (edge) => edge.type === "package_dependency" && edge.reference.identifier.name === "@acme/api")).toEqual(["client -package_dependency/resolved-> monorepo"]);
    expect(view(map, (edge) => edge.type === "package_production")).toEqual([
      "client -package_production/resolved-> package:api-client",
      "monorepo -package_production/resolved-> package:@acme/api",
      "monorepo -package_production/resolved-> package:@acme/web",
    ]);
    // orders-monorepo is private, so it's never published and no other repository can depend on it.
    // The monorepo's own use of @acme/api is an internal fact in its Profile, not a relationship.
    const consumed = (monorepo.profile!.document.fact_document as { categories: { packages_consumed: { facts: { key: string; value: { internal: boolean } }[] } } }).categories.packages_consumed.facts;
    expect(consumed.find((fact) => fact.key === "@acme/api")?.value.internal).toBe(true);
  });

  it("matches package names exactly", async () => {
    const kit = await contributed("kit", { "package.json": manifest({ name: "@acme/ui-kit-next", version: "1.0.0" }) });
    const map = resolved([kit, await app()]);

    expect(view(map, (edge) => edge.type === "package_dependency" && String(edge.reference.identifier.name).startsWith("@acme/ui"))).toEqual([
      "app -package_dependency/unresolved-> package:@acme/ui",
      "app -package_dependency/unresolved-> package:@acme/ui-kit",
    ]);
  });
});

describe("composition, iframe, and runtime-contract relationships", () => {
  const shell = () =>
    contributed("shell", {
      "package.json": manifest({ name: "mf-shell", version: "1.0.0", devDependencies: { webpack: "5.98.0" } }),
      "webpack.config.cjs": [
        'const { ModuleFederationPlugin } = require("webpack").container;',
        "module.exports = {",
        '  plugins: [new ModuleFederationPlugin({ name: "mfShell", remotes: { mfAdmin: "mfAdmin@http://127.0.0.1:9101/remoteEntry.js", mfBilling: "mfBilling@http://127.0.0.1:9102/remoteEntry.js" } })],',
        "};",
        "",
      ].join("\n"),
      "src/App.tsx": 'export const Legacy = () => <iframe src="http://127.0.0.1:9103" title="Legacy" />;\n',
    });
  const remote = (name: string, federationName: string) =>
    contributed(name, {
      "package.json": manifest({ name, version: "1.0.0", devDependencies: { webpack: "5.98.0" } }),
      "webpack.config.cjs": `const { ModuleFederationPlugin } = require("webpack").container;\nmodule.exports = { plugins: [new ModuleFederationPlugin({ name: "${federationName}", filename: "remoteEntry.js", exposes: { "./App": "./src/App" } })] };\n`,
    });

  it("resolves a Module Federation host to the remote that declares the name, directionally, with both configurations as evidence", async () => {
    const map = resolved([await shell(), await remote("admin", "mfAdmin")]);
    const edge = edgeFor(map, "composition", { mechanism: "module-federation", name: "mfAdmin" });

    expect(view(map, (item) => item.type === "composition")).toEqual(["shell -composition/resolved-> admin", "shell -composition/unresolved-> unresolved:composition"]);
    expect(edge).toMatchObject({ rule: "composition.federation-name", details: { mechanism: "module-federation", name: "mfAdmin", url: "http://127.0.0.1:9101/remoteEntry.js" } });
    expect(new Set(edge.evidence.map((id) => map.evidence[id]!.path))).toEqual(new Set(["webpack.config.cjs"]));
    expect(new Set(edge.evidence.map((id) => map.evidence[id]!.commit)).size).toBe(2);
    expect(edgeFor(map, "composition", { mechanism: "module-federation", name: "mfBilling" }).reason).toMatch(/No repository in this Run declares a Module Federation remote named mfBilling, and its URL cannot be matched/);
  });

  it("marks a federation name declared by two remotes ambiguous", async () => {
    const map = resolved([await shell(), await remote("admin", "mfAdmin"), await remote("admin-next", "mfAdmin")]);
    expect(view(map, (edge) => edge.reference.identifier.name === "mfAdmin")).toEqual(["shell -composition/ambiguous-> [admin, admin-next]"]);
  });

  it("resolves import-map and single-spa hosts to the application that produces the named package", async () => {
    const root = await contributed("root", {
      "package.json": manifest({ name: "spa-root", version: "1.0.0", dependencies: { "single-spa": "6.0.3" } }),
      "src/index.html": '<script type="systemjs-importmap">\n{ "imports": { "spa-orders": "http://127.0.0.1:9001/spa-orders.js" } }\n</script>\n',
      "src/root-config.ts": 'import { registerApplication, start } from "single-spa";\nregisterApplication({ name: "spa-orders", app: () => System.import("spa-orders"), activeWhen: ["/orders"] });\nstart();\n',
    });
    const orders = await contributed("orders", { "package.json": manifest({ name: "spa-orders", version: "1.0.0" }) });
    const map = resolved([root, orders]);

    expect(view(map, (edge) => edge.type === "composition")).toEqual(["root -composition/resolved-> orders", "root -composition/resolved-> orders"]);
    expect(edgeFor(map, "composition", { mechanism: "import-map", specifier: "spa-orders" })).toMatchObject({ rule: "composition.import-map-specifier", details: { url: "http://127.0.0.1:9001/spa-orders.js" } });
    expect(edgeFor(map, "composition", { application: "spa-orders", mechanism: "single-spa" })).toMatchObject({ rule: "composition.single-spa-application", details: { url: "http://127.0.0.1:9001/spa-orders.js" } });
  });

  it("keeps iframes and runtime contracts unresolved, directionally, because no Profile records served origins", async () => {
    const portal = await contributed("portal", {
      "package.json": manifest({ name: "legacy-portal", version: "1.0.0" }),
      "src/runtime.js": 'const SHELL_ORIGIN = "http://127.0.0.1:9100";\nexport function send(type) {\n  window.parent.postMessage({ type }, SHELL_ORIGIN);\n}\n',
    });
    const map = resolved([await shell(), portal]);

    expect(view(map, (edge) => edge.type === "iframe" || edge.type === "runtime_contract")).toEqual(["portal -runtime_contract/unresolved-> unresolved:runtime_contract", "shell -iframe/unresolved-> unresolved:iframe"]);
    expect(edgeFor(map, "iframe", { url: "http://127.0.0.1:9103" })).toMatchObject({ rule: "iframe.served-origin", reason: expect.stringContaining("served from"), evidence: [expect.any(String)] });
    expect(edgeFor(map, "runtime_contract", { contract: "postMessage", origin: "http://127.0.0.1:9100" })).toMatchObject({ rule: "runtime-contract.served-origin" });
  });
});

describe("external-service relationships", () => {
  it("creates one node for a literal origin called from several repositories, with an edge and evidence for each", async () => {
    const a = await contributed("a", { "src/api.ts": 'export const orders = () => fetch("https://api.example.test/orders");\n' });
    const b = await contributed("b", { "src/api.ts": 'export const invoices = () => fetch("https://api.example.test/invoices");\n' });
    const map = resolved([a, b]);
    const services = map.nodes.filter((node) => node.kind === "external_service");

    expect(services).toEqual([expect.objectContaining({ key: "https://api.example.test", identity: { kind: "origin", value: "https://api.example.test" }, scope: null })]);
    expect(view(map, (edge) => edge.type === "service_call")).toEqual(["a -service_call/resolved-> service:https://api.example.test", "b -service_call/resolved-> service:https://api.example.test"]);
    for (const edge of map.edges.filter((item) => item.type === "service_call")) {
      expect(edge).toMatchObject({ rule: "service.literal-origin", details: { access: { state: "unknown" }, endpoint: { state: "observed" } } });
      expect(edge.evidence.map((id) => map.evidence[id]!.path)).toEqual(["src/api.ts"]);
    }
  });

  it("keeps dynamic destinations unresolved and never merges same-origin or host-provided services across repositories", async () => {
    const a = await contributed("a", { "src/api.ts": 'export const load = (name: string) => fetch(buildUrl(name));\nexport const me = () => fetch("/api/me");\n' });
    const b = await contributed("b", { "src/api.ts": 'export const me = () => fetch("/api/me");\n' });
    const map = resolved([a, b]);

    expect(view(map, (edge) => edge.type === "service_call")).toEqual([
      "a -service_call/resolved-> service:same-origin:/api@src_a",
      "a -service_call/unresolved-> unresolved:service",
      "b -service_call/resolved-> service:same-origin:/api@src_b",
    ]);
    expect(map.edges.find((edge) => edge.state === "unresolved" && edge.type === "service_call")).toMatchObject({ rule: "service.dynamic-destination", reason: "The call's destination is not determined statically" });
    expect(map.edges.filter((edge) => edge.rule === "service.same-origin").every((edge) => edge.basis === "inferred")).toBe(true);
  });

  it("identifies a configured service by the origin of its tied contract, merging it with literal callers", async () => {
    const configured = await contributed("configured", {
      "openapi.yaml": "openapi: 3.1.0\ninfo: { title: Orders, version: '1' }\nservers:\n  - url: https://api.example.test\npaths:\n  /orders:\n    get: {}\n",
      "src/api.ts": "export const orders = () => fetch(`${import.meta.env.VITE_ORDERS_API}/orders`);\n",
    });
    const literal = await contributed("literal", { "src/api.ts": 'export const orders = () => fetch("https://api.example.test/orders");\n' });
    const map = resolved([configured, literal]);

    expect(view(map, (edge) => edge.type === "service_call")).toEqual(["configured -service_call/resolved-> service:https://api.example.test", "literal -service_call/resolved-> service:https://api.example.test"]);
    const edge = map.edges.find((item) => item.rule === "service.contract-origin")!;
    expect(edge).toMatchObject({ basis: "inferred", details: { contract_origins: ["https://api.example.test"], key: "config:import.meta.env:VITE_ORDERS_API" } });
    expect(edge.evidence.map((id) => map.evidence[id]!.path).sort()).toEqual(["openapi.yaml", "src/api.ts"]);
  });

  it("leaves a service ambiguous when its contract names several origins", async () => {
    const configured = await contributed("configured", {
      "openapi.yaml": "openapi: 3.1.0\ninfo: { title: Orders, version: '1' }\nservers:\n  - url: https://api.example.test\n  - url: https://staging.example.test\npaths:\n  /orders:\n    get: {}\n",
      "src/api.ts": "export const orders = () => fetch(`${import.meta.env.VITE_ORDERS_API}/orders`);\n",
    });
    const map = resolved([configured]);
    expect(view(map, (edge) => edge.type === "service_call")).toEqual(["configured -service_call/ambiguous-> [service:https://api.example.test, service:https://staging.example.test]"]);
  });

  it("identifies services by shared configuration key and by packaged client", async () => {
    const a = await contributed("a", { "src/api.ts": "export const a = () => fetch(`${import.meta.env.VITE_CATALOG}/items`);\n", "src/analytics.ts": 'import { init } from "@acme/analytics";\ninit({ endpoint: "/__analytics" });\n' });
    const b = await contributed("b", { "src/api.ts": "export const b = () => fetch(`${import.meta.env.VITE_CATALOG}/items/1`);\n", "src/analytics.ts": 'import { init } from "@acme/analytics";\ninit({ endpoint: "/__analytics" });\n' });
    const map = resolved([a, b]);

    expect(view(map, (edge) => edge.type === "service_call")).toEqual([
      "a -service_call/resolved-> service:config:import.meta.env:VITE_CATALOG",
      "a -service_call/resolved-> service:package:@acme/analytics",
      "b -service_call/resolved-> service:config:import.meta.env:VITE_CATALOG",
      "b -service_call/resolved-> service:package:@acme/analytics",
    ]);
    expect(map.edges.find((edge) => edge.rule === "service.packaged-client")?.basis).toBe("inferred");
  });

  it("performs no DNS or network work while resolving", async () => {
    const targets = [await contributed("a", { "src/api.ts": 'export const orders = () => fetch("https://unreachable.invalid/orders");\n' })];
    const lookups = [vi.spyOn(dns, "lookup"), vi.spyOn(net, "connect"), vi.spyOn(globalThis, "fetch")];
    try {
      resolved(targets);
      for (const spy of lookups) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of lookups) spy.mockRestore();
    }
  });
});

describe("out-of-scope sources and coverage", () => {
  const catalog: CatalogIdentity[] = [{ public_id: "src_catalog_ui", name: "@acme/ui", canonical_url: "https://git.example.com/acme/ui" }];

  it("labels an unmatched package with a catalog source outside the scope, by name or declared Git URL, without analyzing it", async () => {
    const byName = resolved([await app()], catalog);
    expect(view(byName, (edge) => edge.reference.identifier.name === "@acme/ui")).toEqual(["app -package_dependency/out_of_scope-> catalog:@acme/ui"]);
    expect(edgeFor(byName, "package_dependency", { name: "@acme/ui" })).toMatchObject({ rule: "catalog.name", basis: "inferred", reason: expect.stringContaining("was not analyzed") });

    const gitApp = await contributed("git-app", { "package.json": manifest({ name: "git-app", version: "1.0.0", dependencies: { "ui-lib": "git+https://git.example.com/acme/ui.git#v1" } }) });
    const byUrl = resolved([gitApp], catalog);
    expect(edgeFor(byUrl, "package_dependency", { name: "ui-lib" })).toMatchObject({ state: "out_of_scope", rule: "catalog.canonical-url", basis: "observed" });
    // Only identity metadata is recorded for the out-of-scope source.
    expect(byUrl.nodes.find((node) => node.kind === "out_of_scope_source")).toEqual({ id: expect.any(String), kind: "out_of_scope_source", source: catalog[0] });
  });

  it("records failed and canceled targets as coverage gaps and keeps edges from the successful Profiles", async () => {
    const map = resolved([await ui(), await app(), missing("billing", "failed"), missing("reports", "canceled")]);

    expect(map.coverage).toEqual({
      complete: false,
      contributors: expect.arrayContaining([expect.any(String)]),
      gaps: [
        { target: "tgt_billing", source: { public_id: "src_billing", name: "billing" }, state: "failed", reason: "remote_unavailable" },
        { target: "tgt_reports", source: { public_id: "src_reports", name: "reports" }, state: "canceled", reason: null },
      ],
    });
    expect(map.coverage.contributors).toHaveLength(2);
    expect(map.nodes.filter((node) => node.kind === "repository").map((node) => (node as { source: { name: string } }).source.name).sort()).toEqual(["app", "ui"]);
    expect(view(map, (edge) => edge.reference.identifier.name === "@acme/ui" && edge.type === "package_dependency")).toEqual(["app -package_dependency/resolved-> ui"]);
  });
});

describe("determinism", () => {
  it("produces the same map regardless of target order", async () => {
    const targets = [await ui(), await app(), missing("billing", "failed")];
    const forward = resolveRelationships({ targets, outOfScope: [] });
    const reversed = resolveRelationships({ targets: [...targets].reverse(), outOfScope: [] });
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect((forward as JsonObject).resolver_version).toBe("1");
  });
});
