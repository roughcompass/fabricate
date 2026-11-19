import type { Page } from "@playwright/test";

/**
 * How many sentences +text+ has: each ends in a stop before a capital or the
 * end, so "v1.2", "e.g. a", and the initials in "J.P. Morgan" don't end one
 * (content standard, "Descriptions").
 */
export function sentences(text: string): number {
  return text ? (text.match(/(?<!\b[A-Z])[.!?](?=\s+[A-Z]|$)/g) ?? []).length || 1 : 0;
}

/**
 * Each visible link text on the page that opens more than one page, with the
 * pages it opens. Pagination's and a pager's Previous and Next are relative
 * to their list, and breadcrumbs to the page, so they don't count; fragments
 * of one page are that page.
 */
export async function sharedLinkTexts(page: Page): Promise<string[]> {
  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")]
      .filter((anchor) => !anchor.closest("nav[aria-label$='pages'], nav[aria-label='Breadcrumb'], [hidden], [popover], [data-specimen], details:not([open]) > :not(summary)"))
      .map((anchor) => ({ href: anchor.getAttribute("href")!, label: (anchor.getAttribute("aria-label") ?? anchor.textContent ?? "").trim() })),
  );
  const destinations = new Map<string, Set<string>>();
  for (const { href, label } of links) {
    if (!label || !href.startsWith("/")) continue;
    destinations.set(label, (destinations.get(label) ?? new Set()).add(href.split("#")[0]!));
  }
  return [...destinations].filter(([, hrefs]) => hrefs.size > 1).map(([label, hrefs]) => `"${label}" opens ${[...hrefs].join(", ")}`);
}
