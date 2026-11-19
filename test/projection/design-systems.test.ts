import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { designSystemProfiles, designSystemUsage } from "@/lib/db/schema";
import { rebuildProjection } from "@/lib/projection/rebuild";
import { PROJECTION_VERSION } from "@/lib/projection/project";
import { buildAssessment, buildRepository } from "../support/builders";
import { saltEntry } from "../support/catalog";
import { createTestDb } from "../support/db";
import { manifest } from "../support/profiles";
import { projectionRows } from "../support/projection";
import { seedRun, seedSurvey } from "../support/scenarios";

/*
 * The design-system projection (establish-frontend-registry, task 6.1): a
 * stored Profile writes one row per design-system component its repository
 * uses and per raw element a component replaces, with counts per scope and
 * a component's props, and one row with its design-system categories'
 * states and the design systems it recognizes. A rebuild reproduces them.
 */

const SALT_APP = {
  "package.json": manifest({ name: "web", version: "1.0.0", dependencies: { "@salt-ds/core": "1.75.0", "@salt-ds/theme": "1.48.0" } }),
  "src/main.tsx": 'import "@salt-ds/theme/index.css";\nimport { SaltProvider } from "@salt-ds/core";\nimport { App } from "./App";\nexport const Root = () => <SaltProvider><App /></SaltProvider>;\n',
  "src/App.tsx": 'import { Button } from "@salt-ds/core";\nexport const App = () => (\n  <div>\n    <Button appearance="solid">Save</Button>\n    <Button appearance="bordered" className="wide">Cancel</Button>\n    <Button {...rest}>More</Button>\n    <button>Raw</button>\n  </div>\n);\n',
  "src/App.module.css": ".wide { padding: var(--salt-spacing-300); color: #0a6; }\n",
  "src/Button.stories.tsx": 'import { Button } from "@salt-ds/core";\nexport const Primary = () => <Button appearance="solid">Story</Button>;\n',
};

describe("the design-system projection", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  const usage = () => db.select().from(designSystemUsage).all();
  const profiles = () => db.select().from(designSystemProfiles).all();

  it("writes a Salt component's counts per scope and its props, and a raw element with the component that replaces it", async () => {
    const survey = await seedSurvey(db, buildRepository(db, { name: "web" }), { files: SALT_APP });
    const salt = saltEntry();

    const button = usage().find((row) => row.kind === "component" && row.name === "Button")!;
    expect(button).toMatchObject({ designSystem: "salt", entryDigest: salt.digest, counterpart: "@salt-ds/core", appSites: 3, storiesSites: 1, testsSites: 0, projectionVersion: PROJECTION_VERSION });
    expect(button.appCustomized).toBeGreaterThanOrEqual(1);
    expect(button.props!.app.names.appearance).toEqual({ count: 2, values: { bordered: 1, solid: 1 } });
    // A spread can't be read, so it counts as unknown; a free-text prop records no values.
    expect(button.props!.app.unknown).toBe(1);
    expect(button.props!.app.names.className).toEqual({ count: 1 });
    expect(button.props!.stories.names.appearance).toEqual({ count: 1, values: { solid: 1 } });
    expect(usage().find((row) => row.kind === "element")).toMatchObject({ designSystem: "salt", name: "button", counterpart: "Button", appSites: 1, props: null });
    expect(usage().filter((row) => row.kind === "element").map((row) => row.name)).not.toContain("div");

    const [profile] = profiles();
    expect(profile).toMatchObject({ designSystemsState: "observed", uiElementsState: expect.any(String), styleValuesState: expect.any(String) });
    expect(profile!.recognized).toEqual([
      expect.objectContaining({ id: "salt", name: "Salt", entry: { version: "1.75.0", digest: salt.digest }, wanted: { package: "@salt-ds/core", version: "1.75.0" }, app: expect.objectContaining({ designSystem: expect.any(Number), elements: expect.any(Number), tokenized: 1, tokenCapable: 2 }) }),
    ]);
    expect(survey.state).toBe("succeeded");
  });

  it("writes one row for a Profile that recognizes no design system, and no usage", async () => {
    await seedSurvey(db, buildRepository(db, { name: "plain" }), { files: { "package.json": manifest({ name: "plain", version: "1.0.0", dependencies: { react: "19.3.1" } }), "src/App.tsx": "export const App = () => <button>Go</button>;\n" } });

    expect(usage()).toEqual([]);
    expect(profiles()).toEqual([expect.objectContaining({ designSystemsState: "absent", recognized: [] })]);
  });

  it("writes a version 1 Profile's row with no design-system categories, which Adoption can't count", async () => {
    const repositories = [buildRepository(db, { name: "legacy" })];
    await seedRun(db, buildAssessment(db, { repositories }), repositories, [SALT_APP], { profileVersion1: true });

    expect(usage()).toEqual([]);
    expect(profiles()).toEqual([expect.objectContaining({ designSystemsState: null, uiElementsState: null, styleValuesState: null, recognized: [] })]);
  });

  it("reproduces on a rebuild the rows written when the Profiles were stored", async () => {
    await seedSurvey(db, buildRepository(db, { name: "web" }), { files: SALT_APP });
    await seedSurvey(db, buildRepository(db, { name: "plain" }));
    const written = projectionRows(db);
    expect(written.design_system_usage!.length).toBeGreaterThan(1);

    expect(rebuildProjection(db)).toMatchObject({ profiles: 2, skipped: [] });
    expect(projectionRows(db)).toEqual(written);
  });
});
