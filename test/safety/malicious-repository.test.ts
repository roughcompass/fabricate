import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { JsonObject } from "@repo-facts/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRun, targetsOf } from "@/lib/runs/run-records";
import { launchRun } from "@/lib/runs/launcher";
import { resolveCloneUrl } from "@/lib/repositories/registration";
import { SourceBoundary } from "@/lib/repositories/source-boundary";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { buildAssessment } from "../support/builders";
import { type Repo } from "../support/git-fixture";
import { GitLog, NO_NETWORK_CALLS, NetworkTrap, countNetworkCalls } from "../support/traps";

/**
 * A hostile repository assessed end to end through the real launcher,
 * acquisition, analysis, and finalization jobs.
 *
 * Every attack vector tries to leave a sentinel file, reach a loopback
 * network trap, resolve a hostname, or mark that repository code was loaded
 * as a module. A logging Git wrapper records every Git invocation. The
 * Assessment must complete, record the payloads only as data, and leave no
 * sentinel, connection, lookup, module load, or disallowed Git command.
 */

const HOOKS = ["applypatch-msg", "pre-applypatch", "post-applypatch", "pre-commit", "prepare-commit-msg", "commit-msg", "post-commit", "pre-rebase", "post-checkout", "post-merge", "pre-push", "pre-receive", "update", "proc-receive", "post-receive", "post-update", "reference-transaction", "push-to-checkout", "pre-auto-gc", "post-rewrite", "fsmonitor-watchman", "post-index-change"];
const MODULE_FILES = ["index.js", "next.config.js", "next.config.mjs", "eslint.config.mjs", ".eslintrc.js", "vite.config.ts", "vitest.config.ts", "jest.config.js", "babel.config.js", "postcss.config.cjs", "tailwind.config.js", "webpack.config.js", "playwright.config.ts", "src/app.ts", "src/server.mjs"];
const ALLOWED_SUBCOMMANDS = new Set(["version", "init", "ls-remote", "fetch", "rev-parse", "update-ref", "for-each-ref", "cat-file", "ls-tree"]);

