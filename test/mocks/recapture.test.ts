import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FrontendRegistryConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { JOB_PRIORITIES, jobs, previewBuilds } from "@/lib/db/schema";
import { setApplicationDefault } from "@/lib/mocks/defaults";
import { recaptureApplication } from "@/lib/mocks/recapture";
import { allRules, createRule, createSet, editRule } from "@/lib/mocks/records";
import { jobPayload } from "@/lib/jobs/queue";
import { runScreenshot } from "@/lib/previews/capture";
import type { PreviewBuild } from "@/lib/previews/records";
import { CAPTURE_SCREENSHOT, type ScreenshotJob, findScreenshot } from "@/lib/previews/screenshots";
import { previewDirectory } from "@/lib/previews/storage";
import type { Repository } from "@/lib/repositories/repository-records";
import { buildRepository } from "../support/builders";
import { onboard } from "../support/applications";
import { useAppDb } from "../support/next";
import { publishFiles } from "../support/previews";

/*
 * Capturing again when a default changes (add-mock-sets, design decision 11,
 * task 7.3; builds spec, "A change to the default mock set is captured
 * again"): behind other screenshots, keeping the earlier image shown until
 * the new one is captured, with a newer request superseding older ones.
 */

const PAGE = "<!doctype html><html lang=\"en\"><head><title>Orders</title></head><body><h1>Orders portal</h1></body></html>";

describe("capturing again for a changed default", () => {
  const original = getConfig();
  const app = useAppDb();
  let storage: string;
  let config: FrontendRegistryConfig;
  let repository: Repository;

  beforeEach(() => {
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mock-recapture-")));
    repository = buildRepository(app.db, { name: "spa-orders", cloneUrl: "https://git.example.com/acme/spa-orders.git" });
    config = withOverrides(original, { previews: { enabled: true, trustedSources: [repository.canonicalUrl], storage, browser: null } });
    setConfig(config);
  });
  afterEach(() => {
    setConfig(original);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  const captures = (preview: PreviewBuild) => app.db.select().from(jobs).where(and(eq(jobs.kind, CAPTURE_SCREENSHOT), eq(jobs.state, "queued"))).all().filter((job) => jobPayload(job).preview === preview.publicId);
  const jobOf = (preview: PreviewBuild): ScreenshotJob => ({ preview: preview.publicId, requested: findScreenshot(app.db, preview.id)!.requestedAt.getTime() });

  /** Orders portal's first build, captured with no set, and a "Happy path" set with one rule. */
  async function captured() {
    const created = onboard(app.db, config, repository);
    const preview = publishFiles(app.db, config, app.db.select().from(previewBuilds).where(eq(previewBuilds.id, created.latestPreviewId!)).get()!, { "index.html": PAGE });
    expect(await runScreenshot(app.db, jobOf(preview), { config })).toBe("captured");
    const set = createSet(app.db, created.id, { name: "Happy path" }, null);
    createRule(app.db, created.id, set.publicId, { method: "GET", pattern: "/v1/orders", queryMode: "ignore_all", query: [], queryIgnored: [], bodyMode: "ignore", responses: [{ status: 200, headers: [], contentType: "application/json", body: new TextEncoder().encode("{}"), latencyMs: 0 }] }, null, config);
    return { application: created, preview, set };
  }

  it("Setting a default: the build is captured again with it, behind other screenshots, and the card keeps the earlier image until then", async () => {
    const { application, preview, set } = await captured();
    const before = findScreenshot(app.db, preview.id)!;
    setApplicationDefault(app.db, application.id, set.publicId);
    expect(recaptureApplication(app.db, application.id)).toBe(1);
    const waiting = findScreenshot(app.db, preview.id)!;
    // Still shown: ready, with its images, until the new capture completes.
    expect(waiting).toMatchObject({ state: "ready", directory: before.directory, mockSetPublicId: null });
    expect(waiting.requestedAt.getTime()).toBeGreaterThan(before.requestedAt.getTime());
    expect(captures(preview).filter((job) => jobPayload(job).requested === waiting.requestedAt.getTime()).map((job) => job.priority)).toEqual([JOB_PRIORITIES.background]);
    // Nothing changed, so nothing more is requested.
    expect(recaptureApplication(app.db, application.id)).toBe(0);

    expect(await runScreenshot(app.db, jobOf(preview), { config })).toBe("captured");
    const after = findScreenshot(app.db, preview.id)!;
    expect(after).toMatchObject({ state: "ready", mockSetPublicId: set.publicId, mockSetName: "Happy path" });
    expect(after.directory).not.toBe(before.directory);
    expect(fs.readdirSync(path.join(previewDirectory(config, preview.publicId), "screenshots"))).toEqual([after.directory!.split("/")[1]]);
  }, 60_000);

  it("Ten quick edits: the build is captured once its latest request is reached, with the set as of then, and the nine earlier requests capture nothing", async () => {
    const { application, preview, set } = await captured();
    setApplicationDefault(app.db, application.id, set.publicId);
    recaptureApplication(app.db, application.id);
    const [rule] = allRules(app.db, set.id);
    let version = rule!.lockVersion;
    const requests: ScreenshotJob[] = [jobOf(preview)];
    for (let edit = 1; edit <= 9; edit++) {
      version = editRule(app.db, application.id, set.publicId, rule!.publicId, version, { method: "GET", pattern: "/v1/orders", queryMode: "ignore_all", query: [], queryIgnored: [], bodyMode: "ignore", responses: [{ status: 200, headers: [], contentType: "application/json", body: new TextEncoder().encode(`{"edit":${edit}}`), latencyMs: 0 }] }, null, config).rule.lockVersion;
      recaptureApplication(app.db, application.id);
      requests.push(jobOf(preview));
    }
    expect(new Set(requests.map((request) => request.requested)).size).toBe(10);
    const outcomes = [];
    for (const request of requests) outcomes.push(await runScreenshot(app.db, request, { config }));
    expect(outcomes.filter((outcome) => outcome === "skipped")).toHaveLength(9);
    expect(outcomes.at(-1)).toBe("captured");
    expect(findScreenshot(app.db, preview.id)).toMatchObject({ state: "ready", mockSetRevision: 11 });
  }, 60_000);

  it("keeps the earlier image when capturing again fails", async () => {
    const { application, preview, set } = await captured();
    const before = findScreenshot(app.db, preview.id)!;
    setApplicationDefault(app.db, application.id, set.publicId);
    recaptureApplication(app.db, application.id);
    const outcome = await runScreenshot(app.db, jobOf(preview), { config, launch: async () => Promise.reject(new Error("The browser didn't start")) });
    expect(outcome).toBe("unavailable");
    expect(findScreenshot(app.db, preview.id)).toMatchObject({ state: "ready", directory: before.directory, mockSetPublicId: null });
    expect(fs.existsSync(path.join(previewDirectory(config, preview.publicId), before.directory!, "screenshot.webp"))).toBe(true);
  }, 60_000);
});
