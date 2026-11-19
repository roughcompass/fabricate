import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../../src/lib/db/client";
import { previewBuilds } from "../../src/lib/db/schema";
import { requestPreparation } from "../../src/lib/previews/preparation";
import type { PreviewBuild } from "../../src/lib/previews/records";
import { cacheDirectory } from "../../src/lib/previews/storage";
import { resolveCloneUrl } from "../../src/lib/repositories/registration";
import { type Repository, findRepositoryByCanonicalUrl, insertRepository } from "../../src/lib/repositories/repository-records";
import { SourceBoundary } from "../../src/lib/repositories/source-boundary";
import { git } from "../../test/support/git-fixture";
import { E2E_FIXTURE_APP_REMOTE, E2E_PACKAGE_CACHE } from "./env";
import { runJobs, serverConfig } from "./results";

/*
 * The fixture application (add-applications, design decision 11, task 9.1):
 * test/fixtures/apps/orders-portal, a Vite and React application with a
 * committed lockfile. It has two routes, /accounts (with /accounts/<id>) and
 * /settings, which loads as its own chunk; a field with no label on
 * /accounts; a Recalculate totals button that holds the main thread for
 * 650 ms; and a Feedback tab fixed to the middle of the right edge above
 * everything else.
 *
 * Setup turns it into a local Git repository at an enrolled remote and
 * builds it through the real preview pipeline: preparation, its survey, the
 * eligibility check, `npm ci`, and `vite build`, served under /previews/.
 * Packages come from the public npm registry the first time and from the
 * package cache kept under the e2e storage directory after that, so later
 * runs install offline.
 *
 * Onboarding (tasks 5.x) is the seam still to come: once application records
 * exist, `onboardOrdersPortal(db)` registers the remote with
 * `ordersPortalRepository`, creates the application through onboarding's
 * create, which enrolls the remote and starts the first build through the
 * same pipeline, and settles it with `settle`, in place of `buildOrdersPortal`.
 */

const SOURCE = path.resolve("test/fixtures/apps/orders-portal");
/** What a developer's own install or build leaves beside the sources, which the repository never holds. */
const LOCAL_OUTPUT = new Set(["node_modules", "dist"]);

export const ORDERS_PORTAL_REMOTE = E2E_FIXTURE_APP_REMOTE;

function copySources(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (LOCAL_OUTPUT.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copySources(source, target);
    else fs.copyFileSync(source, target);
  }
}

/** A change to commit: each file's new content, or a function of its current content; null deletes it. */
export type FixtureChange = Readonly<Record<string, string | ((current: string) => string) | null>>;

function applyChange(directory: string, change: FixtureChange): void {
  for (const [file, content] of Object.entries(change)) {
    const target = path.join(directory, file);
    if (content === null) {
      fs.rmSync(target, { force: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === "function" ? content(fs.readFileSync(target, "utf8")) : content);
  }
}

/** Replaces the remote with the fixture's sources committed on main, and returns its head commit. */
export function ordersPortalRemote(): string {
  fs.rmSync(ORDERS_PORTAL_REMOTE, { recursive: true, force: true });
  copySources(SOURCE, ORDERS_PORTAL_REMOTE);
  git(ORDERS_PORTAL_REMOTE, ["init", "--quiet", "-b", "main"]);
  git(ORDERS_PORTAL_REMOTE, ["add", "--all"]);
  git(ORDERS_PORTAL_REMOTE, ["commit", "--quiet", "-m", "Orders portal"]);
  return git(ORDERS_PORTAL_REMOTE, ["rev-parse", "HEAD"]).trim();
}

/** Commits +change+ to the remote, on +branch+ (created from main when it's new), and returns the commit. */
export function commitToOrdersPortal(change: FixtureChange, options: { branch?: string; message?: string } = {}): string {
  const branch = options.branch ?? "main";
  const branches = git(ORDERS_PORTAL_REMOTE, ["branch", "--format=%(refname:short)"]).split("\n");
  git(ORDERS_PORTAL_REMOTE, branches.includes(branch) ? ["checkout", "--quiet", branch] : ["checkout", "--quiet", "-b", branch, "main"]);
  applyChange(ORDERS_PORTAL_REMOTE, change);
  git(ORDERS_PORTAL_REMOTE, ["add", "--all"]);
  git(ORDERS_PORTAL_REMOTE, ["commit", "--quiet", "-m", options.message ?? "Change the orders portal"]);
  const commit = git(ORDERS_PORTAL_REMOTE, ["rev-parse", "HEAD"]).trim();
  git(ORDERS_PORTAL_REMOTE, ["checkout", "--quiet", "main"]);
  return commit;
}

/** The Repository for the remote, registered on first use like any other. */
export function ordersPortalRepository(db: Db): Repository {
  const remote = resolveCloneUrl(`file://${ORDERS_PORTAL_REMOTE}`, new SourceBoundary(serverConfig()));
  return findRepositoryByCanonicalUrl(db, remote.canonicalUrl) ?? insertRepository(db, { name: "orders-portal", ...remote, gitRef: null });
}

/**
 * Points the builds' npm cache at the kept one. The e2e reset empties preview
 * storage before each test, so this runs before every build; the reset
 * removes the link, never what it points to.
 */
export function linkKeptPackageCache(): void {
  const cache = path.join(cacheDirectory(serverConfig()), "npm");
  fs.mkdirSync(E2E_PACKAGE_CACHE, { recursive: true });
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  if (fs.lstatSync(cache, { throwIfNoEntry: false })?.isSymbolicLink() && fs.readlinkSync(cache) === E2E_PACKAGE_CACHE) return;
  fs.rmSync(cache, { recursive: true, force: true });
  fs.symlinkSync(E2E_PACKAGE_CACHE, cache, "dir");
}

/** Runs every queued job until none is left: the survey, the preparation it wakes, and the build. */
export async function settle(db: Db): Promise<void> {
  await runJobs(db);
}

export interface FixtureBuild {
  readonly repository: Repository;
  readonly preview: PreviewBuild;
  /** Where it's served: `/previews/<preview>/`. */
  readonly base: string;
}

/**
 * Builds the remote's +ref+ (its default branch unless named) through the
 * preview pipeline, and fails unless the build is Ready. Call
 * `ordersPortalRemote` first.
 */
export async function buildOrdersPortal(db: Db, options: { ref?: string } = {}): Promise<FixtureBuild> {
  const repository = ordersPortalRepository(db);
  linkKeptPackageCache();
  const preparation = await requestPreparation(db, repository.publicId, { kind: "ref", name: options.ref ?? null }, { config: serverConfig() });
  await settle(db);
  const preview = db.select().from(previewBuilds).where(eq(previewBuilds.preparationId, preparation.id)).orderBy(desc(previewBuilds.id)).get();
  if (!preview || preview.attemptState !== "ready") throw new Error(`The orders portal didn't build: ${preview ? `${preview.attemptState}, ${preview.attemptReason}` : "no preview was started"}. Its log is under ${cacheDirectory(serverConfig())}/..`);
  return { repository, preview, base: `/previews/${preview.publicId}/` };
}
