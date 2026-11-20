import path from "node:path";
import type { Db } from "../../src/lib/db/client";
import { type BuildComposition, buildComposition } from "../../src/lib/applications/composition";
import { createSavedPreview } from "../../src/lib/applications/pipeline";
import { type SavedPreview, findSavedPreview } from "../../src/lib/applications/saved-previews";
import { storeEntry } from "../../src/lib/catalog/entries";
import { saltEntry } from "../../test/support/catalog";
import { E2E_PREVIEW_SOURCES } from "./env";
import { type FixtureApplication, commitToRemote, fixtureRemote, fixtureRepository, onboardFixture, settle } from "./fixture-app";
import { serverConfig } from "./results";

/*
 * The microfrontend fixtures (restore-toolbar-tools-and-branch-previews,
 * design decision 13, task 5.3): test/fixtures/apps/quotes-desk, a Module
 * Federation host and single-spa root configuration built with Rspack, which
 * renders Salt, has an import map, and dispatches window events; and
 * test/fixtures/apps/quotes-panel, the remote it names, which exposes
 * ./Quotes and copies a single-spa ticker into its output.
 *
 * Setup turns each into a local Git repository at its own remote, commits
 * feature/blue-quotes to Quotes panel and feature/dark-blotter to Quotes
 * desk, and onboards both through the application pipeline, as
 * `buildOrdersPortal` does for Orders portal, with packages from the kept
 * package cache, then saves a preview of each branch. Salt's Reference
 * Catalog entry is stored first, so the surveys recognize Salt and its
 * provider.
 *
 * As built, Quotes desk loads quotesPanel from 127.0.0.1:9311 and its ticker
 * from 127.0.0.1:9312, where nothing listens, so it shows "Quotes
 * unavailable" and "Ticker unavailable" until Microfrontends routes them.
 */

const SOURCES = path.resolve("test/fixtures/apps");

export const QUOTES_DESK_REMOTE = path.join(E2E_PREVIEW_SOURCES, "quotes-desk");
export const QUOTES_PANEL_REMOTE = path.join(E2E_PREVIEW_SOURCES, "quotes-panel");

export const QUOTES_DESK_NAME = "Quotes desk";
export const QUOTES_PANEL_NAME = "Quotes panel";

/** The branches setup commits: Quotes panel's renames its heading and ticker, and Quotes desk's renames the blotter. */
export const BLUE_QUOTES = "feature/blue-quotes";
export const DARK_BLOTTER = "feature/dark-blotter";

export interface QuotesCommits {
  readonly desk: string;
  readonly panel: string;
  readonly blueQuotes: string;
  readonly darkBlotter: string;
}

/** Replaces both remotes with the fixtures' sources committed on main, and commits each feature branch. */
export function quotesRemotes(): QuotesCommits {
  const desk = fixtureRemote(path.join(SOURCES, "quotes-desk"), QUOTES_DESK_REMOTE, "Quotes desk");
  const panel = fixtureRemote(path.join(SOURCES, "quotes-panel"), QUOTES_PANEL_REMOTE, "Quotes panel");
  const blueQuotes = commitToRemote(
    QUOTES_PANEL_REMOTE,
    {
      "src/Quotes.jsx": (source) => source.replace(">Quotes panel</h2>", ">Blue quotes panel</h2>"),
      "src/ticker.js": (source) => source.replace('"Ticker: ', '"Blue ticker: '),
    },
    { branch: BLUE_QUOTES, message: "Blue quotes" },
  );
  const darkBlotter = commitToRemote(QUOTES_DESK_REMOTE, { "src/app.jsx": (source) => source.replace("<h1>Blotter</h1>", "<h1>Dark blotter</h1>") }, { branch: DARK_BLOTTER, message: "Dark blotter" });
  return { desk, panel, blueQuotes, darkBlotter };
}

export interface QuotesApplications {
  readonly desk: FixtureApplication;
  readonly panel: FixtureApplication;
  readonly commits: QuotesCommits;
  /** The saved previews of feature/blue-quotes and feature/dark-blotter, Ready, unless setup was asked not to save them. */
  readonly blueQuotes: SavedPreview | null;
  readonly darkBlotter: SavedPreview | null;
}

/** Saves a preview of +branch+ of +build+'s application and settles its build, failing unless it's Ready. */
async function savePreview(db: Db, build: FixtureApplication, branch: string): Promise<SavedPreview> {
  const { saved } = await createSavedPreview(db, build.application.publicId, { ref: `refs/heads/${branch}` }, { config: serverConfig() });
  await settle(db);
  const ready = findSavedPreview(db, build.application.publicId, saved.key)!;
  if (ready.status !== "ready" || !ready.current) throw new Error(`The saved preview of ${branch} isn't Ready: ${ready.status}`);
  return ready;
}

/**
 * Fresh remotes for both fixtures, onboarded as the applications Quotes
 * panel and Quotes desk, each Ready with its current build of main and its
 * screenshot, and, unless +saved+ is false, with a saved preview of its
 * feature branch.
 */
export async function buildQuotes(db: Db, options: { saved?: boolean } = {}): Promise<QuotesApplications> {
  const commits = quotesRemotes();
  storeEntry(db, saltEntry());
  const panel = await onboardFixture(db, fixtureRepository(db, QUOTES_PANEL_REMOTE, "quotes-panel"), { name: QUOTES_PANEL_NAME, description: "Live quotes, as a Module Federation remote and a single-spa ticker." });
  const desk = await onboardFixture(db, fixtureRepository(db, QUOTES_DESK_REMOTE, "quotes-desk"), { name: QUOTES_DESK_NAME, description: "A trading desk that composes the quotes panel and its ticker." });
  if (options.saved === false) return { desk, panel, commits, blueQuotes: null, darkBlotter: null };
  const blueQuotes = await savePreview(db, panel, BLUE_QUOTES);
  const darkBlotter = await savePreview(db, desk, DARK_BLOTTER);
  return { desk, panel, commits, blueQuotes, darkBlotter };
}

/** What the Profile of +build+'s current commit says it's composed of. */
export function quotesComposition(db: Db, build: FixtureApplication): BuildComposition {
  return buildComposition(db, build.preview.publicId, build.application.packageDir);
}
