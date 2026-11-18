import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Assessment, getAssessment, snapshotOf, targetsOf } from "@/lib/assessments/assessment-records";
import { launchAssessment } from "@/lib/assessments/launcher";
import { requestCancellation } from "@/lib/assessments/transitions";
import { addRepositories } from "@/lib/catalog/bulk-add";
import { SourceBoundary } from "@/lib/catalog/source-boundary";
import { type RepositorySource, listSources } from "@/lib/catalog/source-records";
import type { FabricateConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { type Initiative, createInitiative } from "@/lib/initiatives/initiative-records";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import type { MapDocument } from "@/lib/relationships/schema";
import { acquisitionConfig } from "../support/acquisition";
import { createTestDb } from "../support/db";
import { GitFixture, type Repo } from "../support/git-fixture";
import { manifest } from "../support/profiles";
import { GitLog, NO_NETWORK_CALLS, NetworkTrap, countNetworkCalls } from "../support/traps";

/**
 * A temporary fleet assessed end to end: directory import into the catalog,
 * all-Repositories and explicit Initiatives, one source that becomes unavailable,
 * Service Dependencies, commits pinned at launch, identical reruns, and a
 * canceled run. Every job runs through the real handlers while the network
 * is trapped and every Git command is logged, so the scenario can show it
 * never reads outside its temporary allowed root or contacts a service.
 */

describe("Multi-repository Assessment scenario", () => {
  let fixture: GitFixture;
  let config: FabricateConfig;
  let db: Db;
  let trap: NetworkTrap;
  let gitLog: GitLog;
  let fleet: string;
  let outside: string;
  const repos: Record<string, Repo> = {};
  const networkCalls: (typeof NO_NETWORK_CALLS)[] = [];
  const savedOrdersUrl = process.env.ORDERS_URL;
  let sources: Record<string, RepositorySource>;
  let wholeFleet: Initiative;
  let explicit: Initiative;

  /** Runs every queued job, optionally only +limit+ of them, with the network trapped and Git logged. */
  const run = (limit?: number) =>
    gitLog.during(async () => {
      const calls = await countNetworkCalls(async () => {
        await drainJobs(db, jobHandlers(db, config), limit ? { limit } : {});
      });
      networkCalls.push(calls);
    });
  const launch = (initiative: Initiative) => launchAssessment(db, initiative.publicId, crypto.randomUUID(), config).assessment;
  const refreshed = (assessment: Assessment) => getAssessment(db, assessment.publicId);
  const states = (assessment: Assessment) => Object.fromEntries(targetsOf(db, assessment.id).map((target) => [target.sourceName, target.state]));
  const shas = (assessment: Assessment) => Object.fromEntries(targetsOf(db, assessment.id).map((target) => [target.sourceName, snapshotOf(db, target.id)?.commitSha ?? null]));
  const profiles = (assessment: Assessment) => Object.fromEntries(profilesOf(db, assessment.id).map(({ profile, target }) => [target.sourceName, profile]));
  const map = (assessment: Assessment) => mapDocument(mapOf(db, assessment.id)!) as unknown as MapDocument;
  /** A map without its per-run target identifiers, which are the only run identity it records. */
  const withoutTargets = (value: JsonValue): JsonValue => (Array.isArray(value) ? value.map(withoutTargets) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "target").map(([key, item]) => [key, withoutTargets(item)])) : value);

  beforeAll(async () => {
    fixture = GitFixture.create("fleet-scenario");
    config = acquisitionConfig(fixture);
    db = createTestDb();
    trap = await NetworkTrap.open();
    gitLog = new GitLog(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fleet-scenario-git-"))));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "outside-fleet-")));
    fleet = fixture.dir("fleet");
    // The web repository's configured destination resolves to the trap if anything ever dereferences it.
    process.env.ORDERS_URL = trap.url;

    const trees: Record<string, Record<string, string>> = {
      web: {
        "package.json": manifest({ name: "web", version: "1.0.0", private: true, dependencies: { "@acme/ui": "^2.0.0", "@acme/client": "^1.0.0" } }),
        "src/payments.ts": 'export const charge = (id: string) => fetch("https://payments.invalid/v1/charges", { method: "POST", body: JSON.stringify({ id }) }).then((res) => res.json()).then((body) => body.status);\n',
        "src/orders.ts": "export const orders = () => fetch(`${process.env.ORDERS_URL}/orders`).then((res) => res.json()).then((body) => body.orders);\n",
      },
      ui: { "package.json": manifest({ name: "@acme/ui", version: "2.1.0" }) },
      client: { "package.json": manifest({ name: "@acme/client", version: "1.4.0" }), "src/index.ts": `export const ledger = () => fetch("${trap.url}/ledger");\n` },
      billing: { "package.json": manifest({ name: "billing", version: "3.0.0" }) },
      archive: { "package.json": manifest({ name: "archive", version: "0.1.0" }) },
    };
    for (const [name, files] of Object.entries(trees)) {
      repos[name] = fixture.repo(`fleet/${name}`);
      for (const [file, content] of Object.entries(files)) repos[name]!.write(file, content);
      repos[name]!.commit();
    }
    // A repository outside the allowed root, and a link to it from inside.
    fs.writeFileSync(path.join(outside, "README.md"), "outside\n");
    fs.symlinkSync(outside, path.join(fleet, "zz-outside-link"));
  }, 60_000);

  afterAll(async () => {
    if (savedOrdersUrl === undefined) delete process.env.ORDERS_URL;
    else process.env.ORDERS_URL = savedOrdersUrl;
    await trap.close();
    fixture.cleanup();
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(config.repositoryStorage, { recursive: true, force: true });
  });

  it("adds the fleet's repositories in bulk, refusing what is outside the allowed root", () => {
    const boundary = new SourceBoundary(config);
    // The archive stays out of the catalog, so the whole-fleet Assessment never sees it.
    const urls = ["billing", "client", "ui", "web", "zz-outside-link"].map((name) => `file://${fleet}/${name}`);
    const result = addRepositories(db, [...urls, `file://${outside}`].join("\n"), boundary);
    expect(result.failed.map((failure) => failure.line)).toEqual([5, 6]);
    sources = Object.fromEntries(listSources(db).map((source) => [source.name, source]));
    expect(Object.keys(sources).sort()).toEqual(["billing", "client", "ui", "web"]);
    for (const source of Object.values(sources)) expect(source.cloneUrl.startsWith(`file://${fleet}/`)).toBe(true);

    wholeFleet = createInitiative(db, { name: "Whole fleet", objective: "Current state of every repository", selectionMode: "all" });
    explicit = createInitiative(db, { name: "Shared packages", objective: "The UI and client packages", selectionMode: "explicit", sourcePublicIds: [sources.ui!.publicId, sources.client!.publicId] });
  });

  let first: Assessment;

  it("assesses every source independently when one becomes unavailable", async () => {
    fs.rmSync(path.join(fleet, "billing"), { recursive: true, force: true });
    first = launch(wholeFleet);
    await run();

    first = refreshed(first);
    expect(first.state).toBe("complete_with_issues");
    expect(states(first)).toEqual({ billing: "failed", client: "complete", ui: "complete", web: "complete" });
    expect(targetsOf(db, first.id).find((target) => target.sourceName === "billing")).toMatchObject({ failureCode: "source_unavailable" });
    expect(Object.keys(profiles(first)).sort()).toEqual(["client", "ui", "web"]);
  });

  it("records Service Dependencies and resolves relationships, with the unavailable source as a coverage gap", () => {
    const web = profileDocument(profiles(first).web!).fact_document as JsonObject;
    const keys = (web.service_dependencies as JsonObject[]).map((service) => service.key).sort();
    expect(keys).toEqual(["config:process.env:ORDERS_URL", "https://payments.invalid"]);
    for (const service of web.service_dependencies as JsonObject[]) expect(service.access).toMatchObject({ state: "unknown" });

    const relationships = map(first);
    expect(relationships.coverage).toMatchObject({ complete: false, gaps: [expect.objectContaining({ source: expect.objectContaining({ name: "billing" }), reason: "source_unavailable" })] });
    const byName = new Map(relationships.nodes.map((node) => [node.id, node]));
    const dependencies = relationships.edges.filter((edge) => edge.type === "package_dependency").map((edge) => [(byName.get(edge.from) as { source: { name: string } }).source.name, edge.state, edge.to && (byName.get(edge.to) as { source?: { name: string } }).source?.name]);
    expect(dependencies.sort()).toEqual([
      ["web", "resolved", "client"],
      ["web", "resolved", "ui"],
    ]);
    expect(relationships.edges.filter((edge) => edge.type === "service_call")).toHaveLength(3);
  });

  it("pins every commit at launch: a later commit changes only later Assessments", async () => {
    const pinned = shas(first);
    const digests = Object.fromEntries(Object.entries(profiles(first)).map(([name, profile]) => [name, profile.digest]));
    repos.web!.write("src/inventory.ts", 'export const items = () => fetch("https://inventory.example/items").then((res) => res.json()).then((body) => body.items);\n').commit("Call inventory");

    const second = launch(wholeFleet);
    await run();
    expect(shas(second).web).toBe(repos.web!.head());
    expect(shas(second).web).not.toBe(pinned.web);
    expect(shas(second).ui).toBe(pinned.ui);

    expect(shas(refreshed(first))).toEqual(pinned);
    expect(Object.fromEntries(Object.entries(profiles(first)).map(([name, profile]) => [name, profile.digest]))).toEqual(digests);
    expect(profileDocument(profiles(first).web!).commit).toBe(pinned.web);
    expect(((profileDocument(profiles(second).web!).fact_document as JsonObject).service_dependencies as JsonObject[]).map((service) => service.key)).toContain("https://inventory.example");
  });

  it("produces identical Profiles and relationships when unchanged repositories are assessed again", async () => {
    const [one, two] = [launch(explicit), launch(explicit)];
    await run();
    expect(refreshed(one).state).toBe("complete");
    expect(refreshed(two).state).toBe("complete");
    expect(Object.fromEntries(Object.entries(profiles(two)).map(([name, profile]) => [name, profile.digest]))).toEqual(Object.fromEntries(Object.entries(profiles(one)).map(([name, profile]) => [name, profile.digest])));
    expect(withoutTargets(map(two) as unknown as JsonValue)).toEqual(withoutTargets(map(one) as unknown as JsonValue));
    // The explicit Initiative keeps its own scope: the other sources are not in it.
    expect(Object.keys(states(two)).sort()).toEqual(["client", "ui"]);
  });

  it("cancels a running Assessment, keeping the Profile that finished", async () => {
    const assessment = launch(explicit);
    await run(2); // the coordinator, then the first target
    requestCancellation(db, assessment.id);
    await run();

    const done = refreshed(assessment);
    expect(done.state).toBe("canceled");
    expect(Object.values(states(done)).sort()).toEqual(["canceled", "complete"]);
    expect(Object.keys(profiles(done))).toHaveLength(1);
  });

  it("never reads outside the allowed root or contacts a discovered service", () => {
    expect(networkCalls.length).toBeGreaterThanOrEqual(4);
    for (const calls of networkCalls) expect(calls).toEqual(NO_NETWORK_CALLS);
    expect(trap.connections).toEqual([]);

    const calls = gitLog.calls();
    expect(calls.length).toBeGreaterThan(0);
    const paths = calls.flatMap((argv) => argv.flatMap((arg) => [...arg.matchAll(/(?:file:\/\/|--git-dir=|^)(\/[^\s]+)/g)].map((match) => match[1]!)));
    expect(paths.length).toBeGreaterThan(0);
    const allowed = [fixture.root, config.repositoryStorage, "/dev/null"];
    expect(paths.filter((file) => !allowed.some((root) => file === root || file.startsWith(`${root}/`)))).toEqual([]);
    expect(paths.some((file) => file.startsWith(outside))).toBe(false);
  });
});
