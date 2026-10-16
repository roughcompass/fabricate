import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { HOSTED_PATH, HOSTED_ROOT } from "./env";

// prototypes/availability spec, "The hosted profile runs Prototypes without
// local Git or SQLite": the server started with no git on its path.

test("has no git on the server's path", () => {
  expect(() => execFileSync("/usr/bin/env", ["git", "--version"], { env: { ...process.env, PATH: HOSTED_PATH }, stdio: "pipe" })).toThrow();
});

test("serves Prototypes, shows only its section, and answers not found elsewhere (Starting on Vercel)", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/prototypes$/);
  await expect(page.getByRole("heading", { level: 1, name: "Prototypes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Personas" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Assessments" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Salt Patterns" })).toHaveCount(0);
  // Switcher absent without Web Onboarding: the product mark and name, and no Portal switcher.
  await expect(page.locator("#sidebar").getByRole("link", { name: "DE FabLab home" })).toHaveText("DE FabLab");
  await expect(page.getByRole("button", { name: /^Switch Portal/ })).toHaveCount(0);

  for (const address of ["/assessments", "/repositories", "/templates", "/applications", "/onboarding"]) expect((await page.request.get(address)).status(), address).toBe(404);
  await page.goto("/prototypes/new");
  await expect(page.getByLabel("Intent")).toBeVisible();
  // Nothing opened the SQLite database.
  expect(fs.existsSync(path.join(HOSTED_ROOT, "no-sqlite"))).toBe(false);
});

test("generates, previews, and keeps a variant without loading SQLite (Starting on Vercel)", async ({ page }) => {
  await page.goto("/prototypes/new");
  await page.getByLabel("Intent").fill("Review and release today's urgent payments before cut-off");
  await page.getByRole("group", { name: "Variants" }).getByLabel("1", { exact: true }).check();
  await page.getByRole("button", { name: "Generate" }).click();
  await page.waitForURL(/\/prototypes\/generations\/gen_[a-z0-9]{16}/);
  await expect(page.locator("[data-prototype-variant][data-status=running]")).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator("iframe[data-prototype-frame]:not([aria-hidden])").first()).toHaveAttribute("data-ready", "", { timeout: 30_000 });
  await page.getByRole("button", { name: "Keep" }).click();
  const kept = page.locator("[data-prototype-variant]").getByRole("link").first();
  await expect(kept).toBeVisible();
  // The seeded examples and the one kept.
  await page.goto("/prototypes");
  await expect(page.locator("[data-prototype]")).toHaveCount(5);
  // Accept isn't offered where there's no gallery to publish to.
  await page.goBack();
  await page.locator("[data-prototype-variant]").getByRole("link").first().click();
  await page.waitForURL(/\/prototypes\/pro_[a-z0-9]{16}/);
  await expect(page.getByRole("button", { name: /^Fork/ })).toBeVisible();
  await expect(page.getByText("Accept as template")).toHaveCount(0);
});
