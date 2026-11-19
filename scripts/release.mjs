// Builds a production release from the committed sources, runnable with Node alone:
//
//   SURVEYOR_NPM_REGISTRY=<registry> npm run release [-- <directory>]
//
// The build runs in a clean copy of HEAD (`git archive`), never in this
// working tree: Next's standalone tracing copies from the whole project
// directory, so building here would ship local data such as `storage/`.
// Uncommitted changes are left out. Dependencies install with `npm ci` and
// lifecycle scripts disabled (see .npmrc), as in development.
//
// The release is named frontend-registry, after package.json. The directory
// (default `release/`) holds the standalone web server, its
// static files, the worker and migration bundles, the migrations, the
// settings, and the native SQLite binding the worker loads. Run it with:
//
//   node dist/migrate.cjs   # before the first start and after each upgrade
//   node server.js          # the web server
//   node dist/worker.cjs    # the worker
//
// The release installs nothing, so it holds no npm configuration or registry
// credential; `scripts/verify-release.mjs` checks that.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const target = path.resolve(root, process.argv[2] ?? "release");
// For one release, the registry's old variable name still works, with a warning; .npmrc reads only the new one.
const LEGACY_REGISTRY = "REPO_FACTS_NPM_REGISTRY";
if (!process.env.SURVEYOR_NPM_REGISTRY && process.env[LEGACY_REGISTRY]) {
  console.warn(`${LEGACY_REGISTRY} is deprecated and stops working in the next release. Set SURVEYOR_NPM_REGISTRY instead.`);
  process.env.SURVEYOR_NPM_REGISTRY = process.env[LEGACY_REGISTRY];
}
if (!process.env.SURVEYOR_NPM_REGISTRY) throw new Error("Set SURVEYOR_NPM_REGISTRY to the registry that serves the @repo-facts packages.");

// The clean copy builds into its own `.next`, whatever this shell points the build directory at.
const { FRONTEND_REGISTRY_NEXT_DIST_DIR: _distDir, ...inherited } = process.env;
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit", env: { ...inherited, NEXT_TELEMETRY_DISABLED: "1" } });
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).trim();
if (dirty) console.warn("Uncommitted changes are left out of the release; it builds HEAD.");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

const work = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-registry-release-"));
try {
  execFileSync("sh", ["-c", `git archive --format=tar "${commit}" | tar -x -C "${work}"`], { cwd: root, stdio: "inherit" });
  run("npm", ["ci", "--no-audit", "--no-fund"], work);
  // npm skips an optional package that fails to download, and with scripts disabled esbuild can't fetch its platform binary itself.
  run(path.join(work, "node_modules", ".bin", "esbuild"), ["--version"], work);
  run("npm", ["run", "build"], work);

  fs.rmSync(target, { recursive: true, force: true });
  const copy = (source, destination = source) => fs.cpSync(path.join(work, source), path.join(target, destination), { recursive: true, verbatimSymlinks: true });
  copy(".next/standalone", ".");
  copy(".next/static", ".next/static");
  if (fs.existsSync(path.join(work, "public"))) copy("public");
  copy("dist");
  copy("drizzle");
  copy("config");
  // The worker bundle loads the native SQLite binding from node_modules.
  copy("node_modules/better-sqlite3");
  // Standalone tracing copies the whole project directory; keep only what the processes run or read.
  const keep = new Set([".next", "server.js", "node_modules", "package.json", "config", "dist", "drizzle", "public"]);
  for (const name of fs.readdirSync(target)) if (!keep.has(name)) fs.rmSync(path.join(target, name), { recursive: true, force: true });
  fs.mkdirSync(path.join(target, "storage"), { recursive: true });
  fs.writeFileSync(path.join(target, "RELEASE"), `${commit}\n`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(`Frontend Registry release of ${commit.slice(0, 12)} assembled in ${path.relative(root, target) || "."}. Check it with \`node scripts/verify-release.mjs ${path.relative(root, target)}\`.`);
