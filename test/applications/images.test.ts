import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, HEAD } from "@/app/(operator)/applications/[slug]/screenshot/route";
import { applicationsAvailable, applicationsUnavailable, requireApplications } from "@/lib/applications/availability";
import { screenshotAlt } from "@/lib/applications/images";
import { getApplication, getApplicationRow, listApplications } from "@/lib/applications/records";
import { findSavedPreview, savedPreviewAlt } from "@/lib/applications/saved-previews";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { previewBuilds } from "@/lib/db/schema";
import { type PreviewBuild, failAttempt, rebuildPreview } from "@/lib/previews/records";
import { completeScreenshot, findScreenshot } from "@/lib/previews/screenshots";
import { previewDirectory } from "@/lib/previews/storage";
import { routes } from "@/lib/web/routes";
import { buildRepository } from "../support/builders";
import { onboard } from "../support/applications";
import { publishFiles, queuedPreview } from "../support/previews";
import { rawRun } from "../support/db";
import { redirectOf, useAppDb } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

/*
 * Applications' screenshots through their own addresses (add-applications,
 * task 4.4), and applications' availability with previews (task 1.3):
 * while previews are off, every application address answers not found, and
 * nothing is deleted, so applications return with their last state when
 * previews are on again.
 */

const FULL = Buffer.from("RIFF....WEBPfull");
const CARD = Buffer.from("RIFF....WEBPcard");

