import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { type Db, openDatabase } from "../../src/lib/db/client";
import { WORKSPACE_COOKIE, newWorkspaceKey } from "../../src/lib/demo/workspace-key";
import { ensureWorkspace, setHints } from "../../src/lib/demo/workspaces";
import { git } from "../../test/support/git-fixture";
import { E2E_DATABASE, E2E_SOURCES } from "./env";

export { expect };

interface Fixtures {
  /** A connection to the server's database, for seeding and assertions. */
  db: Db;
  /** A fresh directory under the server's allowed source root. */
  sourcesDir: string;
  /** Fails the test on any page error or hydration error it did not expect. */
  errorGuard: void;
}

interface Options {
  /** Page and console errors a test provokes on purpose. */
  expectedErrors: RegExp[];
  /**
   * Whether the template demo's guided hints show. They are off unless a test
   * turns them on, so that hints never cover what other tests use: the browser
   * starts with a demo workspace whose hints are turned off.
   */
  guidedHints: boolean;
}

/**
 * Every test starts from an empty database and its own source directory, and
 * fails if the page throws an uncaught error or React reports a hydration or
 * list-key error.
 */
export const test = base.extend<Fixtures & Options>({
  expectedErrors: [[], { option: true }],
  guidedHints: [false, { option: true }],
  errorGuard: [
    async ({ page, expectedErrors }, provide) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`page error: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        if (/hydrat/i.test(message.text())) errors.push(`hydration error: ${message.text().slice(0, 400)}`);
        else if (/same key|unique "key"/i.test(message.text())) errors.push(`key error: ${message.text().slice(0, 400)}`);
      });
      await provide();
      expect(errors.filter((error) => !expectedErrors.some((pattern) => pattern.test(error))), "page, hydration, and key errors").toEqual([]);
    },
    { auto: true },
  ],
  db: async ({ request, context, baseURL, guidedHints }, provide) => {
    // A production build has no reset route (src/lib/testing/e2e.ts). Its specs
    // (E2E_PRODUCTION=1) run against a server started on a fresh database and
    // share it, so they seed records that don't depend on an empty catalog.
    if (!process.env.E2E_PRODUCTION) {
      const response = await request.post("/api/test/reset");
      expect(response.status(), "the e2e server must run with FRONTEND_REGISTRY_E2E=1").toBe(200);
    }
    const db = openDatabase(E2E_DATABASE);
    if (!guidedHints) {
      const key = newWorkspaceKey();
      setHints(db, ensureWorkspace(db, key).id, { off: true });
      await context.addCookies([{ name: WORKSPACE_COOKIE, value: key, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
    }
    await provide(db);
    db.$client.close();
  },
  sourcesDir: async ({ db: _db }, provide) => {
    const directory = path.join(E2E_SOURCES, crypto.randomBytes(4).toString("hex"));
    fs.mkdirSync(directory, { recursive: true });
    await provide(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  },
});

/** Creates a committed Git working tree. */
export function gitRepo(directory: string, files: Record<string, string> = { "README.md": "fixture\n" }): string {
  fs.mkdirSync(directory, { recursive: true });
  git(directory, ["init", "--quiet", "-b", "main"]);
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
    fs.writeFileSync(path.join(directory, relative), content);
  }
  git(directory, ["add", "--all"]);
  git(directory, ["commit", "--quiet", "-m", "fixture"]);
  return directory;
}

/**
 * Fails when the page scrolls sideways, when any element overflows the
 * viewport horizontally, or when text overflows the container that clips it.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflowing = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    // Content that escapes a scroll container's clip, such as an absolutely positioned child, still widens the page.
    const scrolls = document.documentElement.scrollWidth > width + 1 ? [`the page scrolls sideways (${document.documentElement.scrollWidth}px wide)`] : [];
    // An element cut off by an ancestor that clips its overflow, such as a card's angled preview, shows only inside that ancestor.
    const clippedInside = (element: Element) => {
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        if (/hidden|clip/.test(getComputedStyle(node).overflowX) && node.getBoundingClientRect().right <= width + 1) return true;
      }
      return false;
    };
    return scrolls.concat([...document.querySelectorAll("body *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || getComputedStyle(element).position === "fixed") return false;
        if (rect.right > width + 1) return !clippedInside(element);
        // Text wider than its own box is clipped by an ancestor, not wrapped.
        return element.children.length === 0 && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX === "visible";
      })
      // A container meant to scroll sideways: the runtime's own, marked data-scroll-x, and Salt's TableContainer (saltTable-container since Salt 1.75).
      .filter((element) => !element.closest("[data-scroll-x], .saltTable-container"))
      // Visually hidden content (a clipped 1px box) cannot overflow visibly.
      .filter((element) => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (node.getBoundingClientRect().width <= 1 && (style.overflow === "hidden" || style.clipPath !== "none")) return false;
        }
        return true;
      })
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).split(" ").join(".")}`));
  });
  expect(overflowing, "elements overflow the viewport").toEqual([]);
}

