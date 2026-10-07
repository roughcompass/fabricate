import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { seedOnboardingSurfaces, seedV1Surfaces } from "./support/onboarding-surfaces";
import type { Surface } from "./support/surfaces";

/*
 * Every Web Onboarding surface, in both themes: no WCAG 2.2 AA violation axe
 * can find, one heading, in the shell header, and a browser title that names
 * the page and where it sits, ends with the product, and never shows a public
 * ID. The links, vocabulary, primary-action, nested-surface, and visual checks
 * reach the current surfaces through the operator surface list. v1 history
 * needs an empty database, so it has its own passes: links, vocabulary, and
 * primary actions in links.spec.ts, and the visual checks in
 * onboarding-portals.spec.ts.
 */

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const PUBLIC_ID = /\b(ptl|wap|sea|mfe|plc|pdc|xrf)_[a-z0-9]{8,}\b/;

for (const [label, seed] of [
  ["every onboarding page", seedOnboardingSurfaces],
  ["v1 history and converted Drafts", seedV1Surfaces],
] as const) {
  test(`passes accessibility checks and names ${label} in its browser title, in both themes`, async ({ page, db, baseURL }) => {
    test.setTimeout(300_000);
    await check(page, baseURL!, seed(db));
  });
}

async function check(page: Page, baseURL: string, surfaces: Surface[]) {
  for (const theme of ["light", "dark"] as const) {
    await page.context().addCookies([{ name: "fabricate-theme", value: theme, url: baseURL }]);
    for (const [name, url] of surfaces) {
      await test.step(`${name}, ${theme}`, async () => {
        await page.goto(typeof url === "string" ? url : url());
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.addScriptTag({ path: AXE });
        const violations = await page.evaluate(async () => {
          const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
          const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] });
          return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).slice(0, 3).join(", ")}`);
        });
        expect(violations, "accessibility violations").toEqual([]);
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.locator("[data-shell-header] h1")).toHaveCount(1);
        const title = await page.title();
        expect(title).toMatch(/^.+ · .+ · DE FabLab$|^.+ · DE FabLab$/);
        expect(title).not.toMatch(PUBLIC_ID);
      });
    }
  }
}