describe("application images", () => {
  const original = getConfig();
  const app = useAppDb();
  let storage: string;
  let repository: Repository;
  let config: FrontendRegistryConfig;

  beforeEach(() => {
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "application-images-")));
    repository = buildRepository(app.db, { name: "spa-orders", cloneUrl: "https://git.example.com/acme/spa-orders.git" });
    configure({});
  });
  afterEach(() => {
    setConfig(original);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  function configure(previews: Partial<FrontendRegistryConfig["settings"]["previews"]>): void {
    config = withOverrides(original, { previews: { enabled: true, trustedSources: [repository.canonicalUrl], storage, ...previews } });
    setConfig(config);
  }

  /** Orders portal with a published first build, and its screenshot captured unless +captured+ is false. */
  function readyApplication(captured = true): PreviewBuild {
    const created = onboard(app.db, config, repository);
    const preview = publishFiles(app.db, config, app.db.select().from(previewBuilds).where(eq(previewBuilds.id, created.latestPreviewId!)).get()!, { "index.html": "<h1>Orders</h1>" });
    if (captured) captureImages(preview, FULL, CARD);
    return preview;
  }

  /** Writes +full+ and +card+ as +preview+'s captured screenshot. */
  function captureImages(preview: PreviewBuild, full: Buffer, card: Buffer): void {
    const directory = path.join(previewDirectory(config, preview.publicId), "screenshots", "1-test");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "screenshot.webp"), full);
    fs.writeFileSync(path.join(directory, "card.webp"), card);
    completeScreenshot(app.db, preview.id, findScreenshot(app.db, preview.id)!.requestedAt.getTime(), "screenshots/1-test");
  }

  const request = (slug: string, query = "", method: "GET" | "HEAD" = "GET", headers: Record<string, string> = {}) => {
    const handler = method === "HEAD" ? HEAD : GET;
    return handler(new Request(`http://localhost/applications/${slug}/screenshot${query}`, { method, headers }), { params: Promise.resolve({ slug }) });
  };

  it("serves the current build's screenshot and card image, revalidated every time", async () => {
    readyApplication();
    const full = await request("orders-portal");
    expect(full.status).toBe(200);
    expect(Object.fromEntries(full.headers)).toMatchObject({ "content-type": "image/webp", "cache-control": "private, no-cache", "x-content-type-options": "nosniff", etag: expect.stringMatching(/^"[\w-]+"$/) });
    expect(Buffer.from(await full.arrayBuffer()).equals(FULL)).toBe(true);

    const card = await request("orders-portal", "?size=card&v=abc");
    expect(Buffer.from(await card.arrayBuffer()).equals(CARD)).toBe(true);
    expect(card.headers.get("etag")).not.toBe(full.headers.get("etag"));

    expect((await request("orders-portal", "", "GET", { "if-none-match": full.headers.get("etag")! })).status).toBe(304);
    const head = await request("orders-portal", "", "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
  });

  it("names the application and the commit it shows in its text alternative, and versions its address", () => {
    const preview = readyApplication();
    const shown = getApplication(app.db, "orders-portal");
    expect(screenshotAlt(shown)).toBe(`Screenshot of Orders portal at commit ${preview.commitSha.slice(0, 7)}`);
    expect(routes.applicationScreenshot(shown.slug, shown.screenshot!.version)).toBe(`/applications/orders-portal/screenshot?v=${shown.screenshot!.version}`);
    expect(routes.applicationScreenshot(shown.slug, shown.screenshot!.version, "card")).toBe(`/applications/orders-portal/screenshot?size=card&v=${shown.screenshot!.version}`);
  });

  it("answers not found before a screenshot is captured, for an application without a current build, and for an unknown one", async () => {
    readyApplication(false);
    expect((await request("orders-portal")).status).toBe(404);
    expect((await request("orders")).status).toBe(404);

    const other = buildRepository(app.db, { name: "spa-admin" });
    configure({ trustedSources: [repository.canonicalUrl, other.canonicalUrl] });
    const admin = onboard(app.db, config, other, { name: "Admin" });
    failAttempt(app.db, app.db.select().from(previewBuilds).where(eq(previewBuilds.id, admin.latestPreviewId!)).get()!.publicId, { attempt: 1 }, "The build failed");
    expect((await request("admin")).status).toBe(404);
    expect(screenshotAlt(getApplication(app.db, "admin"))).toBe("Screenshot of Admin");
  });

  it("serves a saved preview's images by its key, names the branch in the text alternative, and answers not found for an unknown key (Screenshot of a saved preview)", async () => {
    readyApplication();
    const feature = queuedPreview(app.db, repository);
    rawRun(
      app.db,
      "insert into application_previews (public_id, application_id, key, ref, latest_preview_id, latest_preparation_id, latest_commit_sha, latest_requested_at, created_at, updated_at) values ('apv_0000000000000001', ?, 'feature-new-nav', 'refs/heads/feature/new-nav', ?, ?, ?, 0, 0, 0)",
      getApplicationRow(app.db, getApplication(app.db, "orders-portal").publicId).id,
      feature.id,
      feature.preparationId,
      feature.commitSha,
    );
    // Before its first build publishes, there's nothing to serve.
    expect((await request("orders-portal", "?preview=feature-new-nav")).status).toBe(404);
    const published = publishFiles(app.db, config, feature, { "index.html": "<h1>New nav</h1>" });
    expect(findScreenshot(app.db, published.id)).toMatchObject({ state: "pending" });
    captureImages(published, Buffer.from("RIFF....WEBPnav"), Buffer.from("RIFF....WEBPnavcard"));

    expect(Buffer.from(await (await request("orders-portal", "?preview=feature-new-nav")).arrayBuffer()).toString()).toBe("RIFF....WEBPnav");
    expect(Buffer.from(await (await request("orders-portal", "?preview=feature-new-nav&size=card")).arrayBuffer()).toString()).toBe("RIFF....WEBPnavcard");
    // The application's own image is unchanged.
    expect(Buffer.from(await (await request("orders-portal")).arrayBuffer()).equals(FULL)).toBe(true);
    expect((await request("orders-portal", "?preview=nowhere")).status).toBe(404);
    expect((await request("orders-portal", "?preview=feature-new-nav", "HEAD")).status).toBe(200);

    const saved = findSavedPreview(app.db, getApplication(app.db, "orders-portal").publicId, "feature-new-nav")!;
    expect(saved).toMatchObject({ status: "ready", image: "screenshot" });
    expect(savedPreviewAlt(getApplication(app.db, "orders-portal"), saved)).toBe(`Screenshot of Orders portal, feature/new-nav, at commit ${published.commitSha.slice(0, 7)}`);
    expect(routes.applicationScreenshot("orders-portal", saved.screenshot!.version, "card", "feature-new-nav")).toBe(`/applications/orders-portal/screenshot?preview=feature-new-nav&size=card&v=${saved.screenshot!.version}`);

    // A later build keeps the last good screenshot meanwhile.
    rebuildPreview(app.db, published.publicId);
    expect(findSavedPreview(app.db, getApplication(app.db, "orders-portal").publicId, "feature-new-nav")).toMatchObject({ status: "building", image: "screenshot" });
    configure({ enabled: false });
    expect((await request("orders-portal", "?preview=feature-new-nav")).status).toBe(404);
  });

  describe("availability", () => {
    it("answers not found while previews are off, and serves the same images, with every application's last state, once they're on again (Previews turned back on)", async () => {
      readyApplication();
      configure({ enabled: false });
      expect(applicationsAvailable()).toBe(false);
      for (const query of ["", "?size=card"]) {
        const response = await request("orders-portal", query);
        expect(response.status).toBe(404);
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      expect(applicationsUnavailable()?.status).toBe(404);
      expect(await redirectOf(Promise.resolve().then(() => requireApplications()))).toBe("not-found");

      configure({});
      expect(applicationsAvailable()).toBe(true);
      expect(applicationsUnavailable()).toBeNull();
      requireApplications();
      expect((await request("orders-portal")).status).toBe(200);
      expect(listApplications(app.db).items.map((item) => [item.name, item.status, item.image])).toEqual([["Orders portal", "ready", "screenshot"]]);
    });
  });
});
