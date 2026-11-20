import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../../src/lib/db/client";
import { buildApplication, createApplication, createSavedPreview, prepareBranch } from "../../src/lib/applications/pipeline";
import { type Application, getApplication } from "../../src/lib/applications/records";
import { type SavedPreview, findSavedPreview } from "../../src/lib/applications/saved-previews";
import { previewBuilds } from "../../src/lib/db/schema";
import { requestPreparation } from "../../src/lib/previews/preparation";
import type { PreviewBuild } from "../../src/lib/previews/records";
import { cacheDirectory } from "../../src/lib/previews/storage";
import { resolveCloneUrl } from "../../src/lib/repositories/registration";
import { type Repository, findRepositoryByCanonicalUrl, getRepository, insertRepository } from "../../src/lib/repositories/repository-records";
import { SourceBoundary } from "../../src/lib/repositories/source-boundary";
import { routes } from "../../src/lib/web/routes";
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
 * onboards it as the application Orders portal through the application
 * records and pipeline (src/lib/applications): preparation, its survey, the
 * eligibility check, then `npm ci` and `vite build`, served under /previews/,
 * and a screenshot of the current build. The remote also has a
 * `feature/new-nav` branch, which changes the navigation's text, and a
 * `v1.1.0` tag on a release commit of its own, for saved previews
 * (restore-toolbar-tools-and-branch-previews, task 3.7). Packages come from the public npm
 * registry the first time and from the package cache kept under the e2e
 * storage directory after that, so later runs install offline. Onboarding's
 * pages (tasks 5.x) aren't involved: `buildOrdersPortal` calls what their
 * Create does.
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

/** Replaces +remote+ with the fixture sources at +source+ committed on main, as +message+, and returns its head commit. */
export function fixtureRemote(source: string, remote: string, message: string): string {
  fs.rmSync(remote, { recursive: true, force: true });
  copySources(source, remote);
  git(remote, ["init", "--quiet", "-b", "main"]);
  git(remote, ["add", "--all"]);
  git(remote, ["commit", "--quiet", "-m", message]);
  return git(remote, ["rev-parse", "HEAD"]).trim();
}

/** The navigation's brand text on main, and on `feature/new-nav` and `v1.1.0`. */
export const ORDERS_PORTAL_BRANDS = { main: "Orders portal", feature: "Orders portal · New navigation", release: "Orders portal 1.1" } as const;

/**
 * Replaces the remote with the fixture's sources committed on main, with
 * `feature/new-nav` changing the navigation's text and the tag `v1.1.0` on a
 * release commit of its own, and returns main's head commit.
 */
export function ordersPortalRemote(): string {
  fixtureRemote(SOURCE, ORDERS_PORTAL_REMOTE, "Orders portal");
  const brand = (text: string) => (app: string) => app.replace(`<p className="brand">${ORDERS_PORTAL_BRANDS.main}</p>`, `<p className="brand">${text}</p>`);
  commitToOrdersPortal({ "src/app.jsx": brand(ORDERS_PORTAL_BRANDS.feature) }, { branch: "feature/new-nav", message: "New navigation" });
  const release = commitToOrdersPortal({ "src/app.jsx": brand(ORDERS_PORTAL_BRANDS.release) }, { branch: "release/1.1", message: "Release 1.1" });
  git(ORDERS_PORTAL_REMOTE, ["tag", "v1.1.0", release]);
  return git(ORDERS_PORTAL_REMOTE, ["rev-parse", "HEAD"]).trim();
}

/** Commits +change+ to +remote+, on +branch+ (created from main when it's new), and returns the commit. */
export function commitToRemote(remote: string, change: FixtureChange, options: { branch?: string; message?: string } = {}): string {
  const branch = options.branch ?? "main";
  const branches = git(remote, ["branch", "--format=%(refname:short)"]).split("\n");
  git(remote, branches.includes(branch) ? ["checkout", "--quiet", branch] : ["checkout", "--quiet", "-b", branch, "main"]);
  applyChange(remote, change);
  git(remote, ["add", "--all"]);
  git(remote, ["commit", "--quiet", "-m", options.message ?? "Change the fixture"]);
  const commit = git(remote, ["rev-parse", "HEAD"]).trim();
  git(remote, ["checkout", "--quiet", "main"]);
  return commit;
}

/** Commits +change+ to the remote, on +branch+ (created from main when it's new), and returns the commit. */
export function commitToOrdersPortal(change: FixtureChange, options: { branch?: string; message?: string } = {}): string {
  return commitToRemote(ORDERS_PORTAL_REMOTE, change, { message: "Change the orders portal", ...options });
}

/** The Repository for +remote+, registered as +name+ on first use like any other. */
export function fixtureRepository(db: Db, remote: string, name: string): Repository {
  const resolved = resolveCloneUrl(`file://${remote}`, new SourceBoundary(serverConfig()));
  return findRepositoryByCanonicalUrl(db, resolved.canonicalUrl) ?? insertRepository(db, { name, ...resolved, gitRef: null });
}