/**
 * Fails when the rendered text of two different text nodes, or a form
 * control and text, visibly overlap: the boxes a reader actually sees, not
 * the element boxes that legitimately nest.
 */
export async function expectNoOverlappingContent(page: Page): Promise<void> {
  const overlaps = await page.evaluate(() => {
    const hidden = (element: Element | null) => {
      // A closed <details> renders only its own summary, not the summaries of details nested inside it.
      for (let closed = element?.closest("details:not([open])"); closed; closed = closed.parentElement?.closest("details:not([open])") ?? null) {
        if (!closed.querySelector(":scope > summary")?.contains(element)) return true;
      }
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.visibility === "hidden" || style.display === "none" || style.clipPath !== "none") return true;
      }
      return false;
    };
    // Content scrolled out of a scroll container is clipped, so only the part inside its visible area counts.
    const visible = (element: Element | null, rect: DOMRect) => {
      let { left, top, right, bottom } = rect;
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        const clip = node.getBoundingClientRect();
        if (style.overflowX !== "visible") [left, right] = [Math.max(left, clip.left), Math.min(right, clip.right)];
        if (style.overflowY !== "visible") [top, bottom] = [Math.max(top, clip.top), Math.min(bottom, clip.bottom)];
      }
      return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
    };
    // A sticky or fixed element, such as a save bar, floats over scrolled content by design; only its own contents are compared.
    const layer = (element: Element | null) => {
      for (let node = element; node; node = node.parentElement) if (["sticky", "fixed"].includes(getComputedStyle(node).position)) return node;
      return null;
    };
    const boxes: { label: string; owner: Node; layer: Element | null; rect: DOMRect }[] = [];
    const add = (label: string, owner: Node, element: Element | null, rect: DOMRect) => {
      const clipped = visible(element, rect);
      if (clipped.width > 1 && clipped.height > 1) boxes.push({ label, owner, layer: layer(element), rect: clipped });
    };
    const walker = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (!text || hidden(node.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) add(text.slice(0, 40), node, node.parentElement, rect);
    }
    for (const control of document.querySelectorAll("main input:not([type=hidden]), main select, main textarea")) {
      if (!hidden(control)) add(`<${control.tagName.toLowerCase()} ${control.getAttribute("name") ?? ""}>`, control, control.parentElement, control.getBoundingClientRect());
    }
    const found: string[] = [];
    for (let i = 0; i < boxes.length && found.length < 5; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.layer !== b.layer || a.owner === b.owner || a.owner.contains(b.owner) || b.owner.contains(a.owner)) continue;
        const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        if (x > 2 && y > 2) found.push(`"${a.label}" overlaps "${b.label}"`);
      }
    }
    return found.slice(0, 5);
  });
  expect(overlaps, "content overlaps").toEqual([]);
}

/**
 * Fails when a bordered container sits inside another (design system: panels
 * never nest). A container is a block element with all four borders that holds
 * other elements; controls, labels, chips (even wrapped onto two lines), and
 * small decorative circles are not containers.
 */
export async function expectNoNestedBorders(page: Page): Promise<void> {
  const nested = await page.evaluate(() => {
    const container = (element: Element) => {
      if (element.childElementCount === 0 || element.matches("input, select, textarea, button, a, label, dialog, code, kbd, img, svg, svg *, [popover]")) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.display.startsWith("inline") || style.display === "contents") return false;
      const bordered = ["top", "right", "bottom", "left"].every((side) => Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 && style.getPropertyValue(`border-${side}-style`) !== "none");
      const rect = element.getBoundingClientRect();
      return bordered && rect.width >= 64 && rect.height >= 32;
    };
    const boxes = [...(document.querySelector("main")?.querySelectorAll("*") ?? [])].filter(container);
    return boxes
      .filter((box) => boxes.some((other) => other !== box && other.contains(box)))
      .slice(0, 5)
      .map((box) => `${box.tagName.toLowerCase()}.${String(box.className).split(" ")[0]} in ${String(boxes.find((other) => other !== box && other.contains(box))!.className).split(" ")[0]}`);
  });
  expect(nested, "bordered containers nest").toEqual([]);
}
