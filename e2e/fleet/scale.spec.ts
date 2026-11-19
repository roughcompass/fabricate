import { expect, test } from "@playwright/test";
import { takeSnapshots } from "../../src/lib/adoption/snapshots";
import { storeEntry } from "../../src/lib/catalog/entries";
import { loadConfig } from "../../src/lib/config";
import { openDatabase } from "../../src/lib/db/client";
import { buildRepository } from "../../test/support/builders";
import { saltEntry } from "../../test/support/catalog";
import { manifest } from "../../test/support/profiles";
import { seedSurvey } from "../../test/support/scenarios";
import { FLEET_DATABASE, FLEET_ENV } from "./env";

/**
 * Adoption Analytics at fleet scale (adoption-analytics spec, "Adoption pages
 * stay fast at fleet scale"): 500 more Repositories, profiled, most of them
 * Salt applications, then every adoption page timed. It runs after the
 * synthetic fleet's run, on the same throwaway database, and last, because
 * it makes every stored Profile document unreadable to show that no
 * adoption page reads one.
 */

test.setTimeout(900_000);

const COUNT = 500;
/** The time a page may take, from request to the end of its response, once compiled. */
const BUDGET_MS = 1_000;

/** A Repository's files: a Salt app using a few components and a raw button, or, every fifth one, an app without a design system. */
function files(index: number) {
  const name = `scale-${String(index).padStart(3, "0")}`;
  if (index % 5 === 4) return { "package.json": manifest({ name, version: "1.0.0", dependencies: { react: "19.3.1" } }), "src/App.tsx": "export const App = () => <button>Go</button>;\n" };
  const version = ["1.75.0", "^1.75.0", "~1.75.0"][index % 3]!;
  return {
    "package.json": manifest({ name, version: "1.0.0", dependencies: { "@salt-ds/core": version } }),
    "src/App.tsx": `import { Button, Text } from "@salt-ds/core";\nexport const App = () => (\n  <main>\n    <Text>${name}</Text>\n    <Button appearance="${index % 2 ? "solid" : "bordered"}">Save</Button>\n    <button>Raw</button>\n  </main>\n);\n`,
  };
}

test("Five hundred repositories: every adoption page renders in under one second and reads no Profile document", async ({ page, request }) => {
  const db = openDatabase(FLEET_DATABASE);
  const config = loadConfig({ env: { ...process.env, ...FLEET_ENV } });
  storeEntry(db, saltEntry());
  for (let index = 0; index < COUNT; index++) await seedSurvey(db, buildRepository(db, { name: `scale-${String(index).padStart(3, "0")}` }), { files: files(index) });
  takeSnapshots(db, config, "2026-11-12T00:00:00.000Z", new Date("2026-11-12T00:00:00.000Z"));
  takeSnapshots(db, config, "2026-11-19T00:00:00.000Z", new Date("2026-11-19T00:00:00.000Z"));

  // Every Profile document, the fleet's and these, becomes unreadable: an empty object, which fails its digest, so a page that read one would fail.
  db.$client.exec("DROP TRIGGER repository_profiles_immutable; UPDATE repository_profiles SET document = '{}';");

  const pages: [address: string, title: string][] = [
    ["/adoption", "Adoption"],
    ["/adoption/design-systems/salt", "Salt"],
    ["/adoption/design-systems/salt?usage=rarely", "Salt"],
    ["/adoption/design-systems/salt?view=html", "Salt"],
    ["/adoption/design-systems/salt?view=versions", "Salt"],
    ["/adoption/design-systems/salt?view=snapshots", "Salt"],
    ["/adoption/design-systems/salt/components/Button", "Button"],
    ["/adoption/design-systems/salt/components/Button?view=repositories", "Button"],
    ["/adoption/packages/@salt-ds/core", "@salt-ds/core"],
  ];
  const timings: string[] = [];
  for (const [address, title] of pages) {
    // The first request compiles the page in the development server; the second is the one timed.
    expect((await request.get(address)).status(), address).toBe(200);
    const started = performance.now();
    const response = await request.get(address);
    const body = await response.text();
    const elapsed = performance.now() - started;
    expect(response.status(), address).toBe(200);
    expect(body, address).toContain(`>${title}</h1>`);
    expect(elapsed, `${address} took ${Math.round(elapsed)}ms`).toBeLessThan(BUDGET_MS);
    timings.push(`${address} ${Math.round(elapsed)}ms`);
  }
  test.info().annotations.push({ type: "timings", description: timings.join(", ") });
  console.log(`Adoption pages at ${COUNT} more Repositories: ${timings.join(", ")}`);

  // The figures cover the 500: 400 Salt applications among them.
  await page.goto("/adoption/design-systems/salt");
  await expect(page.locator("dl[data-key-figures] > div").filter({ hasText: "Repositories using it" }).locator("dd").first()).toHaveText(/^4\d\d$/);
});
