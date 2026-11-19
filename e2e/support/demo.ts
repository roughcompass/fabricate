import { createRequire } from "node:module";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { itemById } from "../../src/components/toolbar/toolbar-context";
import type { Db } from "../../src/lib/db/client";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "../../src/lib/demo/workspace-key";
import { ensureWorkspace, setHints } from "../../src/lib/demo/workspaces";
import { expect } from "./fixtures";

/** Helpers for the template demo's running applications. */

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");

/** The automated rules the toolbar's audit runs: WCAG 2 A and AA. */
const AUDIT_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export interface AuditViolation {
  id: string;
  members: string[];
}

/** Waits until every microfrontend region on the page has finished loading. */
export async function waitForRegions(page: Page): Promise<void> {
  await expect(page.locator("[data-demo-mfe]").first()).toBeVisible();
  await expect(page.locator('[data-demo-mfe]:not([data-demo-state="ready"])')).toHaveCount(0, { timeout: 10_000 });
}

/** Stores a view's theme, session profile, and overrides in the browser, as the toolbar would, then reloads. */
export async function setView(page: Page, view: { theme?: "light" | "dark"; profileId?: string; overrides?: Record<string, { version: string; environment: string }> }): Promise<void> {
  const key = await page.locator("[data-demo-view-key]").getAttribute("data-demo-view-key");
  await page.evaluate(
    ([storageKey, value]) => window.localStorage.setItem(storageKey!, value!),
    [`frontend-registry-demo:${key}:view`, JSON.stringify({ theme: "light", profileId: "analyst", overrides: {}, ...view })],
  );
  await page.reload();
  await waitForRegions(page);
}

/**
 * Runs the automated accessibility audit on the running application, as the
 * toolbar does, and on +also+: selectors for open overlays Salt renders
 * outside the application root. An open Salt menu adds Floating UI's focus
 * guards beside its trigger, hidden spans that pass focus on and are never
 * content, so they are left out.
 */
export async function audit(page: Page, also: string[] = []): Promise<AuditViolation[]> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: AXE });
  return page.evaluate(async ([tags, extra]) => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run({ include: [["[data-demo-app-root]"], ...extra.map((selector) => [selector])], exclude: [["[data-demo-toolbar]"], ["[data-floating-ui-focus-guard]"]] }, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return result.violations.map((violation) => ({
      id: violation.id,
      members: [...new Set(violation.nodes.map((node) => document.querySelector(node.target[0]!)?.closest("[data-demo-mfe]")?.getAttribute("data-demo-mfe") ?? "shell"))].sort(),
    }));
  }, [AUDIT_TAGS, also] as const);
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

const menuDialog = (page: Page) => page.getByRole("dialog", { name: "Toolbar", exact: true });

/** Opens the toolbar menu from the pill. */
export async function openToolbarMenu(page: Page) {
  if (await menuDialog(page).isVisible()) return menuDialog(page);
  await page.getByRole("button", { name: /^Open toolbar menu/ }).click();
  await expect(menuDialog(page)).toBeVisible();
  return menuDialog(page);
}

/** Opens a toolbar item through the menu, as a visitor would: "accessibility", "session", "comments", and so on. */
export async function openTool(page: Page, id: string) {
  const item = itemById(id);
  if (!item) throw new Error(`No toolbar item ${id}`);
  const menu = await openToolbarMenu(page);
  await menu.getByRole("option", { name: new RegExp(`^${item.name}( |,|$)`) }).click();
  await expect(menuDialog(page)).toBeHidden();
}

/** Starts comment mode through the menu. */
export async function startComment(page: Page) {
  await openTool(page, "comment");
  await expect(page.getByText("Choose any element to comment on it. Press Esc to cancel.")).toBeVisible();
}

/**
 * Asserts that nothing overlays the toolbar: the point at the center of every
 * visible toolbar control belongs to the controls themselves. A control
 * partly scrolled out of a panel counts only by the part its panel shows.
 */
export async function expectToolbarOnTop(page: Page): Promise<void> {
  const covered = await page.evaluate(() => {
    const controls = document.querySelector('[data-demo-toolbar="controls"]');
    if (!controls) return ["no toolbar controls"];
    const visibleBox = (element: HTMLElement) => {
      let { left, top, right, bottom } = element.getBoundingClientRect();
      for (let parent = element.parentElement; parent && parent !== controls; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflow === "visible") continue;
        const clip = parent.getBoundingClientRect();
        left = Math.max(left, clip.left);
        top = Math.max(top, clip.top);
        right = Math.min(right, clip.right);
        bottom = Math.min(bottom, clip.bottom);
      }
      return { left, top, width: right - left, height: bottom - top };
    };
    const targets = [...controls.querySelectorAll<HTMLElement>("button, a[href], input, [role='option'], [role='dialog']")].filter((element) => {
      const box = visibleBox(element);
      return box.width > 0 && box.height > 0;
    });
    return targets.flatMap((element) => {
      const box = visibleBox(element);
      const x = Math.min(Math.max(box.left + box.width / 2, 0), window.innerWidth - 1);
      const y = Math.min(Math.max(box.top + box.height / 2, 0), window.innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      return hit && controls.contains(hit) ? [] : [`${element.tagName.toLowerCase()} "${element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30)}" is covered by ${hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).split(" ")[0]}` : "nothing"}`];
    });
  });
  expect(covered, "toolbar controls covered").toEqual([]);
}
