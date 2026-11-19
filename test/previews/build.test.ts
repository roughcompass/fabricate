import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mirrorPath } from "@/lib/acquisition/mirror";
import { deleteSource, editSource } from "@/lib/catalog/catalog";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type FabricateConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { previewBuilds, repositorySources } from "@/lib/db/schema";
import { GitRunner } from "@/lib/git/runner";
import { type Job, claimNext, jobPayload } from "@/lib/jobs/queue";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { runPreviewBuild } from "@/lib/previews/build";
import type { BuildPlan, PackageVerdict } from "@/lib/previews/eligibility";
import { deletePreview } from "@/lib/previews/lifecycle";
import { extractCommit } from "@/lib/previews/process";
import { BUILD_PREVIEW, PREPARE_PREVIEW, type PreviewBuild, decidePreparation, findPreview, markOpened, openPreparation, rebuildPreview, startPreview } from "@/lib/previews/records";
import { pinCommit } from "@/lib/previews/refs";
import { servePreview } from "@/lib/previews/serving";
import { attemptLogFile, cacheDirectory, previewDirectory, publishedDirectory } from "@/lib/previews/storage";
import { acquisitionConfig, registerLocalSource } from "../support/acquisition";
import { createTestDb, rawRun } from "../support/db";
import { GitFixture } from "../support/git-fixture";
import type { Tree } from "../support/preview-trees";
import { publishFiles, queuedPreview } from "../support/previews";
import { manifest } from "../support/profiles";

/*
 * The preview build runner (design decisions 4, 5, 8, and 9), end to end and
 * offline: fixture repositories whose `build` script is a small local Node
 * program, standing in for the build tool, that writes output honoring the
 * base path the adapter passes. Their lockfiles have no packages, so `npm ci`
 * needs no registry.
 */

const NODE = process.versions.node;
const NODE_BIN = path.dirname(process.execPath);
const PROFILE = { document: '{"schema":"fabricate.repository_profile"}', digest: "f".repeat(64) };

/** What the fixture build writes into dist/, with {{base}} replaced by the base path it was given. */
interface Emit {
  files?: Record<string, string>;
  symlinks?: Record<string, string>;
  /** Writes build-info.json with its cwd, arguments, and environment, and this file's content: where the install ran. */
  info?: string;
  /** A JSON file the test controls: { hold } keeps every build waiting, { holding } those whose directory names one of its keys, and { fail } makes them fail. */
  control?: string;
}

const BUILD_SCRIPT = `import fs from "node:fs";
import path from "node:path";
const spec = JSON.parse(fs.readFileSync(new URL("./emit.json", import.meta.url), "utf8"));
const base = process.argv.find((arg) => arg.startsWith("--base="))?.slice(7) ?? process.env.PUBLIC_PATH ?? "/";
const control = () => (spec.control && fs.existsSync(spec.control) ? JSON.parse(fs.readFileSync(spec.control, "utf8")) : {});
const held = () => control().hold || (control().holding ?? []).some((key) => process.cwd().includes(key));
while (held()) await new Promise((resolve) => setTimeout(resolve, 20));
if (control().fail) {
  console.error("fixture build failed on purpose");
  process.exit(1);
}
for (const [file, content] of Object.entries(spec.files ?? {})) {
  const target = path.join("dist", file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content.replaceAll("{{base}}", base));
}
for (const [link, target] of Object.entries(spec.symlinks ?? {})) fs.symlinkSync(target, path.join("dist", link));
if (spec.info) {
  const installedFrom = fs.existsSync(spec.info) ? fs.readFileSync(spec.info, "utf8") : null;
  fs.writeFileSync(path.join("dist", "build-info.json"), JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2), env: process.env, installedFrom }));
}
console.log("fixture build wrote dist with base " + base);
`;

const lockfile = (name: string, packages: Record<string, unknown> = {}) => manifest({ name, lockfileVersion: 3, requires: true, packages: { "": { name }, ...packages } });

/** One npm package whose build is the fixture build. */
const app = (emit: Emit): Tree => ({
  "package.json": manifest({ name: "orders", private: true, scripts: { build: "node build.mjs" } }),
  "package-lock.json": lockfile("orders"),
  "build.mjs": BUILD_SCRIPT,
  "emit.json": JSON.stringify(emit),
});