describe("Assessment of a malicious repository", () => {
  const world = useAcquisitionWorld("malicious", { once: true });
  let sentinels: string;
  let outside: string;
  let gitLog: GitLog;
  let trap: NetworkTrap;
  let trapUrl: string;
  const markers = { outside: `OUTSIDE-${crypto.randomUUID()}`, npmrc: `NPMRC-${crypto.randomUUID()}`, env: `DOTENV-${crypto.randomUUID()}` };
  let spyCalls: Record<string, number> = {};
  let work: Repo;
  let runId: string;

  const touch = (name: string) => `touch '${path.join(sentinels, name)}'`;
  const script = (name: string) => `#!/bin/sh\n${touch(name)}\n`;
  const moduleSource = (name: string) =>
    `require("fs").writeFileSync(${JSON.stringify(path.join(sentinels, `module-${name.replaceAll("/", "_")}`))}, "loaded");\nglobalThis.__frontendRegistryModuleTrap = ${JSON.stringify(name)};\nfetch(${JSON.stringify(`${trapUrl}/module`)}).catch(() => {});\nmodule.exports = {};\n`;

  function hostileRepository(): Repo {
    const work = world.fixture.repo("fleet/hostile");
    const manifest = {
      name: "hostile",
      version: "1.0.0",
      main: "index.js",
      scripts: Object.fromEntries(["preinstall", "install", "postinstall", "prepare", "prepublishOnly", "pretest", "test", "build", "start"].map((name) => [name, `${touch(`npm-${name}`)} && curl ${trapUrl}/${name}`])),
      dependencies: {
        "ext-transport": `git+ext::sh -c ${touch("dependency-ext").replaceAll(" ", "% ")}`,
        "ssh-proxy-command": `git+ssh://-oProxyCommand=${encodeURIComponent(touch("dependency-ssh"))}/acme/x.git`,
        "trap-tarball": `${trapUrl}/trap.tgz`,
      },
      publishConfig: { registry: `${trapUrl}/` },
    };
    work.write("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
    for (const file of MODULE_FILES) work.write(file, moduleSource(file));
    work.write("src/client.ts", `export const orders = () => fetch("${trapUrl}/api/orders");\nexport const payments = () => fetch("https://payments.invalid/v1/charges", { method: "POST" });\n`);
    work.write(".github/workflows/ci.yml", `name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${touch("ci")} && curl ${trapUrl}/ci\n`);
    work.write(".gitlab-ci.yml", `build:\n  script:\n    - ${touch("gitlab-ci")}\n`);
    work.write("Makefile", `all:\n\t${touch("make")}\n`);
    work.write("Dockerfile", `FROM alpine\nRUN ${touch("docker")}\n`);
    work.write(".husky/pre-commit", script("husky"), { executable: true });
    for (const hook of HOOKS) work.write(`.githooks/${hook}`, script(`committed-hook-${hook}`), { executable: true });
    work.write(".gitattributes", "* filter=evil diff=evil merge=evil\n*.js text eol=lf\n");
    work.write("openapi.yaml", `openapi: 3.0.0\ninfo: { title: Orders, version: "1" }\nservers:\n  - url: ${trapUrl}\npaths:\n  /orders:\n    $ref: "${trapUrl}/remote.yaml#/paths/orders"\n`);
    work.write(".npmrc", `registry=${trapUrl}/\n//127.0.0.1/:_authToken=${markers.npmrc}\n`);
    work.write(".env", `API_TOKEN=${markers.env}\n`);
    work.symlink("escape-absolute", path.join(outside, "secret.txt"));
    work.symlink("escape-relative", path.relative(work.path, path.join(outside, "secret.txt")));
    work.symlink("tsconfig.json", path.join(outside, "secret.txt"));
    work.write(".gitmodules", `[submodule "vendor/ext"]\n\tpath = vendor/ext\n\turl = ext::sh -c ${touch("submodule-ext").replaceAll(" ", "% ")}\n[submodule "vendor/outside"]\n\tpath = vendor/outside\n\turl = file://${outside}\n`);
    work.git("add", "--all");
    for (const gitlink of ["vendor/ext", "vendor/outside"]) work.git("update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},${gitlink}`);
    work.git("commit", "--quiet", "-m", "Hostile fixture");

    // Payloads in the source repository's own Git directory, which Git consults when it serves a local clone.
    for (const hook of HOOKS) {
      fs.writeFileSync(path.join(work.path, ".git/hooks", hook), script(`source-hook-${hook}`), { mode: 0o755 });
    }
    const configEntries: [string, string][] = [
      ["core.hooksPath", path.join(work.path, ".githooks")],
      ["core.fsmonitor", touch("fsmonitor")],
      ["core.sshCommand", touch("ssh-command")],
      ["core.gitProxy", touch("git-proxy")],
      ["core.pager", touch("pager")],
      ["core.editor", touch("editor")],
      ["credential.helper", `!${touch("credential-helper")}`],
      ["uploadpack.packObjectsHook", touch("pack-objects-hook")],
      ["protocol.ext.allow", "always"],
      ["filter.evil.smudge", touch("filter-smudge")],
      ["filter.evil.clean", touch("filter-clean")],
      ["filter.evil.process", touch("filter-process")],
      ["filter.evil.required", "true"],
      ["diff.evil.textconv", touch("diff-textconv")],
      ["merge.evil.driver", touch("merge-driver")],
    ];
    for (const [key, value] of configEntries) work.git("config", key, value);
    return work;
  }

  beforeAll(async () => {
    sentinels = world.fixture.dir("sentinels");
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "outside-root-")));
    fs.writeFileSync(path.join(outside, "secret.txt"), `${markers.outside}\n`);

    trap = await NetworkTrap.open();
    trapUrl = trap.url;

    // Every Git invocation Fabricate makes goes through this wrapper, which logs its argv and runs the real Git.
    gitLog = new GitLog(world.fixture.dir("git-log"));

    work = hostileRepository();
    const repository = registerLocalRepository(world.db, world.config, "hostile", work.path);
    const assessment = buildAssessment(world.db, { repositories: [repository] });

    spyCalls = await gitLog.during(() =>
      countNetworkCalls(async () => {
        runId = launchRun(world.db, assessment.publicId, crypto.randomUUID(), world.config).run.publicId;
        await drainJobs(world.db, jobHandlers(world.db, world.config));
      }),
    );
  }, 120_000);

  afterAll(async () => {
    await trap.close();
    fs.rmSync(outside, { recursive: true, force: true });
    delete (globalThis as { __frontendRegistryModuleTrap?: unknown }).__frontendRegistryModuleTrap;
  });

  const facts = () => profileDocument(profilesOf(world.db, getRun(world.db, runId).id)[0]!.profile).fact_document as JsonObject;
  const category = (id: string) => (facts().categories as Record<string, JsonObject>)[id]!;

  it("completes the Assessment with a Profile and a Relationship Map", () => {
    const run = getRun(world.db, runId);
    expect(run.state).toBe("complete");
    expect(targetsOf(world.db, run.id).map((target) => target.state)).toEqual(["complete"]);
    expect(mapOf(world.db, run.id)).toBeDefined();
  });

  it("runs no hook, filter, lifecycle script, CI command, config command, or transport command", () => {
    expect(fs.readdirSync(sentinels)).toEqual([]);
  });

  it("loads no repository file as a module", () => {
    expect((globalThis as { __frontendRegistryModuleTrap?: unknown }).__frontendRegistryModuleTrap).toBeUndefined();
    const loaded = Object.keys(createRequire(import.meta.url).cache);
    expect(loaded.filter((file) => file.startsWith(world.fixture.root) || file.startsWith(world.config.repositoryStorage))).toEqual([]);
  });

  it("opens no connection and resolves no hostname", () => {
    expect(trap.connections).toEqual([]);
    expect(spyCalls).toEqual(NO_NETWORK_CALLS);
  });

  it("invokes only allowlisted Git commands, with hooks disabled and every transport but the source's refused", () => {
    const calls = gitLog.calls();
    expect(calls.length).toBeGreaterThan(0);
    for (const argv of calls) {
      const overrides = argv.flatMap((arg, index) => (argv[index - 1] === "-c" ? [arg] : []));
      const subcommand = argv.find((arg, index) => !arg.startsWith("-") && argv[index - 1] !== "-c" && !arg.includes("="));
      expect(ALLOWED_SUBCOMMANDS.has(subcommand ?? ""), argv.join(" ")).toBe(true);
      if (subcommand === "version") continue;
      expect(overrides).toEqual(expect.arrayContaining(["core.hooksPath=/dev/null", "core.fsmonitor=false", "protocol.allow=never", "credential.helper="]));
      expect(overrides.filter((override) => override.startsWith("protocol.") && override.endsWith(".allow=always"))).toEqual(subcommand === "ls-remote" || subcommand === "fetch" ? ["protocol.file.allow=always"] : []);
    }
    expect(calls.some((argv) => argv.includes("submodule") || argv.includes("checkout") || argv.includes("clone"))).toBe(false);
  });

  it("keeps a bare mirror only: no working tree of the repository is written to storage", () => {
    const written: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(full);
        else written.push(path.relative(world.config.repositoryStorage, full));
      }
    };
    walk(world.config.repositoryStorage);
    const tree = new Set(["package.json", "index.js", ".npmrc", ".env", "Makefile", "openapi.yaml", ...MODULE_FILES]);
    expect(written.filter((file) => tree.has(path.basename(file)))).toEqual([]);
    expect(written.filter((file) => file.includes("hooks/"))).toEqual([]);
  });

  it("never reads through a symbolic link or a sensitive file, so no outside or secret content is stored", () => {
    const stored = world.db.$client.serialize();
    for (const marker of Object.values(markers)) expect(stored.includes(Buffer.from(marker)), marker).toBe(false);
    const diagnostics = facts().diagnostics as JsonObject[];
    // Every link is inventoried; one a detector would read is reported as never followed.
    expect(facts().inventory).toMatchObject({ symlinks: 3, gitlinks: 2 });
    expect(diagnostics.find((diagnostic) => diagnostic.path === "tsconfig.json")).toMatchObject({ reason: "symlink", detail: expect.stringContaining("never followed") });
  });

  it("records the payloads only as data", () => {
    const scripts = (category("scripts").facts as JsonObject[]).map((fact) => fact.key);
    expect(scripts).toEqual(expect.arrayContaining(["package.json#postinstall", "package.json#preinstall"]));
    expect(category("ci_systems").state).toBe("observed");
    expect((category("submodules").facts as JsonObject[]).length).toBe(2);
    const services = (facts().service_dependencies as JsonObject[]).map((service) => service.key);
    expect(services).toEqual(expect.arrayContaining(["https://payments.invalid"]));
    for (const service of facts().service_dependencies as JsonObject[]) expect(service.access).toMatchObject({ state: "unknown" });
    // The map records the Service Dependencies as endpoints without contacting them.
    const map = mapDocument(mapOf(world.db, getRun(world.db, runId).id)!) as JsonObject;
    expect(JSON.stringify(map.nodes)).toContain("payments.invalid");
  });

  it("refuses an executable transport as a clone URL before anything is stored", () => {
    const boundary = new SourceBoundary(world.config);
    for (const url of [`ext::sh -c ${touch("clone-ext")}`, `ssh://-oProxyCommand=${encodeURIComponent(touch("clone-ssh"))}/x`, `file://${outside}`]) expect(() => resolveCloneUrl(url, boundary), url).toThrow();
    expect(fs.readdirSync(sentinels)).toEqual([]);
  });

  // Control: the same traps fire when repository behavior does run, so their silence above is meaningful.
  it("detects a hook, a module load, and a connection when they do happen", async () => {
    // A direct commit in the source repository runs its configured hooks; Fabricate never runs one. The fsmonitor
    // and long-running filter payloads are removed first, because they make any ordinary Git command in it fail.
    work.git("config", "--unset", "core.fsmonitor");
    work.git("config", "--unset", "filter.evil.process");
    work.git("commit", "--quiet", "--allow-empty", "-m", "Trap check");
    expect(fs.readdirSync(sentinels)).toContain("committed-hook-post-commit");

    createRequire(import.meta.url)(path.join(work.path, "index.js"));
    expect((globalThis as { __frontendRegistryModuleTrap?: unknown }).__frontendRegistryModuleTrap).toBe("index.js");
    expect(fs.readdirSync(sentinels)).toContain("module-index.js");
    await expect.poll(() => trap.connections.length).toBeGreaterThan(0);
  });
});
