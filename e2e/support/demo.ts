import { createRequire } from "node:module";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { Db } from "../../src/lib/db/client";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "../../src/lib/demo/workspace-key";
import { ensureWorkspace, setHints } from "../../src/lib/demo/workspaces";
import { expect } from "./fixtures";

/** Helpers for the template demo's running applications. */

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");

/** The automated rules the toolbar's audit runs: WCAG 2 A and AA. */
export const AUDIT_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export interface AuditViolation {
  id: string;
  members: string[];
}

/** Waits until every microfrontend region on the page has finished loading. */
export async function waitForRegions(page: Page): Promise<void> {
  await expect(page.locator("[data-demo-mfe]").first()).toBeVisible();
  await expect(page.locator('[data-demo-mfe]:not([data-demo-state="ready"])')).toHaveCount(0, { timeout: 10_000 });
}

/** Stores a view's theme, persona, and overrides in the browser, as the toolbar would, then reloads. */
export async function setView(page: Page, view: { theme?: "light" | "dark"; personaId?: string; overrides?: Record<string, { version: string; environment: string }> }): Promise<void> {
  const key = await page.locator("[data-demo-view-key]").getAttribute("data-demo-view-key");
  await page.evaluate(
    ([storageKey, value]) => window.localStorage.setItem(storageKey!, value!),
    [`fabricate-demo:${key}:view`, JSON.stringify({ theme: "light", personaId: "analyst", overrides: {}, ...view })],
  );
  await page.reload();
  await waitForRegions(page);
}

/** Runs the automated accessibility audit on the running application, as the toolbar does. */
export async function audit(page: Page): Promise<AuditViolation[]> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: AXE });
  return page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run({ include: [["[data-demo-app-root]"]], exclude: [["[data-demo-toolbar]"]] }, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return result.violations.map((violation) => ({
      id: violation.id,
      members: [...new Set(violation.nodes.map((node) => document.querySelector(node.target[0]!)?.closest("[data-demo-mfe]")?.getAttribute("data-demo-mfe") ?? "shell"))].sort(),
    }));
  }, AUDIT_TAGS);
}

/**
 * Another visitor's browser: a fresh context with a demo workspace of its own,
 * with guided hints off like the test's main browser.
 */
export async function visitorContext(browser: Browser, db: Db, baseURL: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL });
  const key = newWorkspaceKey();
  setHints(db, ensureWorkspace(db, key).id, { off: true });
  await context.addCookies([{ name: WORKSPACE_COOKIE, value: key, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
  return context;
}