/** The Repository for the remote, registered on first use like any other. */
export function ordersPortalRepository(db: Db): Repository {
  return fixtureRepository(db, ORDERS_PORTAL_REMOTE, "orders-portal");
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

/**
 * Builds the remote's +ref+ (its default branch unless named) as a plain
 * repository preview, through preparation and the build, and fails unless it
 * is Ready. Call `ordersPortalRemote` first.
 */
export async function previewOrdersPortal(db: Db, options: { ref?: string } = {}): Promise<PreviewBuild> {
  const repository = ordersPortalRepository(db);
  linkKeptPackageCache();
  const preparation = await requestPreparation(db, repository.publicId, { kind: "ref", name: options.ref ?? null }, { config: serverConfig() });
  await settle(db);
  const preview = db.select().from(previewBuilds).where(eq(previewBuilds.preparationId, preparation.id)).orderBy(desc(previewBuilds.id)).get();
  if (!preview || preview.attemptState !== "ready") throw new Error(`The orders portal didn't build: ${preview ? `${preview.attemptState}, ${preview.attemptReason}` : "no preview was started"}.`);
  return preview;
}

/** The orders portal as an application, with its current build. */
export interface FixtureApplication {
  readonly repository: Repository;
  readonly application: Application;
  /** Its current build. */
  readonly preview: PreviewBuild;
  /** Where its current build is served: `/previews/<preview>/`. */
  readonly base: string;
}

export const ORDERS_PORTAL_NAME = "Orders portal";

/** The application at +slug+ as it stands, with its current build, failing unless it's Ready with a screenshot. */
export function readyApplication(db: Db, slug: string): FixtureApplication {
  const application = getApplication(db, slug);
  if (application.status !== "ready" || !application.current) throw new Error(`${application.name} isn't Ready: ${application.status}, ${application.latest.reasons.map((reason) => reason.text).join(" ")}`);
  if (!application.screenshot) throw new Error(`${application.name} has no screenshot of its current build`);
  const preview = db.select().from(previewBuilds).where(eq(previewBuilds.publicId, application.current.preview)).get()!;
  return { repository: getRepository(db, application.repository.publicId), application, preview, base: `/previews/${preview.publicId}/` };
}

/**
 * Onboards the remote's main branch as the application Orders portal, as
 * onboarding's pages do: checks the branch's commit (prepareBranch), which
 * decides it can be previewed, then creates the application from that
 * preparation with the operator's trust confirmed, which enrolls the remote
 * and starts the first build. Settles every job, so it returns the
 * application Ready, with its current build and its screenshot. Call
 * `ordersPortalRemote` first.
 */
export async function buildOrdersPortal(db: Db, options: { name?: string } = {}): Promise<FixtureApplication> {
  return onboardFixture(db, ordersPortalRepository(db), { name: options.name ?? ORDERS_PORTAL_NAME, description: "Accounts, orders, and settings for the orders team." });
}

/**
 * Onboards +repository+'s main branch as an application named +name+, as
 * onboarding's pages do, and settles every job, so it returns the
 * application Ready, with its current build and its screenshot.
 */
export async function onboardFixture(db: Db, repository: Repository, details: { name: string; description: string }): Promise<FixtureApplication> {
  const config = serverConfig();
  linkKeptPackageCache();
  const preparation = await prepareBranch(db, repository.publicId, "main", { config });
  await settle(db);
  const created = createApplication(db, { repository: repository.publicId, branch: "main", packageDir: ".", preparation: preparation.publicId, ...details, trusted: true }, config);
  await settle(db);
  return readyApplication(db, created.slug);
}

/**
 * Builds the head of +application+'s tracked branch, as the automatic check
 * does after a push, and returns it once that build is current. Commit to the
 * remote first with `commitToOrdersPortal`.
 */
export async function rebuildOrdersPortal(db: Db, application: Pick<Application, "publicId" | "slug">): Promise<FixtureApplication> {
  linkKeptPackageCache();
  await buildApplication(db, application.publicId, { config: serverConfig() });
  await settle(db);
  return readyApplication(db, application.slug);
}

/**
 * Saves a preview of the Orders portal's +ref+, such as `refs/heads/feature/new-nav`,
 * as New preview's Create preview does, and settles every job, so it returns
 * the saved preview Ready, with its screenshot. Build the application first.
 */
export async function saveOrdersPortalPreview(db: Db, ref: string, options: { slug?: string } = {}): Promise<SavedPreview> {
  const application = getApplication(db, options.slug ?? "orders-portal");
  linkKeptPackageCache();
  const { saved } = await createSavedPreview(db, application.publicId, { ref }, { config: serverConfig() });
  await settle(db);
  const ready = findSavedPreview(db, application.publicId, saved.key)!;
  if (ready.status !== "ready" || !ready.current) throw new Error(`${ready.label} isn't Ready: ${ready.status}, ${ready.latest.reasons.map((reason) => reason.text).join(" ")}`);
  if (!ready.screenshot) throw new Error(`${ready.label} has no screenshot of its current build`);
  return ready;
}

/** The application's running address at +route+: its current build under the toolbar. */
export function framedRun(build: { application: Pick<Application, "slug"> }, route = "/"): string {
  return routes.runningApplication(build.application.slug, route);
}
