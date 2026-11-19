import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { paths } from "./support/paths";
import { seedOperatorSurfaces } from "./support/surfaces";
import { useTheme } from "./support/shell";

/**
 * The link check (operator-interface/page-patterns spec, "Every link opens the
 * page it names"), the interface vocabulary (content standard), and the
 * primary-action rule (design-system spec). It crawls every operator page from
 * each section's landing page, with JavaScript disabled, so it checks what the
 * server renders on first paint.
 */

// The server-rendered page, as a visitor without JavaScript sees it first.
test.use({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });

// The component gallery exists only in development and test builds (design-system spec).
const START = [paths.home, paths.assessments, "/templates", ...(process.env.E2E_PRODUCTION ? [] : ["/design-system"])];
/** Model terms the interface never shows as record names (content standard, "Vocabulary"). */
const MODEL_TERMS = [/\bInitiatives?\b/, /\bSources?\b/, /\bAssessment #\d/];
/** Old product names the interface never shows, in any case (content standard, "Product names"). Code elements are exempt. */
const OLD_PRODUCT_NAMES = [/\bde fablab\b/i, /\bfablab\b/i, /\bfabricate\b/i, /\brepo[-_ ]?facts\b/i, /\bdetector releases?\b/i];
const VOCABULARY = [...MODEL_TERMS, ...OLD_PRODUCT_NAMES];
/** Pages per route shape; records of the same kind share one shape. */
const PER_SHAPE = 2;

/** A route's shape: IDs and template slugs become placeholders. */
function shape(url: string): string {
  const [pathname] = url.split("?");
  const segments = pathname!.split("/").map((segment) => (/^[a-z]{2,4}_[a-z0-9]{6,}$/.test(segment) ? ":id" : segment));
  if (segments[1] === "templates" && segments[2]) segments[2] = ":slug";
  return segments.join("/");
}

/**
 * How many sentences +text+ has: each ends in a stop before a capital or the
 * end, so "v1.2", "e.g. a", and the initials in "J.P. Morgan" don't end one
 * (content standard, "Descriptions").
 */
function sentences(text: string): number {
  return text ? (text.match(/(?<!\b[A-Z])[.!?](?=\s+[A-Z]|$)/g) ?? []).length || 1 : 0;
}

/** Internal links worth following: pages, not fragments, API routes, or running applications' own routes. */
function followable(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/api/") && !href.startsWith("/_next/") && !href.startsWith("#");
}

/** What a page shows: its status, title, heading, links, and the text outside code and repository content. */
async function inspect(page: Page) {
  return page.evaluate(() => {
    const skipped = "pre, code, kbd, samp, textarea, script, style, [hidden], [aria-hidden='true']";
    // A filter callback can't run while page scripts are disabled, so the walk filters as it goes.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const text: string[] = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest(skipped)) text.push(walker.currentNode.textContent ?? "");
    for (const element of document.querySelectorAll("[aria-label], [title]")) text.push(element.getAttribute("aria-label") ?? "", element.getAttribute("title") ?? "");
    return {
      title: document.title,
      heading: document.querySelector("h1")?.textContent?.trim() ?? "",
      description: document.querySelector("[data-header-description]")?.textContent?.trim() ?? "",
      links: [...document.querySelectorAll("a[href]")].map((anchor) => ({ href: anchor.getAttribute("href")!, label: (anchor.getAttribute("aria-label") ?? anchor.textContent ?? "").trim() })),
      text: text.join(" "),
    };
  });
}

/** Primary actions whose fill isn't the primary color resolved where they sit. */
async function unfilledPrimaries(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-variant="primary"]')].flatMap((element) => {
      const probe = document.createElement("span");
      probe.style.background = "var(--color-primary)";
      element.parentElement!.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const actual = getComputedStyle(element).backgroundColor;
      return actual === expected ? [] : [`${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim()}: ${actual}, not ${expected}`];
    }),
  );
}

/**
 * Opens each page from `start`, follows links up to `depth` hops away, at most
 * PER_SHAPE pages of each route shape, and records every page that doesn't
 * open or breaks the vocabulary. Returns the operator pages it read.
 */
async function crawl(page: Page, start: string[], depth: number, problems: string[]): Promise<string[]> {
  const queue = start.map((url) => ({ url, hops: 0 }));
  const seen = new Set<string>();
  const shapes = new Map<string, number>();
  const linkedFrom = new Map<string, string>();
  const visited: string[] = [];

  while (queue.length) {
    const { url, hops } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const response = await page.goto(url);
    const status = response?.status() ?? 0;
    const from = linkedFrom.get(url) ?? "a start page";
    // Running applications are application content: check only that they open.
    if (url.startsWith("/run/") || url.startsWith("/s/")) {
      if (status >= 400) problems.push(`${url} (from ${from}) answered ${status}`);
      continue;
    }
    const found = await inspect(page);
    if (status >= 400 || /not found|not available/i.test(found.heading)) problems.push(`${url} (from ${from}) is not found: ${status} "${found.heading}"`);
    for (const pattern of VOCABULARY) {
      const match = pattern.exec(`${found.title} ${found.text}`);
      if (match) problems.push(`${url} shows "${match[0]}"`);
    }
    if (sentences(found.description) > 1) problems.push(`${url}'s description has ${sentences(found.description)} sentences: "${found.description}"`);
    visited.push(url);
    if (hops >= depth) continue;
    for (const { href, label } of found.links) {
      const target = href.split("#")[0]!;
      if (!followable(href) || !target || seen.has(target)) continue;
      const count = shapes.get(shape(target)) ?? 0;
      if (count >= PER_SHAPE) continue;
      shapes.set(shape(target), count + 1);
      linkedFrom.set(target, `${url} · "${label}"`);
      queue.push({ url: target, hops: hops + 1 });
    }
  }
  return visited;
}

/** Records every primary action on `urls` without the primary fill, in both themes, as a visitor with `context`'s cookies sees it. */
async function checkPrimaries(browser: Browser, context: BrowserContext, baseURL: string, urls: string[], problems: string[]) {
  // Against a production build (E2E_PRODUCTION=1, tasks 9.3) this runs without
  // JavaScript, so it checks the first paint. `next dev` serves component
  // stylesheets to a page without JavaScript unreliably, so a dev run checks
  // the hydrated page instead.
  const firstPaint = Boolean(process.env.E2E_PRODUCTION);
  const checker = await browser.newContext({ javaScriptEnabled: !firstPaint, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await checker.addCookies(await context.cookies());
  const checking = await checker.newPage();
  for (const theme of ["light", "dark"] as const) {
    await useTheme(checker, theme, baseURL);
    for (const url of urls) {
      await checking.goto(url);
      for (const problem of await unfilledPrimaries(checking)) problems.push(`${url} (${theme}): ${problem}`);
    }
  }
  await checker.close();
}

test("every link opens a page, every page uses the interface vocabulary, and every primary action has the primary fill", async ({ browser, page, context, db, sourcesDir, baseURL }) => {
  test.setTimeout(900_000);
  await seedOperatorSurfaces(db, sourcesDir);

  const problems: string[] = [];
  const visited = await crawl(page, START, Infinity, problems);
  expect(visited.length, "the crawl reaches every section").toBeGreaterThan(40);
  await checkPrimaries(browser, context, baseURL!, visited, problems);
  expect(problems).toEqual([]);
});
