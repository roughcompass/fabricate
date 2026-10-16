import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { PAYMENTS_APP } from "@/lib/demo/catalog/heroes";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { exempt } from "@/lib/prototypes/gates";
import { generateHero, generateShell, heroFiles, heroManifest, stableVersion, versionMessage } from "@/lib/prototypes/heroes/generate";
import { PLANTED, plantedExemptions } from "@/lib/prototypes/heroes/planted";
import type { GateResult } from "@/lib/prototypes/types";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { createPrototypesTestDb } from "../support/prototypes-db";

// converge-templates-and-prototypes, design decision 6: hero generation with a mock model, for one hero.

describe("the hero script", () => {
  let connection: PrototypesConnection;
  let workspaceId: string;
  const original = getConfig();

  beforeEach(async () => {
    setConfig(withOverrides(loadConfig({ environment: "test" }), { prototypes: { dailyVariantLimit: 500, models: { generate: "mock", plan: "mock", review: "mock", learn: "mock" } } }));
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
    workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
  });

  afterEach(async () => {
    await setPrototypesDb(undefined);
    setConfig(original);
  });

  it("writes every Payments member version in catalog order, with gates and the catalog's planted exemptions, and a manifest", async () => {
    const hero = await generateHero(connection.db, workspaceId, "payments-workspace");
    const shell = await generateShell(connection.db, workspaceId, "access");

    const expected = PAYMENTS_APP.members.filter((member) => member.role === "child").flatMap((member) => {
      const stable = stableVersion(member);
      return [stable, ...member.versions.filter((version) => version !== stable)].map((version) => `${member.id}@${version.version}`);
    });
    expect(hero.versions.map((version) => `${version.member}@${version.version}`)).toEqual(expected);
    expect(expected).toEqual(["payee-list@2.0.0", "payee-list@1.4.2", "payee-list@2.1.0-beta.1", "transfer-form@3.1.0", "transfer-form@3.0.1", "payment-activity@2.3.0"]);

    for (const version of hero.versions) {
      expect(version.gates.map((result) => result.gate)).toEqual(["salt-only", "typecheck", "salt-usage", "build"]);
      expect(version.gates.every((result) => result.status === "passed")).toBe(true);
      expect(version.code).toContain('from "./data"');
    }
    const planted = hero.versions.find((version) => version.version === "1.4.2")!;
    expect(planted.planted).toEqual(["label", "color-contrast", "button-name"]);
    expect(planted.exemptions.map((exemption) => exemption.rule)).toEqual(["label", "color-contrast", "button-name"]);
    expect(planted.exemptions.find((exemption) => exemption.rule === "color-contrast")!.codes).toEqual(PLANTED["color-contrast"].codes);
    expect(planted.provenance).toMatchObject({ refinedFrom: "2.0.0", message: expect.stringContaining("Planted defect (color-contrast)") });
    for (const version of hero.versions.filter((entry) => entry !== planted)) expect(version.exemptions).toEqual([]);
    expect(hero.versions.find((version) => version.version === "2.1.0-beta.1")!.prerelease).toBe(true);

    const manifest = heroManifest([hero], [shell]);
    expect(manifest).toMatchObject({ schema: "fabricate.hero_manifest", schema_version: 1, heroes: [{ slug: "payments-workspace", data: { file: "payments-workspace/data.ts" } }], shells: [{ kind: "access", file: "shells/access.tsx" }] });
    expect(manifest.heroes[0]!.versions.map((version) => version.file)).toContain("payments-workspace/payee-list/1.4.2.tsx");
    expect(JSON.stringify(manifest)).not.toContain('"code"');
    const files = heroFiles([hero], [shell]);
    expect(Object.keys(files).sort()).toEqual(["index.ts", "manifest.json", "payments-workspace/data.ts", "payments-workspace/page.tsx", ...expected.map((entry) => `payments-workspace/${entry.replace("@", "/")}.tsx`), "shells/access.tsx", "shells/data.ts", "sources.ts"].sort());
    // The main route as one page: each region at its conformant version, passing the gates (design decision 7).
    expect(hero.page.regions).toEqual([
      { member: "payee-list", version: "2.0.0", area: "main" },
      { member: "transfer-form", version: "3.1.0", area: "side" },
      { member: "payment-activity", version: "2.3.0", area: "wide" },
    ]);
    expect(hero.page.gates.every((result) => result.status === "passed")).toBe(true);
    expect(files["payments-workspace/page.tsx"]).toContain('from "./data"');
    expect(files["payments-workspace/page.tsx"]).toMatch(/export default function PaymentsWorkspace\(\)/);
    expect(manifest.heroes[0]!.page).toMatchObject({ file: "payments-workspace/page.tsx", route: "payees" });
    // Members import the hero's shared data from one directory up; the index imports every version statically.
    expect(files["payments-workspace/payee-list/2.0.0.tsx"]).toContain('from "../data"');
    expect(files["payments-workspace/payee-list/2.0.0.tsx"]).not.toContain('from "./data"');
    expect(files["index.ts"]).toContain('import payee_list_2_0_0 from "./payments-workspace/payee-list/2.0.0";');
    expect(files["index.ts"]).toContain('"payee-list": { "2.0.0": payee_list_2_0_0, "1.4.2": payee_list_1_4_2, "2.1.0-beta.1": payee_list_2_1_0_beta_1 },');
  });

  it("asks only for the catalog's planted rules, and waives only their gate issues", () => {
    const payeeList = PAYMENTS_APP.members.find((member) => member.id === "payee-list")!;
    const message = versionMessage(payeeList, payeeList.versions[0]!);
    expect(message.match(/Planted defect \(([a-z-]+)\)/g)).toEqual(["Planted defect (label)", "Planted defect (color-contrast)", "Planted defect (button-name)"]);
    expect(versionMessage(payeeList, payeeList.versions[1]!)).not.toContain("Planted");

    const failed: GateResult = { gate: "salt-only", status: "failed", durationMs: 1, warnings: [], issues: [{ code: "salt-only/literal-color", message: "A literal color" }, { code: "salt-only/inner-html", message: "Raw HTML" }] };
    const result = exempt(failed, plantedExemptions(["color-contrast"]));
    expect(result).toMatchObject({ status: "failed", issues: [{ code: "salt-only/inner-html" }], exempted: [{ rule: "color-contrast", issue: { code: "salt-only/literal-color" } }] });
    expect(exempt({ ...failed, issues: [failed.issues[0]!] }, plantedExemptions(["color-contrast"])).status).toBe("passed");
    expect(exempt(failed, plantedExemptions(["label"]))).toBe(failed);
  });
});
