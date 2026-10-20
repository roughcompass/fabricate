import type { Page } from "@playwright/test";
import type { Db } from "../../src/lib/db/client";
import { catalogs } from "../../src/lib/experience/catalogs";
import type { Experience } from "../../src/lib/experience/document";
import { currentExperience, saveExperience } from "../../src/lib/experience/versions";
import { getPortal } from "../../src/lib/onboarding/portals";
import { ana } from "../../test/support/onboarding";
import { expect } from "./fixtures";
import { waitForHydration } from "./shell";

/** The address of +portal+'s Experience Editor at +view+, or of a configuration section given as "configuration/<section>". */
export const editorOf = (portal: { publicId: string }, view = "frame-zones") => (view.startsWith("configuration/") ? `/portals/${portal.publicId}/${view}` : `/portals/${portal.publicId}/editor/${view}`);

/** Runtime Configuration's actions in the app header: Undo, Redo, Change history, the unsaved count, Open running portal, and Save. */
export const headerActions = (page: Page) => page.locator("[data-runtime-actions]");

export async function openEditor(page: Page, portal: { publicId: string }, view = "frame-zones") {
  await page.goto(editorOf(portal, view));
  await waitForHydration(page);
}

/** Saves +change+ to +portal+'s experience directly, as an earlier editor session would have. */
export function saveDirectly(db: Db, portal: { publicId: string }, change: (draft: Experience) => void) {
  const current = currentExperience(db, getPortal(db, portal.publicId), catalogs());
  const document = structuredClone(current.experience);
  change(document);
  return saveExperience(db, portal.publicId, { baseNumber: current.number, lockVersion: getPortal(db, portal.publicId).lockVersion, document }, ana, catalogs());
}

export const preview = (page: Page) => page.locator("[data-frame-preview]");
export const pendingCount = (page: Page) => page.locator("[data-pending-count]");
export const options = (page: Page) => page.getByRole("region", { name: "Options", exact: true });

export async function saveEditor(page: Page) {
  await page.locator("[data-runtime-actions]").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText(/Version \d+ is saved\./);
}
