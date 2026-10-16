import { type FrameLocator, type Page, expect } from "@playwright/test";
import { buildGate } from "../../src/lib/prototypes/gates";
import type { Scope } from "../../src/lib/prototypes/types";

/**
 * Browser-test support for Prototypes. PGlite allows one process, so tests
 * create data through the server's test routes, never by opening the store.
 */

export interface Fixture {
  readonly name?: string;
  readonly scope: Scope;
  readonly title?: string;
  readonly navItem?: string | null;
  readonly code: string;
  readonly data?: string;
}

/** A prototype at version 1 in the browser's workspace, from code compiled by DE FabLab's own build gate. */
export async function fixturePrototype(page: Page, fixture: Fixture): Promise<{ prototypeId: string; versionId: string }> {
  const { compiled, result } = buildGate({ code: fixture.code, data: fixture.data ?? "export {};\n" });
  expect(compiled, JSON.stringify(result.issues)).not.toBeNull();
  const response = await page.request.post("/api/test/prototypes/fixture", { data: { ...fixture, compiled } });
  expect(response.status()).toBe(201);
  return response.json();
}

/** The visible preview frame; the audit frame is hidden from assistive technology. */
export function previewFrame(page: Page, nth = 0): FrameLocator {
  return page.locator("iframe[data-prototype-frame]:not([aria-hidden])").nth(nth).contentFrame();
}

/** Waits until the visible frame has rendered and reported ready. */
export async function waitForFrame(page: Page, nth = 0): Promise<void> {
  await expect(page.locator("iframe[data-prototype-frame]:not([aria-hidden])").nth(nth)).toHaveAttribute("data-ready", "", { timeout: 30_000 });
}

/** Runs New prototype with the scripted model and waits for every variant to finish. */
export async function generate(page: Page, options: { intent: string; personas?: readonly string[]; scope?: "Page" | "Component"; variants?: number }): Promise<void> {
  await page.goto("/prototypes/new");
  for (const persona of options.personas ?? []) await page.getByLabel(persona).check();
  await page.getByLabel("Intent").fill(options.intent);
  if (options.scope) await page.getByRole("radio", { name: options.scope }).check();
  if (options.variants) await page.getByRole("group", { name: "Variants" }).getByLabel(String(options.variants), { exact: true }).check();
  await page.getByRole("button", { name: "Generate" }).click();
  await page.waitForURL(/\/prototypes\/generations\/gen_[a-z0-9]{16}/);
  await expect(page.locator("[data-prototype-variant][data-status=running]")).toHaveCount(0, { timeout: 60_000 });
}

/** Waits until the version's first accessibility audit is recorded and the page has refreshed, so later steps don't race the refresh. */
export async function waitForAudit(page: Page): Promise<void> {
  // The prototype page marks whether the shown version's audit is recorded; other pages have only the hidden frame.
  // The audit renders a hidden frame, which is slow while the whole suite runs.
  if (await page.locator("[data-version-audit]").count()) await expect(page.locator("[data-version-audit=done]")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator("iframe[data-prototype-frame][aria-hidden]")).toHaveCount(0, { timeout: 60_000 });
}

export const PAYMENTS_INTENT = "Review and release today's urgent payments before cut-off";

/** Generates one variant for the payments approver, keeps it, and opens the prototype. Returns its address. */
export async function keepOne(page: Page, intent = PAYMENTS_INTENT): Promise<string> {
  await generate(page, { intent, personas: ["Maya Lindqvist"], variants: 1 });
  await page.getByRole("button", { name: "Keep" }).click();
  await page.getByRole("link", { name: "Exception-first queue" }).click();
  await page.waitForURL(/\/prototypes\/pro_[a-z0-9]{16}$/);
  return page.url();
}

/** Sends each message in turn on the open prototype, waiting for each version. */
export async function refineEach(page: Page, messages: readonly string[]): Promise<void> {
  for (const message of messages) {
    const next = (await page.locator("[data-version-chip]").count()) + 1;
    await page.getByLabel(/Ask for a change/).fill(message);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator(`[data-version-chip='${next}']`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel(/Ask for a change/)).toBeEnabled({ timeout: 30_000 });
  }
}

/** Accepts the open prototype's version shown as a template, once its audit has run. */
export async function acceptTemplate(page: Page, details: { title: string; description?: string; brand?: string; tags?: string }): Promise<void> {
  await waitForAudit(page);
  await page.getByRole("link", { name: /^Accept as template( v\d+)?$/ }).click();
  await page.getByLabel("Title").fill(details.title);
  await page.getByLabel("Description").fill(details.description ?? "Payments that need action before cut-off lead the queue.");
  await page.getByLabel("Brand").selectOption(details.brand ?? "payments");
  await page.getByLabel("Tags").fill(details.tags ?? "Payments, Approvals");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("[data-capture=done]")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^(Accept as template|Publish next version)$/ }).click();
  await page.waitForURL(/notice=accepted/);
}