const STANDALONE: Emit = { files: { "index.html": '<!doctype html><div id="root"></div><script type="module" src="{{base}}assets/app.js"></script>\n', "assets/app.js": "document.getElementById('root').textContent = 'Orders';\n" } };

const plan = (overrides: Partial<BuildPlan> = {}): BuildPlan => ({
  installRoot: ".",
  packageManager: { name: "npm", version: null, lockfile: "package-lock.json" },
  buildTool: "vite",
  buildScript: "node build.mjs",
  node: { version: NODE, ranges: [] },
  layout: "standalone",
  composition: null,
  ...overrides,
});

describe.skipIf(!fs.existsSync(path.join(NODE_BIN, "npm")))("preview builds", () => {
  let fixture: GitFixture;
  let base: FabricateConfig;
  let config: FabricateConfig;
  let storage: string;
  let db: Db;
  let control: string;

  beforeEach(() => {
    fixture = GitFixture.create("preview-build");
    base = acquisitionConfig(fixture);
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preview-storage-")));
    control = path.join(fixture.root, "control.json");
    db = createTestDb();
  });

  afterEach(() => {
    fixture.cleanup();
    fs.rmSync(base.repositoryStorage, { recursive: true, force: true });
    fs.rmSync(storage, { recursive: true, force: true });
  });

  const settings = (source: RepositorySource, previews: Partial<FabricateConfig["settings"]["previews"]> = {}) =>
    withOverrides(base, { previews: { enabled: true, trustedSources: [source.cloneUrl], nodeVersions: { [NODE]: NODE_BIN }, storage, ...previews } });

  /** A queued preview of +packageDir+ in a remote holding +tree+, pinned and prepared with +buildPlan+. */
  async function previewOf(tree: Tree, buildPlan: BuildPlan, packageDir = "."): Promise<PreviewBuild> {
    const work = fixture.repo("work/orders");
    for (const [file, content] of Object.entries(tree)) work.write(file, content);
    work.commit("initial");
    const remote = fixture.bare("remotes/orders.git", { from: work });
    const source = registerLocalSource(db, base, "orders", remote.path);
    config = settings(source);
    const pinned = await pinCommit(db, source, { kind: "ref", name: null }, { config });
    const { preparation } = openPreparation(db, source, pinned);
    const verdict: PackageVerdict = { directory: packageDir, manifest: "package.json", name: "orders", qualifies: true, conditions: [], plan: buildPlan };
    decidePreparation(db, preparation.publicId, preparation.requestedAt.getTime(), PROFILE, { packages: [verdict], refusal: null });
    // Decided here, so its job has nothing left to do; only the build job is queued.
    rawRun(db, "delete from jobs where kind = ?", PREPARE_PREVIEW);
    return startPreview(db, preparation.publicId, packageDir).preview;
  }

  const build = (preview: PreviewBuild, claim = "test-claim") => runPreviewBuild(db, { preview: preview.publicId, attempt: findPreview(db, preview.publicId)!.attempt }, { config, claim });
  const current = (preview: PreviewBuild) => findPreview(db, preview.publicId)!;
  /** The latest attempt's log, empty until a claim starts it. */
  const logOf = (preview: PreviewBuild) => {
    const file = attemptLogFile(config, current(preview));
    return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  };
  const published = (preview: PreviewBuild, file: string) => fs.readFileSync(path.join(publishedDirectory(config, current(preview))!, file), "utf8");
  const listing = (preview: PreviewBuild, directory: string) => fs.readdirSync(path.join(previewDirectory(config, preview.publicId), directory)).sort();
  const hold = (state: { hold?: boolean; holding?: string[]; fail?: boolean }) => fs.writeFileSync(control, JSON.stringify(state));
  async function until(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
    for (const deadline = Date.now() + timeoutMs; !condition(); ) {
      if (Date.now() > deadline) throw new Error("condition not met in time");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  describe("extraction", () => {
    it("unpacks the pinned commit's tree with git archive, running no filter and leaving submodules out", async () => {
      const marker = path.join(fixture.root, "filter-ran");
      const work = fixture.repo("work/orders");
      work.write("src/app.txt", "orders\n").write("bin/run.sh", "#!/bin/sh\necho run\n", { executable: true }).write(".gitattributes", "*.txt filter=touch\n");
      // A smudge filter configured where the commit was made; it never travels with the commit.
      work.git("config", "filter.touch.smudge", `touch ${marker} && cat`);
      work.git("update-index", "--add", "--cacheinfo", `160000,${"c".repeat(40)},vendor/lib`);
      const commit = work.commit("initial");
      const remote = fixture.bare("remotes/orders.git", { from: work });
      const source = registerLocalSource(db, base, "orders", remote.path);
      config = settings(source);
      await pinCommit(db, source, { kind: "ref", name: null }, { config });

      const destination = fs.mkdtempSync(path.join(storage, "work-"));
      await extractCommit(new GitRunner({ config }), mirrorPath(config.repositoryStorage, source.publicId), commit, destination);
      expect(fs.readFileSync(path.join(destination, "src/app.txt"), "utf8")).toBe("orders\n");
      expect(fs.statSync(path.join(destination, "bin/run.sh")).mode & 0o111).not.toBe(0);
      // A submodule's content is never fetched or unpacked.
      const submodule = path.join(destination, "vendor/lib");
      expect(fs.existsSync(submodule) ? fs.readdirSync(submodule) : []).toEqual([]);
      expect(fs.existsSync(marker)).toBe(false);
      expect(fs.existsSync(path.join(destination, ".git"))).toBe(false);
    });
  });

  describe("install and build", () => {
    it("installs at the workspace root and builds the selected package from its own directory, without Fabricate's credentials", async () => {
      const workspace: Tree = {
        "package.json": manifest({
          name: "orders-monorepo",
          private: true,
          workspaces: ["packages/*"],
          // The install's lifecycle scripts run at the install root; the workspace's own build must not run.
          scripts: { postinstall: "node -e \"require('fs').writeFileSync('install-cwd.txt', process.cwd())\"", build: 'node -e "process.exit(3)"' },
        }),
        "package-lock.json": lockfile("orders-monorepo", { "node_modules/web": { resolved: "packages/web", link: true }, "packages/web": { name: "web", version: "1.0.0" } }).replace('"": {\n      "name": "orders-monorepo"\n    }', '"": {\n      "name": "orders-monorepo",\n      "workspaces": [\n        "packages/*"\n      ]\n    }'),
        "packages/web/package.json": manifest({ name: "web", version: "1.0.0", private: true, scripts: { build: "node build.mjs" } }),
        "packages/web/build.mjs": BUILD_SCRIPT,
        "packages/web/emit.json": JSON.stringify({ ...STANDALONE, info: "../../install-cwd.txt" }),
      };
      const preview = await previewOf(workspace, plan(), "packages/web");
      const secrets = { FABRICATE_DE_CONSOLE_TOKEN: "console-secret", GIT_ASKPASS: "/usr/local/bin/askpass-secret", VERCEL_TOKEN: "vercel-secret", AI_GATEWAY_API_KEY: "ai-secret" };
      Object.assign(process.env, secrets);
      try {
        // Through the worker's registered handler.
        await drainJobs(db, jobHandlers(db, config));
      } finally {
        for (const key of Object.keys(secrets)) delete process.env[key];
      }

      const done = current(preview);
      expect(done).toMatchObject({ attemptState: "ready", attemptReason: null, artifactAttempt: 1, artifactLayout: "standalone", nodeVersion: NODE, packageManager: "npm" });
      expect(done.artifact).toMatch(/^out\/1-[a-z0-9]+$/);
      expect(JSON.parse(done.artifactEntry!)).toEqual({ file: "index.html", rebase: false });
      expect(done.outputBytes).toBeGreaterThan(0);

      const info = JSON.parse(published(preview, "build-info.json")) as { cwd: string; argv: string[]; env: Record<string, string>; installedFrom: string };
      const work = path.join(previewDirectory(config, preview.publicId), "staging", done.artifact!.slice(4), "work");
      expect(info.installedFrom).toBe(work);
      expect(info.cwd).toBe(path.join(work, "packages/web"));
      expect(info.argv).toEqual([`--base=/previews/${preview.publicId}/`]);
      expect(info.env).toMatchObject({ CI: "1", NODE_ENV: "production", HOME: path.join(path.dirname(work), "home") });
      expect(Object.keys(info.env).filter((key) => /^(FABRICATE|GIT|VERCEL|AI)_/.test(key))).toEqual([]);
      expect(JSON.stringify(info.env)).not.toContain("secret");

      // The standalone page is built under the preview's base path.
      expect(published(preview, "index.html")).toContain(`src="/previews/${preview.publicId}/assets/app.js"`);
      const log = logOf(preview);
      for (const step of ["==> extract: git archive", "==> install: npm ci in the repository root, with package-lock.json", `==> build: npm run build -- --base=/previews/${preview.publicId}/ in packages/web`, "==> validate: packages/web/dist", `==> publish: ${done.artifact}`, "==> ready:"]) {
        expect(log).toContain(step);
      }
      expect(log).toContain("fixture build wrote dist");
      // The working tree and the claim's scratch are gone; the output is kept.
      expect(listing(preview, "staging")).toEqual([]);
      expect(listing(preview, "out")).toEqual([done.artifact!.slice(4)]);
    });

    it("chooses Node again under the settings the build runs with, and fails before installing when none fits", async () => {
      const preview = await previewOf(app(STANDALONE), plan({ node: { version: NODE, ranges: [">=20.0.0"] } }));
      config = withOverrides(config, { previews: { nodeVersions: { "18.20.4": NODE_BIN } } });

      expect(await build(preview)).toBe("failed");
      expect(current(preview)).toMatchObject({ attemptState: "failed", attemptReason: "No configured Node version satisfies >=20.0.0. Configured: 18.20.4.", artifact: null });
      const log = logOf(preview);
      expect(log).toContain("==> extract");
      expect(log).not.toContain("==> install");
      expect(log).toContain("==> failed: No configured Node version satisfies >=20.0.0.");
    });

    it("fails a queued build, running nothing, while previews are off or the remote isn't enrolled", async () => {
      const preview = await previewOf(app(STANDALONE), plan());
      const enrolled = config;
      config = withOverrides(enrolled, { previews: { enabled: false } });
      expect(await build(preview)).toBe("failed");
      expect(current(preview)).toMatchObject({ attemptState: "failed", attemptReason: "Previews were turned off before the build ran", attemptLog: null });

      config = enrolled;
      rebuildPreview(db, preview.publicId);
      config = withOverrides(enrolled, { previews: { trustedSources: [] } });
      expect(await build(preview)).toBe("failed");
      expect(current(preview)).toMatchObject({ attempt: 2, attemptReason: "orders is not enrolled for previews", attemptLog: null });
      expect(fs.existsSync(previewDirectory(config, preview.publicId))).toBe(false);
    });
  });

  describe("output", () => {
    const SYSTEM_ENTRY = 'System.register(["react"],function(e){"use strict";return{execute:function(){e({bootstrap:async()=>{},mount:async()=>{},unmount:async()=>{}})}}});\n';
    const CONTAINER = 'var mfAdmin;mfAdmin=(()=>{"use strict";return{get:()=>{},init:()=>{}}})();\n';
    const NO_PAGE = "The output has no index.html. Previews need a page that loads the application on its own.";

    it("publishes a Module Federation remote through the page its build emitted, served like any other application", async () => {
      const page = '<!doctype html><script defer src="remoteEntry.js"></script><script defer src="main.js"></script>\n';
      const preview = await previewOf(app({ files: { "index.html": page, "main.js": "1;\n", "remoteEntry.js": CONTAINER } }), plan({ layout: "module_federation", buildTool: "rspack" }));
      expect(await build(preview)).toBe("published");

      const done = current(preview);
      expect(done).toMatchObject({ attemptState: "ready", artifactLayout: "standalone" });
      expect(JSON.parse(done.artifactEntry!)).toEqual({ file: "index.html", rebase: false });
      expect(published(preview, "remoteEntry.js")).toContain("var mfAdmin");
      expect(logOf(preview)).toContain(`with ASSET_PATH and PUBLIC_PATH set to /previews/${preview.publicId}/`);
      expect(logOf(preview)).toContain("3 files, ");
    });

    it.each([
      ["a single-spa bundle without a page", { files: { "assets/orders.js": SYSTEM_ENTRY, "assets/orders.css": "section{}" } }, { layout: "single_spa", buildTool: "vite" }, {}, NO_PAGE],
      ["a Module Federation container without a page", { files: { "remoteEntry.js": CONTAINER, "706.js": "(self.webpackChunk=self.webpackChunk||[]).push([[706],{}]);\n" } }, { layout: "module_federation", buildTool: "rspack" }, {}, NO_PAGE],
      ["a symbolic link in the output", { files: STANDALONE.files, symlinks: { "hosts.txt": "/etc/hosts" } }, {}, {}, "The output contains a symbolic link, hosts.txt. Previews publish only regular files."],
      ["output over the size limit", STANDALONE, {}, { maxOutputBytes: 64 }, "The output is larger than 64 bytes, the limit previews.maxOutputBytes sets."],
      ["a standalone app without index.html", { files: { "assets/app.js": "1;\n" } }, {}, {}, NO_PAGE],
    ] as const)("rejects %s, though the build command succeeded", async (_label, emit, overrides, limits, reason) => {
      const preview = await previewOf(app(emit), plan(overrides));
      config = withOverrides(config, { previews: limits });

      expect(await build(preview)).toBe("failed");
      expect(current(preview)).toMatchObject({ attemptState: "failed", attemptReason: reason, artifact: null, outputBytes: null });
      const log = logOf(preview);
      expect(log).toContain("fixture build wrote dist");
      expect(log).toContain(`==> failed: ${reason}`);
      expect(fs.existsSync(path.join(previewDirectory(config, preview.publicId), "out"))).toBe(false);
      expect(listing(preview, "staging")).toEqual([]);
    });
  });

  describe("attempts", () => {
    it("keeps serving the earlier artifact while a rebuild runs and after it fails, and shows the rebuild's log", async () => {
      const preview = await previewOf(app({ ...STANDALONE, control }), plan());
      expect(await build(preview)).toBe("published");
      const first = current(preview);
      const firstLog = attemptLogFile(config, first)!;

      rebuildPreview(db, preview.publicId);
      hold({ hold: true, fail: true });
      const rebuilding = build(preview);
      await until(() => current(preview).attemptState === "building" && logOf(preview).includes("==> build:"));

      const during = current(preview);
      expect(during).toMatchObject({ attempt: 2, attemptState: "building", artifact: first.artifact, artifactAttempt: 1 });
      expect(during.attemptLog).toMatch(/^logs\/2-[a-z0-9]+\.log$/);
      expect(published(preview, "index.html")).toContain(`/previews/${preview.publicId}/assets/app.js`);
      // Only the latest attempt's log is kept.
      expect(fs.existsSync(firstLog)).toBe(false);

      hold({ fail: true });
      expect(await rebuilding).toBe("failed");
      const after = current(preview);
      expect(after).toMatchObject({ attempt: 2, attemptState: "failed", attemptReason: `The build failed: npm run build -- --base=/previews/${preview.publicId}/ exited with code 1.`, artifact: first.artifact, artifactAttempt: 1, outputBytes: first.outputBytes });
      expect(published(preview, "index.html")).toContain(`/previews/${preview.publicId}/assets/app.js`);
      const log = logOf(preview);
      expect(log).toContain("fixture build failed on purpose");
      expect(log.trimEnd().split("\n").at(-1)).toBe(`==> failed: ${after.attemptReason}`);

      // A rebuild that succeeds replaces the artifact and removes the one it superseded.
      hold({});
      rebuildPreview(db, preview.publicId);
      expect(await build(preview)).toBe("published");
      const third = current(preview);
      expect(third).toMatchObject({ attempt: 3, attemptState: "ready", artifactAttempt: 3 });
      expect(listing(preview, "out")).toEqual([third.artifact!.slice(4)]);
    });

    it("lets no claim publish after its lease expired and another worker took the attempt over", async () => {
      const preview = await previewOf(app({ ...STANDALONE, control }), plan());
      const handler = jobHandlers(db, config)[BUILD_PREVIEW]!;
      const never = new AbortController().signal;
      const run = (job: Job) => handler(jobPayload(job), { job, signal: never });
      hold({ hold: true });

      // Worker A claims the job with a short lease, then stops renewing it, as a stalled worker would.
      const claimedByA = claimNext(db, { workerId: "worker-a", leaseMs: 100 })!;
      const a = run(claimedByA);
      await until(() => current(preview).attemptClaim?.startsWith("worker-a#") === true && logOf(preview).includes("==> build:"));
      const logA = attemptLogFile(config, current(preview))!;

      // The lease expires and worker B takes the job, and with it the attempt.
      const claimedByB = claimNext(db, { workerId: "worker-b", now: new Date(Date.now() + 1_000) })!;
      expect(claimedByB.id).toBe(claimedByA.id);
      const b = run(claimedByB);
      await until(() => current(preview).attemptClaim?.startsWith("worker-b#") === true && logOf(preview).includes("==> build:"));
      expect(fs.existsSync(logA)).toBe(false);

      // A finishes first, while B still runs the attempt: its output is built and validated, but not published.
      const keyB = current(preview).attemptLog!.slice("logs/".length, -".log".length);
      hold({ holding: [keyB] });
      await a;
      expect(current(preview)).toMatchObject({ attemptState: "building", attemptClaim: `worker-b#${claimedByB.id}.2`, artifact: null });
      expect(fs.readdirSync(path.join(previewDirectory(config, preview.publicId), "out"))).toEqual([]);
      expect(listing(preview, "staging")).toEqual([keyB]);

      hold({});
      await b;
      const done = current(preview);
      expect(done).toMatchObject({ attemptState: "ready", attemptClaim: `worker-b#${claimedByB.id}.2`, artifactAttempt: 1, artifact: `out/${keyB}` });
      expect(listing(preview, "out")).toEqual([keyB]);
      expect(logOf(preview)).toContain("==> ready:");
      expect(listing(preview, "staging")).toEqual([]);
    });

    it("leaves an attempt that lost its lease to a new claim, without publishing or failing it", async () => {
      const preview = await previewOf(app({ ...STANDALONE, control }), plan());
      hold({ hold: true });
      const controller = new AbortController();
      const running = runPreviewBuild(db, { preview: preview.publicId, attempt: 1 }, { config, claim: "stalled", signal: controller.signal });
      await until(() => logOf(preview).includes("==> build:"));

      controller.abort(new Error("The job's lease was lost"));
      await expect(running).rejects.toThrow();
      expect(current(preview)).toMatchObject({ attemptState: "building", attemptClaim: "stalled", artifact: null });
      expect(logOf(preview).trimEnd().split("\n").at(-1)).toBe("==> stopped: The job's lease was lost");
      expect(listing(preview, "staging")).toEqual([]);

      hold({});
      expect(await build(preview, "next")).toBe("published");
      expect(current(preview)).toMatchObject({ attemptState: "ready", attemptClaim: "next" });
    });
  });

  describe("lifecycle", () => {
    const serve = (preview: PreviewBuild, file = "") =>
      servePreview(new Request(`http://localhost/previews/${preview.publicId}/${file}`, { headers: { "sec-fetch-dest": "document" } }), preview.publicId, file ? file.split("/") : [], { db, config });
    const sourceOf = (preview: PreviewBuild) => db.select().from(repositorySources).where(eq(repositorySources.id, preview.repositorySourceId)).get()!;
    const row = (preview: PreviewBuild) => db.select().from(previewBuilds).where(eq(previewBuilds.publicId, preview.publicId)).get()!;

    /** A published preview whose rebuild is held in its build step. */
    async function rebuildingPreview(): Promise<{ preview: PreviewBuild; first: PreviewBuild; rebuilding: Promise<string> }> {
      const preview = await previewOf(app({ ...STANDALONE, control }), plan());
      expect(await build(preview)).toBe("published");
      const first = current(preview);
      rebuildPreview(db, preview.publicId);
      hold({ hold: true });
      const rebuilding = build(preview);
      await until(() => current(preview).attemptState === "building" && logOf(preview).includes("==> build:"));
      expect((await serve(preview, "assets/app.js")).status).toBe(200);
      return { preview, first, rebuilding };
    }

    it("stops serving a preview deleted during its rebuild at once, and the rebuild can neither publish nor restore it", async () => {
      const { preview, first, rebuilding } = await rebuildingPreview();

      expect(await deletePreview(db, preview.publicId, config)).toBe(true);
      expect((await serve(preview)).status).toBe(404);
      expect((await serve(preview, "assets/app.js")).status).toBe(404);
      // The published files are gone at once; the rebuild still running may write scratch files at the preview's path until it stops.
      expect(fs.existsSync(path.join(previewDirectory(config, preview.publicId), first.artifact!))).toBe(false);

      hold({});
      expect(await rebuilding).toBe("superseded");
      expect(findPreview(db, preview.publicId)).toBeUndefined();
      expect(row(preview)).toMatchObject({ attempt: 2, artifact: first.artifact, artifactAttempt: 1, deletedAt: expect.any(Date) });
      expect(fs.existsSync(previewDirectory(config, preview.publicId))).toBe(false);
      expect((await serve(preview)).status).toBe(404);
    });

    it("deletes a Repository's previews during a rebuild the same way", async () => {
      const { preview, first, rebuilding } = await rebuildingPreview();
      const previous = getConfig();
      // Repository deletion reads the process's settings.
      setConfig(config);
      try {
        deleteSource(db, sourceOf(preview).publicId, "orders");
      } finally {
        setConfig(previous);
      }
      expect((await serve(preview, "assets/app.js")).status).toBe(404);
      expect(fs.existsSync(path.join(previewDirectory(config, preview.publicId), first.artifact!))).toBe(false);

      hold({});
      expect(await rebuilding).toBe("superseded");
      expect(row(preview).deletedAt).toBeInstanceOf(Date);
      expect(fs.existsSync(previewDirectory(config, preview.publicId))).toBe(false);
    });

    it("refuses to publish once the Repository names a remote that isn't enrolled, and stops serving its earlier output", async () => {
      const { preview, first, rebuilding } = await rebuildingPreview();
      const source = sourceOf(preview);

      editSource(db, source.publicId, source.lockVersion, { name: "orders", cloneUrl: "https://git.example.com/acme/orders-fork.git", gitRef: "" });
      expect((await serve(preview, "assets/app.js")).status).toBe(404);

      hold({});
      expect(await rebuilding).toBe("failed");
      expect(current(preview)).toMatchObject({ attempt: 2, attemptState: "failed", attemptReason: "orders is no longer enrolled for previews, so the output wasn't published", artifact: first.artifact, artifactAttempt: 1 });
      expect(listing(preview, "out")).toEqual([first.artifact!.slice(4)]);
      expect(logOf(preview)).toContain("==> not published: orders is no longer enrolled for previews");
      expect((await serve(preview)).status).toBe(404);
    });

    it("prunes the least recently opened previews after a successful build, never the one it published", async () => {
      const preview = await previewOf(app(STANDALONE), plan());
      const source = sourceOf(preview);
      const stale = publishFiles(db, config, queuedPreview(db, source), { "index.html": "s".repeat(10_000) });
      const opened = publishFiles(db, config, queuedPreview(db, source), { "index.html": "o".repeat(3_000) });
      markOpened(db, stale.publicId, new Date(Date.now() - 60 * 60_000));
      markOpened(db, opened.publicId, new Date(Date.now() - 30 * 60_000));
      config = withOverrides(config, { previews: { maxStorageBytes: 8_000 } });

      expect(await build(preview)).toBe("published");
      expect(findPreview(db, stale.publicId)).toBeUndefined();
      expect(fs.existsSync(previewDirectory(config, stale.publicId))).toBe(false);
      expect(findPreview(db, opened.publicId)).toBeDefined();
      expect(current(preview).attemptState).toBe("ready");
      expect(logOf(preview)).toContain(`==> prune: deleted the least recently used preview to keep stored output under 7.8 KiB: ${stale.publicId}`);
      expect(logOf(preview).trimEnd().split("\n").at(-1)).toMatch(/^==> ready: /);
    });

    it("empties its package manager's cache with the manager's own command once the caches hold more than half the storage limit", async () => {
      const preview = await previewOf(app(STANDALONE), plan());
      const cached = path.join(cacheDirectory(config), "npm", "_cacache", "content-v2", "sha512", "big");
      fs.mkdirSync(path.dirname(cached), { recursive: true });
      fs.writeFileSync(cached, "c".repeat(64 * 1024));
      config = withOverrides(config, { previews: { maxStorageBytes: 100 * 1024 } });

      expect(await build(preview)).toBe("published");
      const log = logOf(preview);
      expect(log).toMatch(/==> cache: the package caches hold \d+(\.\d)? KiB, more than half of previews\.maxStorageBytes: npm cache clean --force\n/);
      expect(log).toContain("The package caches now hold");
      expect(log.indexOf("==> cache:")).toBeLessThan(log.indexOf("==> publish:"));
      expect(fs.existsSync(path.join(cacheDirectory(config), "npm", "_cacache"))).toBe(false);
    });
  });
});
