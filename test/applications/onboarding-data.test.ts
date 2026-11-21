import { eq } from "drizzle-orm";
import { analyze } from "@repo-facts/bundle";
import { type JsonObject, MemoryReader } from "@repo-facts/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, withOverrides } from "@/lib/config";
import { type Db, immediate } from "@/lib/db/client";
import { previewPreparations, surveys } from "@/lib/db/schema";
import { applicationApis, offersDataStep } from "@/lib/mocks/profile-apis";
import { insertProfile } from "@/lib/profiles/profile-records";
import { buildProfile } from "@/lib/profiles/schema";
import { surveyRefFor } from "@/lib/acquisition/mirror";
import { moveSurvey, pinSurvey } from "@/lib/surveys/records";
import { decidedPreparation, onboard, qualifyingVerdict } from "../support/applications";
import { buildRepository } from "../support/builders";
import { createTestDb } from "../support/db";

/*
 * Onboarding's Data step (add-mock-sets, design decision 19, task 6.1;
 * onboarding spec, "Onboarding offers an optional Data step"): what the
 * Profile of the commit eligibility checked reports about the APIs the code
 * calls and its test substitutes, and whether the step is offered.
 */

const PACKAGE = JSON.stringify({ name: "orders", dependencies: { react: "19.3.1", "react-dom": "19.3.1", msw: "2.12.0" }, devDependencies: { vite: "8.3.8" }, scripts: { build: "vite build" } });

describe("onboarding's Data step", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => db.$client.close());

  /** An application onboarded from +files+, whose deciding Profile is surveyed from them, as preparation would. */
  async function onboarded(name: string, files: Record<string, string>) {
    const repository = buildRepository(db, { name, cloneUrl: `https://git.example.com/fixtures/${name}.git` });
    const config = withOverrides(getConfig(), { previews: { enabled: true, trustedSources: [repository.canonicalUrl] } });
    const preparation = decidedPreparation(db, repository, [qualifyingVerdict(".")]);
    const survey = db.select().from(surveys).where(eq(surveys.id, db.select().from(previewPreparations).where(eq(previewPreparations.id, preparation.id)).get()!.surveyId!)).get()!;
    const factDocument = await analyze(MemoryReader.fromFiles(files, { commit: preparation.commitSha, budgets: config.analysis }), { entries: [] as JsonObject[] as never });
    const running = pinSurvey(db, moveSurvey(db, survey, "running", { attempts: 1 }), { treeSha: null, internalRef: surveyRefFor(survey.publicId) });
    immediate(db, (tx) => {
      insertProfile(tx, { survey: running, document: buildProfile({ repository: repository.publicId, commit: preparation.commitSha, surveyorRelease: survey.surveyorRelease, configurationDigest: survey.configurationDigest, factDocument }) });
      moveSurvey(tx, running, "succeeded", {});
    });
    return onboard(db, config, repository, { name, preparation });
  }

  it("The APIs the code calls: lists https://api.orders.test with GET /v1/orders among its operations", async () => {
    const created = await onboarded("orders-portal", {
      "package.json": PACKAGE,
      "src/api.js": 'const API = "https://api.orders.test/v1";\nexport const orders = () => fetch(`${API}/orders?limit=5`);\nexport const search = (status) => fetch(`${API}/orders/search`, { method: "POST", body: JSON.stringify({ status }) });\n',
    });
    const apis = applicationApis(db, created.publicId);
    expect(apis.services).toEqual([{ endpoint: "https://api.orders.test", client: "fetch", operations: ["GET /v1/orders", "POST /v1/orders/search"], more: 0 }]);
    expect(offersDataStep(apis)).toBe(true);
  });

  it("Test substitutes found: names the MSW handlers and where they are", async () => {
    const created = await onboarded("handlers", {
      "package.json": PACKAGE,
      "src/main.jsx": 'import { createRoot } from "react-dom/client";\ncreateRoot(document.body);\n',
      "src/mocks/handlers.ts": 'import { http, HttpResponse } from "msw";\nexport const handlers = [http.get("https://api.orders.test/v1/orders", () => HttpResponse.json({ orders: [] }))];\n',
    });
    const apis = applicationApis(db, created.publicId);
    expect(apis.services).toEqual([]);
    expect(apis.substitutes).toContain("MSW handlers in `src/mocks/handlers.ts`");
    expect(offersDataStep(apis)).toBe(true);
  });

  it("No APIs reported: the step isn't offered", async () => {
    const created = await onboarded("static", { "package.json": PACKAGE, "src/main.jsx": 'import { createRoot } from "react-dom/client";\ncreateRoot(document.body);\n' });
    expect(offersDataStep(applicationApis(db, created.publicId))).toBe(false);
    expect(offersDataStep(applicationApis(db, "app_0000000000000000"))).toBe(false);
  });

  it("lists up to 10 services, each with up to 5 operations, and counts the rest", async () => {
    const calls = Array.from({ length: 12 }, (_, host) => Array.from({ length: 7 }, (_, path) => `export const c${host}_${path} = () => fetch("https://api${host}.test/v1/r${path}");`).join("\n")).join("\n");
    const created = await onboarded("many", { "package.json": PACKAGE, "src/api.js": `${calls}\n` });
    const apis = applicationApis(db, created.publicId);
    expect([apis.services.length, apis.moreServices]).toEqual([10, 2]);
    expect([apis.services[0]!.operations.length, apis.services[0]!.more]).toEqual([5, 2]);
  });
});
