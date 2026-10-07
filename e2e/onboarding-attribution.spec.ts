import { expect, test } from "./support/fixtures";
import { seedOnboardingSurfaces } from "./support/onboarding-surfaces";

/*
 * Decisions are visibly unverified without authentication: every name a
 * person stated is shown labeled Unverified, no page claims a verified,
 * signed-in, or entitled actor, no form asks for an email, and no stored
 * record holds any attribution but unverified or system, or an entity
 * email.
 */
test("labels every stated name Unverified, asks for no email, and claims no authority, on screen or in storage", async ({ page, db }) => {
  const surfaces = seedOnboardingSurfaces(db);
  for (const [name, url] of surfaces) {
    await test.step(name, async () => {
      await page.goto(typeof url === "string" ? url : url());
      const unlabeled = await page.evaluate(() => {
        const found: string[] = [];
        const walker = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!/[a-z]+@example\.com/.test(node.textContent ?? "")) continue;
          const parent = node.parentElement;
          const labeled = [parent, parent?.parentElement].some((element) => /unverified/i.test(element?.textContent ?? ""));
          if (!labeled) found.push((parent?.textContent ?? "").trim().slice(0, 120));
        }
        return found;
      });
      expect(unlabeled, "names shown without an Unverified label").toEqual([]);
      const text = await page.locator("main").innerText();
      expect(text).not.toMatch(/\b(verified|authenticated|signed in as|authorized by|entitled by)\b/i);
      expect(text).not.toMatch(/name or email/i);
      await expect(page.locator('main input[type="email"], main input[autocomplete="email"]')).toHaveCount(0);
      for (const label of await page.locator("main label").allInnerTexts()) expect(label).not.toMatch(/email/i);
    });
  }
  const tables = db.$client.prepare("select m.name as tbl from sqlite_master m join pragma_table_info(m.name) c where m.type = 'table' and c.name = 'attribution'").all() as { tbl: string }[];
  expect(tables.length).toBeGreaterThan(0);
  for (const { tbl } of tables) {
    const values = (db.$client.prepare(`select distinct attribution as value from "${tbl}"`).all() as { value: string }[]).map((row) => row.value);
    expect(values.every((value) => value === "unverified" || value === "system"), `${tbl} attributions: ${values.join(", ")}`).toBe(true);
  }
  // Portals, Applications, and MFEs name their owning team; none has an email column.
  for (const table of ["portals", "applications", "microfrontends", "portal_revisions", "application_revisions", "microfrontend_revisions"]) {
    const columns = (db.$client.prepare(`select name from pragma_table_info('${table}')`).all() as { name: string }[]).map((row) => row.name);
    expect(columns.filter((name) => /email/.test(name)), table).toEqual([]);
  }
});
