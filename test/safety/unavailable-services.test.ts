import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import type { JsonObject } from "@repo-facts/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAssessment, targetsOf } from "@/lib/assessments/assessment-records";
import { launchAssessment } from "@/lib/assessments/launcher";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import type { MapDocument } from "@/lib/relationships/schema";
import { registerLocalSource, useAcquisitionWorld } from "../support/acquisition";
import { buildInitiative } from "../support/builders";
import { type Repo } from "../support/git-fixture";
import { manifest } from "../support/profiles";
import { NO_NETWORK_CALLS, NetworkTrap, countNetworkCalls } from "../support/traps";

/**
 * A repository whose every Service Dependency is unavailable: reserved
 * domains, a loopback trap, a configured endpoint that points at the trap, and
 * an endpoint computed at run time. Contracts and substitutes are committed for
 * one service and absent for the others, and the process environment holds a
 * credential and a proxy. The Assessment must complete and describe each
 * boundary from source alone, without resolving, connecting, loading a remote
 * schema, reading a credential, changing proxy settings, or writing a mock.
 */

const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "ALL_PROXY"];
const UNDICI_DISPATCHER = Symbol.for("undici.globalDispatcher.1");

describe("Assessment of unavailable Service Dependencies", () => {
  const world = useAcquisitionWorld("unavailable", { once: true });
  let trap: NetworkTrap;
  let work: Repo;
  let calls: typeof NO_NETWORK_CALLS;
  let assessmentId: string;
  let treeBefore: string[];
  let proxyState: () => unknown[];
  let proxyBefore: unknown[];
  let proxyAfter: unknown[];
  const markers = { environment: `ENV-TOKEN-${crypto.randomUUID()}`, dotenv: `DOTENV-${crypto.randomUUID()}` };
  const saved: Record<string, string | undefined> = {};

  const files = (trapUrl: string): Record<string, string> => ({
    "package.json": manifest({ name: "storefront", version: "1.0.0", dependencies: { axios: "^1.6.0", "https-proxy-agent": "^7.0.0" }, devDependencies: { msw: "^2.0.0" } }),
    // A reserved domain with an authentication header read from configuration, and no contract or substitute.
    "src/payments.ts": 'export async function charge(id: string) {\n  const res = await fetch("https://payments.invalid/v1/charges", { method: "POST", headers: { authorization: `Bearer ${process.env.PAYMENTS_TOKEN}` }, body: JSON.stringify({ id }) });\n  const body = await res.json();\n  return body.status;\n}\n',
    // A reserved domain with a committed contract, a committed substitute, and a timeout.
    "src/inventory.ts": 'import axios from "axios";\nconst client = axios.create({ baseURL: "https://inventory.example/v2", timeout: 3000 });\nexport async function items() {\n  const { data } = await client.get("/items");\n  return data.items;\n}\n',
    "contracts/inventory.openapi.yaml": `openapi: 3.0.0\ninfo: { title: Inventory, version: "2" }\nservers:\n  - url: https://inventory.example/v2\npaths:\n  /items:\n    get:\n      responses:\n        "200":\n          description: ok\n          content:\n            application/json:\n              schema:\n                $ref: "${trapUrl}/schemas/items.json"\n`,
    "test/inventory.test.ts": 'import { http, HttpResponse } from "msw";\nimport { setupServer } from "msw/node";\nexport const server = setupServer(http.get("https://inventory.example/v2/items", () => HttpResponse.json({ items: [] })));\n',
    // A destination read from the environment, which the test process points at the trap.
    "src/orders.ts": "export async function orders() {\n  const res = await fetch(`${process.env.ORDERS_URL}/orders`);\n  return (await res.json()).orders;\n}\n",
    // A literal loopback destination: the trap itself.
    "src/ledger.ts": `export const entries = () => fetch("${trapUrl}/ledger/entries");\n`,
    // A destination computed at run time.
    "src/dynamic.ts": "export async function call(base: string, path: string) {\n  return fetch(base + path);\n}\n",
    // Proxy routing through a variable.
    "src/agent.ts": 'import { HttpsProxyAgent } from "https-proxy-agent";\nexport const agent = new HttpsProxyAgent(process.env.HTTPS_PROXY ?? "");\n',
    ".env": `PAYMENTS_TOKEN=${markers.dotenv}\n`,
  });

  const listTree = (root: string): string[] => {
    const found: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === ".git") continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else found.push(path.relative(root, full));
      }
    };
    walk(root);
    return found.sort();
  };

  beforeAll(async () => {
    trap = await NetworkTrap.open();

    work = world.fixture.repo("fleet/storefront");
    for (const [file, content] of Object.entries(files(trap.url))) work.write(file, content);
    work.commit();
    treeBefore = listTree(work.path);
    const initiative = buildInitiative(world.db, { sources: [registerLocalSource(world.db, world.config, "storefront", work.path)] });

    // A credential, a configured destination, and a proxy in the environment, all pointing at the trap.
    for (const key of ["PAYMENTS_TOKEN", "ORDERS_URL", ...PROXY_KEYS]) saved[key] = process.env[key];
    process.env.PAYMENTS_TOKEN = markers.environment;
    process.env.ORDERS_URL = trap.url;
    process.env.HTTPS_PROXY = trap.url;
    proxyState = () => [...PROXY_KEYS.map((key) => process.env[key]), http.globalAgent, https.globalAgent, (globalThis as Record<symbol, unknown>)[UNDICI_DISPATCHER]];
    proxyBefore = proxyState();

    try {
      calls = await countNetworkCalls(async () => {
        assessmentId = launchAssessment(world.db, initiative.publicId, crypto.randomUUID(), world.config).assessment.publicId;
        await drainJobs(world.db, jobHandlers(world.db, world.config));
      });
      proxyAfter = proxyState();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 120_000);

  afterAll(async () => {
    await trap.close();
  });

  const facts = () => profileDocument(profilesOf(world.db, getAssessment(world.db, assessmentId).id)[0]!.profile).fact_document as JsonObject;
  const service = (key: string) => (facts().service_dependencies as JsonObject[]).find((item) => item.key === key)!;
  const fact = (key: string, name: string) => service(key)[name] as JsonObject;

  it("completes the Assessment: an unavailable service is not a source failure", () => {
    const assessment = getAssessment(world.db, assessmentId);
    expect(assessment.state).toBe("complete");
    expect(targetsOf(world.db, assessment.id)).toMatchObject([{ state: "complete", failureCode: null }]);
  });

  it("resolves no hostname, opens no socket, and loads no remote schema", () => {
    expect(calls).toEqual(NO_NETWORK_CALLS);
    expect(trap.connections).toEqual([]);
  });

  it("records a bounded dependency for every destination, with access unknown", () => {
    const keys = (facts().service_dependencies as JsonObject[]).map((item) => String(item.key)).sort();
    expect(keys).toEqual(["config:process.env:ORDERS_URL", "https://inventory.example", "https://payments.invalid", trap.url, "unresolved:src/dynamic.ts:2"].sort());
    for (const item of facts().service_dependencies as JsonObject[]) {
      expect(item.access).toEqual({ state: "unknown", reason: expect.stringContaining("no connectivity check is performed") });
      expect(Array.isArray(item.missing_evidence)).toBe(true);
      expect(typeof item.characterizable).toBe("boolean");
    }
  });

  it("describes a reserved-domain service with no contract or substitute from its call site alone", () => {
    expect(service("https://payments.invalid")).toMatchObject({ characterizable: true, missing_evidence: ["retry", "proxy"] });
    expect(fact("https://payments.invalid", "endpoint")).toMatchObject({ state: "observed", value: { derivation: "literal", origin: "https://payments.invalid" } });
    expect(fact("https://payments.invalid", "operations")).toMatchObject({ state: "observed", value: [{ method: "POST", path: "/v1/charges" }] });
    expect(fact("https://payments.invalid", "consumed_response_fields")).toMatchObject({ state: "observed", value: ["status"] });
    expect(fact("https://payments.invalid", "contracts")).toMatchObject({ state: "absent" });
    expect(fact("https://payments.invalid", "substitutes")).toMatchObject({ state: "absent" });
    // The authentication signal names where the token comes from, never its value.
    expect(fact("https://payments.invalid", "authentication")).toMatchObject({ state: "observed", value: [{ header: "authorization", value_source: { kind: "template", configured: [{ source: "process.env", key: "PAYMENTS_TOKEN" }] } }] });
  });

  it("ties a committed contract and substitute to their service without fetching the contract's remote references", () => {
    expect(service("https://inventory.example")).toMatchObject({ characterizable: true });
    expect(fact("https://inventory.example", "contracts")).toMatchObject({ state: expect.stringMatching(/^(observed|inferred)$/) });
    expect(JSON.stringify(fact("https://inventory.example", "contracts"))).toContain("contracts/inventory.openapi.yaml");
    expect(fact("https://inventory.example", "substitutes")).toMatchObject({ state: "observed" });
    expect(fact("https://inventory.example", "timeout")).toMatchObject({ state: "observed", value: { ms: 3000 } });
  });

  it("keeps configured and computed destinations symbolic, even when the environment would resolve them", () => {
    expect(fact("config:process.env:ORDERS_URL", "endpoint")).toMatchObject({ state: "observed", value: { derivation: "configured", source: "process.env", key: "ORDERS_URL" } });
    expect(JSON.stringify(service("config:process.env:ORDERS_URL"))).not.toContain(trap.url);
    expect(service("unresolved:src/dynamic.ts:2")).toMatchObject({ characterizable: false, missing_evidence: expect.arrayContaining(["endpoint", "operations"]) });
    expect(fact("unresolved:src/dynamic.ts:2", "endpoint")).toMatchObject({ state: "unknown", value: { derivation: "unknown", reason: "computed" } });
  });

  it("records proxy and credential signals by name, and never stores a credential value", () => {
    const categories = facts().categories as Record<string, JsonObject>;
    expect((categories.egress_routes!.facts as JsonObject[]).map((item) => item.key)).toContain("name:HTTPS_PROXY");
    expect((categories.access_signals!.facts as JsonObject[]).map((item) => item.key)).toEqual(expect.arrayContaining(["name:PAYMENTS_TOKEN", "file:.env"]));
    const stored = world.db.$client.serialize();
    for (const marker of Object.values(markers)) expect(stored.includes(Buffer.from(marker)), marker).toBe(false);
  });

  it("changes no proxy setting in the process", () => {
    expect(proxyAfter).toHaveLength(proxyBefore.length);
    for (const [index, value] of proxyAfter.entries()) expect(value).toBe(proxyBefore[index]);
  });

  it("generates no mock or substitute: the source tree and storage hold only what was committed and mirrored", () => {
    expect(listTree(work.path)).toEqual(treeBefore);
    expect(work.git("status", "--porcelain")).toBe("");
    const substitutes = (facts().categories as Record<string, JsonObject>).test_substitutes!.facts as JsonObject[];
    for (const item of substitutes) expect(treeBefore).toContain(String(item.key).split(":")[1]);
    // Storage holds bare mirrors only: Git's own files, no checked-out file and no hook.
    const stored = listTree(world.config.repositoryStorage);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.filter((file) => !/^src_[a-z0-9]+\.git\/(objects|refs|HEAD|config|packed-refs|description|info|shallow|lock)/.test(file))).toEqual([]);
    const committed = new Set(treeBefore.map((file) => path.basename(file)));
    expect(stored.filter((file) => committed.has(path.basename(file)) || file.includes("/hooks/"))).toEqual([]);
  });

  it("puts every destination in the Relationship Map without contacting it", () => {
    const map = mapDocument(mapOf(world.db, getAssessment(world.db, assessmentId).id)!) as unknown as MapDocument;
    const calls = map.edges.filter((edge) => edge.type === "service_call");
    expect(calls).toHaveLength(5);
    expect(calls.filter((edge) => edge.state === "unresolved").map((edge) => edge.reason)).toEqual(expect.arrayContaining(["The call's destination is not determined statically"]));
    expect(map.nodes.filter((node) => node.kind === "external_service").map((node) => (node as { key: string }).key)).toEqual(expect.arrayContaining(["https://payments.invalid", "https://inventory.example"]));
  });
});
