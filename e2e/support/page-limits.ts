import type { Page } from "@playwright/test";

/**
 * The template limits (operator-interface/page-templates spec, "Template
 * limits are checked"): at most one primary action on a page, three secondary
 * actions in its page header, four facts in its meta row, seven tabs in a set
 * of view tabs, and five figures in a row of key figures. The component
 * gallery's specimens are examples, not the page's own, so they don't count.
 * Returns each limit the page exceeds, named with what it counted.
 */
export function limitViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const own = (element: Element) => !element.closest("[data-specimen]");
    const shown = (element: Element) => element.getClientRects().length > 0;
    const counted = (elements: Iterable<Element>) => [...elements].filter((element) => own(element) && shown(element));
    const problems: string[] = [];

    const primaries = counted(document.querySelectorAll('main [data-variant="primary"]'));
    if (primaries.length > 1) problems.push(`${primaries.length} primary actions: ${primaries.map((element) => (element.getAttribute("aria-label") ?? element.textContent ?? "").trim()).join(", ")}`);

    for (const actions of counted(document.querySelectorAll("[data-page-header] [data-header-actions]"))) {
      // Every visible action but the primary; an overflow menu's trigger holds the rest, so it doesn't count.
      const secondary = counted(actions.querySelectorAll("a, button")).filter((element) => element.getAttribute("data-variant") !== "primary" && !element.hasAttribute("popovertarget") && !element.closest("[popover]"));
      if (secondary.length > 3) problems.push(`${secondary.length} secondary actions in the page header`);
    }

    for (const meta of counted(document.querySelectorAll("[data-page-header] [data-header-meta]"))) {
      const facts = meta.querySelectorAll("[data-meta-item]").length;
      if (facts > 4) problems.push(`${facts} facts in the meta row`);
    }

    for (const tabs of counted(document.querySelectorAll("nav[data-scroll-x]"))) {
      const count = tabs.querySelectorAll(":scope > a").length;
      if (count > 7) problems.push(`${count} tabs in "${tabs.getAttribute("aria-label")}"`);
    }

    for (const row of counted(document.querySelectorAll("[data-key-figures]"))) {
      // A row's own figures: a StatGroup inside a template's figures zone counts its figures itself.
      const figures = [...row.querySelectorAll("[data-key-figure]")].filter((figure) => figure.closest("[data-key-figures]") === row).length;
      if (figures > 5) problems.push(`${figures} key figures in a row`);
    }
    return problems;
  });
}
