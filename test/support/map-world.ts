import crypto from "node:crypto";
import type { JsonObject, MemoryFile } from "@repo-facts/contract";
import { type Run } from "@/lib/runs/run-records";
import type { Repository } from "@/lib/repositories/repository-records";
import type { Db } from "@/lib/db/client";
import { buildAssessment, buildRepository } from "./builders";
import { manifest } from "./profiles";
import { seedRun } from "./scenarios";

/*
 * A Run built through the real profiling, resolution, and projection paths.
 * The access shell composes four applications by Module Federation and
 * reaches one of them a second way by an import map, so the five form one
 * runtime system; three of them share a design-tokens library built in the
 * Run; an orphan shell and its widget form a second runtime system; ledger,
 * scratch, and the library stand on their own.
 */

const federationHost = (name: string, remotes: Record<string, number>, extra: Record<string, MemoryFile> = {}) => ({
  "package.json": manifest({ name, version: "1.0.0", dependencies: { react: "^18.3.1" }, devDependencies: { webpack: "5.98.0" } }),
  "webpack.config.cjs": [
    'const { ModuleFederationPlugin } = require("webpack").container;',
    "module.exports = {",
    `  plugins: [new ModuleFederationPlugin({ name: "${name.replace(/-./g, (part) => part[1]!.toUpperCase())}", remotes: { ${Object.entries(remotes)
      .map(([remote, port]) => `${remote}: "${remote}@http://127.0.0.1:${port}/remoteEntry.js"`)
      .join(", ")} } })],`,
    "};",
    "",
  ].join("\n"),
  ...extra,
});

const federationRemote = (name: string, federationName: string, dependencies: Record<string, string> = {}) => ({
  "package.json": manifest({ name, version: "1.0.0", dependencies, devDependencies: { webpack: "5.98.0" } }),
  "webpack.config.cjs": `const { ModuleFederationPlugin } = require("webpack").container;\nmodule.exports = { plugins: [new ModuleFederationPlugin({ name: "${federationName}", filename: "remoteEntry.js", exposes: { "./App": "./src/App" } })] };\n`,
});

const tokens = { "@acme/design-tokens": "^1.0.0", react: "^18.3.1" };

const MAP_WORLD: Record<string, Record<string, MemoryFile>> = {
  "access-shell": federationHost(
    "access-shell",
    { fxBoard: 9101, rates: 9102, payeeHub: 9103, legacyTool: 9104 },
    { "src/index.html": '<script type="systemjs-importmap">\n{ "imports": { "fx-board": "http://127.0.0.1:9101/fx-board.js" } }\n</script>\n' },
  ),
  "fx-board": federationRemote("fx-board", "fxBoard", tokens),
  rates: federationRemote("rates", "rates", tokens),
  "payee-hub": federationRemote("payee-hub", "payeeHub", tokens),
  "design-tokens": { "package.json": manifest({ name: "@acme/design-tokens", version: "1.0.0" }) },
  ledger: { "package.json": manifest({ name: "ledger", version: "1.0.0", dependencies: { react: "^18.3.1" } }) },
  "legacy-tool": federationRemote("legacy-tool", "legacyTool"),
  "orphan-shell": federationHost("orphan-shell", { orphanWidget: 9201 }),
  "orphan-widget": federationRemote("orphan-widget", "orphanWidget"),
  scratch: { "package.json": manifest({ name: "scratch", version: "1.0.0" }) },
};

export interface MapWorld {
  run: Run;
  repositories: Record<string, Repository>;
}

export interface MapWorldOptions {
  /** Adds a resolved runtime contract from payee-hub to its host, which today's resolver can't match by origin. */
  runtimeContract?: boolean;
}

/** The map world's Run. */
export async function seedMapWorld(db: Db, options: MapWorldOptions = {}): Promise<MapWorld> {
  const names = Object.keys(MAP_WORLD);
  const repositories = Object.fromEntries(names.map((name) => [name, buildRepository(db, { name })]));
  const assessment = buildAssessment(db, { name: "Fleet assessment", repositories: Object.values(repositories) });
  const run = await seedRun(db, assessment, Object.values(repositories), names.map((name) => MAP_WORLD[name]!), options.runtimeContract ? { transformMap: addRuntimeContract } : {});
  return { run, repositories };
}

/** A resolved runtime contract from payee-hub to access-shell, citing payee-hub's own evidence. */
function addRuntimeContract(document: JsonObject): JsonObject {
  const nodes = document.nodes as { id: string; kind: string; source?: { name: string } }[];
  const edges = document.edges as JsonObject[];
  const node = (name: string) => nodes.find((item) => item.kind === "repository" && item.source?.name === name)!.id;
  const evidence = (edges.find((edge) => edge.from === node("payee-hub"))!.evidence as string[]).slice(0, 1);
  const contract = {
    id: `edge_${crypto.createHash("sha256").update("contract:payee-hub").digest("hex").slice(0, 24)}`,
    type: "runtime_contract",
    from: node("payee-hub"),
    to: node("access-shell"),
    state: "resolved",
    candidates: [],
    reference: { type: "runtime_contract", role: "sender", identifier: { contract: "postMessage", origin: "http://127.0.0.1:9100" } },
    rule: "runtime-contract.served-origin",
    basis: "observed",
    reason: null,
    evidence,
    details: {},
  };
  return { ...document, edges: [...edges, contract].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)) };
}
