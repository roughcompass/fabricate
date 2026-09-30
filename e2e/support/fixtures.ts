import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { type Db, openDatabase } from "../../src/lib/db/client";
import { git } from "../../test/support/git-fixture";
import { E2E_DATABASE, E2E_SOURCES } from "./env";

export { expect };

interface Fixtures {
  /** A connection to the server's database, for seeding and assertions. */
  db: Db;
  /** A fresh directory under the server's allowed source root. */
  sourcesDir: string;
}

/** Every test starts from an empty database and its own source directory. */
export const test = base.extend<Fixtures>({
  db: async ({ request }, provide) => {
    const response = await request.post("/api/test/reset");
    expect(response.status(), "the e2e server must run with FABRICATE_E2E=1").toBe(200);
    const db = openDatabase(E2E_DATABASE);
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

/** The form error summary (Next.js's route announcer also uses role="alert"). */
export function errorSummary(page: Page) {
  return page.getByRole("alert").filter({ hasText: "Please correct the following" });
}

/**
 * Fails when any element overflows the viewport horizontally, or when text
 * overflows the container that clips it.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflowing = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll("body *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || getComputedStyle(element).position === "fixed") return false;
        if (rect.right > width + 1) return true;
        // Text wider than its own box is clipped by an ancestor, not wrapped.
        return element.children.length === 0 && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX === "visible";
      })
      .filter((element) => !element.closest("[data-scroll-x]"))
      // Visually hidden content (a clipped 1px box) cannot overflow visibly.
      .filter((element) => {
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (node.getBoundingClientRect().width <= 1 && (style.overflow === "hidden" || style.clipPath !== "none")) return false;
        }
        return true;
      })
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).split(" ").join(".")}`);
  });
  expect(overflowing, "elements overflow the viewport").toEqual([]);
}
