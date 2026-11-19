import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Run, getRun, targetsOf } from "@/lib/runs/run-records";
import { launchRun } from "@/lib/runs/launcher";
import { requestCancellation } from "@/lib/runs/transitions";
import { addRepositories } from "@/lib/catalog/bulk-add";
import { SourceBoundary } from "@/lib/catalog/source-boundary";
import { type RepositorySource, listSources } from "@/lib/catalog/source-records";
import { type Assessment, createAssessment } from "@/lib/assessments/assessment-records";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import type { MapDocument } from "@/lib/relationships/schema";
import { targetCommits } from "@/lib/surveys/records";
import { useAcquisitionWorld } from "../support/acquisition";
import { type Repo } from "../support/git-fixture";
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
  const world = useAcquisitionWorld("fleet-scenario", { once: true });
  let trap: NetworkTrap;
  let gitLog: GitLog;
  let fleet: string;
  let outside: string;
  const repos: Record<string, Repo> = {};
  const networkCalls: (typeof NO_NETWORK_CALLS)[] = [];
  const savedOrdersUrl = process.env.ORDERS_URL;
  let sources: Record<string, RepositorySource>;
  let wholeFleet: Assessment;
  let explicit: Assessment;

  /** Runs every queued job, optionally only +limit+ of them, with the network trapped and Git logged. */
  const drain = (limit?: number) =>
    gitLog.during(async () => {
      const calls = await countNetworkCalls(async () => {
        await drainJobs(world.db, jobHandlers(world.db, world.config), limit ? { limit } : {});
      });
      networkCalls.push(calls);
    });
  const launch = (assessment: Assessment) => launchRun(world.db, assessment.publicId, crypto.randomUUID(), world.config).run;
  const refreshed = (run: Run) => getRun(world.db, run.publicId);
  const states = (run: Run) => Object.fromEntries(targetsOf(world.db, run.id).map((target) => [target.sourceName, target.state]));
  const shas = (run: Run) => {
    const commits = targetCommits(world.db, run.id);
    return Object.fromEntries(targetsOf(world.db, run.id).map((target) => [target.sourceName, commits.get(target.id) ?? null]));
  };
  const profiles = (run: Run) => Object.fromEntries(profilesOf(world.db, run.id).map(({ profile, target }) => [target.sourceName, profile]));
  const map = (run: Run) => mapDocument(mapOf(world.db, run.id)!) as unknown as MapDocument;
  /** A map without its per-run target identifiers, which are the only run identity it records. */
  const withoutTargets = (value: JsonValue): JsonValue => (Array.isArray(value) ? value.map(withoutTargets) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "target").map(([key, item]) => [key, withoutTargets(item)])) : value);

  beforeAll(async () => {
    trap = await NetworkTrap.open();
    gitLog = new GitLog(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fleet-scenario-git-"))));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "outside-fleet-")));
    fleet = world.fixture.dir("fleet");
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
      repos[name] = world.fixture.repo(`fleet/${name}`);
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
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("adds the fleet's repositories in bulk, refusing what is outside the allowed root", () => {
    const boundary = new SourceBoundary(world.config);
    // The archive stays out of the catalog, so the whole-fleet Assessment never sees it.
    const urls = ["billing", "client", "ui", "web", "zz-outside-link"].map((name) => `file://${fleet}/${name}`);
    const result = addRepositories(world.db, [...urls, `file://${outside}`].join("\n"), boundary);
    expect(result.failed.map((failure) => failure.line)).toEqual([5, 6]);
    sources = Object.fromEntries(listSources(world.db).map((source) => [source.name, source]));
    expect(Object.keys(sources).sort()).toEqual(["billing", "client", "ui", "web"]);
    for (const source of Object.values(sources)) expect(source.cloneUrl.startsWith(`file://${fleet}/`)).toBe(true);

    wholeFleet = createAssessment(world.db, { name: "Whole fleet", objective: "Current state of every repository", selectionMode: "all" });
    explicit = createAssessment(world.db, { name: "Shared packages", objective: "The UI and client packages", selectionMode: "explicit", sourcePublicIds: [sources.ui!.publicId, sources.client!.publicId] });
  });

  let first: Run;

  it("assesses every source independently when one becomes unavailable", async () => {
    fs.rmSync(path.join(fleet, "billing"), { recursive: true, force: true });
    first = launch(wholeFleet);
    await drain();

    first = refreshed(first);
    expect(first.state).toBe("complete_with_issues");
    expect(states(first)).toEqual({ billing: "failed", client: "complete", ui: "complete", web: "complete" });
    expect(targetsOf(world.db, first.id).find((target) => target.sourceName === "billing")).toMatchObject({ failureCode: "source_unavailable" });
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
    await drain();
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
    await drain();
    expect(refreshed(one).state).toBe("complete");
    expect(refreshed(two).state).toBe("complete");
    expect(Object.fromEntries(Object.entries(profiles(two)).map(([name, profile]) => [name, profile.digest]))).toEqual(Object.fromEntries(Object.entries(profiles(one)).map(([name, profile]) => [name, profile.digest])));
    expect(withoutTargets(map(two) as unknown as JsonValue)).toEqual(withoutTargets(map(one) as unknown as JsonValue));
    // The explicit Initiative keeps its own scope: the other sources are not in it.
    expect(Object.keys(states(two)).sort()).toEqual(["client", "ui"]);
  });

  it("cancels a running Assessment, keeping the Profile that finished", async () => {
    const run = launch(explicit);
    await drain(2); // the coordinator, then the first target
    requestCancellation(world.db, run.id);
    await drain();

    const done = refreshed(run);
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
    const allowed = [world.fixture.root, world.config.repositoryStorage, "/dev/null"];
    expect(paths.filter((file) => !allowed.some((root) => file === root || file.startsWith(`${root}/`)))).toEqual([]);
    expect(paths.some((file) => file.startsWith(outside))).toBe(false);
  });
});
