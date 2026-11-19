import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import RunRoute from "@/app/(runtime)/run/[slug]/[[...path]]/page";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { previewBuilds } from "@/lib/db/schema";
import { buildRepository } from "../support/builders";
import { onboard } from "../support/applications";
import { publishFiles } from "../support/previews";
import { redirectOf, useAppDb } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

/*
 * A running application's page (add-applications, task 8.1, and the /run
 * half of task 1.3): the current build in a frame at the route in the
 * address, only while previews are on, and only once a build succeeded.
 */

interface RunningProps {
  slug: string;
  src: string;
  base: string;
  commit: string;
  title: string;
}

describe("the running application page", () => {
  const original = getConfig();
  const app = useAppDb();
  let storage: string;
  let repository: Repository;
  let config: FrontendRegistryConfig;

  beforeEach(() => {
    storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "run-page-")));
    repository = buildRepository(app.db, { name: "orders-portal", cloneUrl: "https://git.example.com/acme/orders-portal.git" });
    config = withOverrides(original, { previews: { enabled: true, trustedSources: [repository.canonicalUrl], storage } });
    setConfig(config);
  });
  afterEach(() => {
    setConfig(original);
    fs.rmSync(storage, { recursive: true, force: true });
  });

  const render = (slug: string, route: string[] = []) => RunRoute({ params: Promise.resolve({ slug, path: route }), searchParams: Promise.resolve({}) }) as Promise<ReactElement<RunningProps>>;

  it("frames the current build at the address's route, encoded", async () => {
    const created = onboard(app.db, config, repository);
    const preview = publishFiles(app.db, config, app.db.select().from(previewBuilds).where(eq(previewBuilds.id, created.latestPreviewId!)).get()!, { "index.html": "<h1>Orders</h1>" });
    const element = await render(created.slug, ["accounts", "a b"]);
    expect(element.props).toMatchObject({ slug: created.slug, base: `/previews/${preview.publicId}/`, src: `/previews/${preview.publicId}/accounts/a%20b`, commit: preview.commitSha, title: "Orders portal" });
  });

  it("is not found before a build succeeds, for an unknown application, and while previews are off", async () => {
    const created = onboard(app.db, config, repository);
    expect(await redirectOf(render(created.slug))).toBe("not-found");
    expect(await redirectOf(render("no-such-application"))).toBe("not-found");

    publishFiles(app.db, config, app.db.select().from(previewBuilds).where(eq(previewBuilds.id, created.latestPreviewId!)).get()!, { "index.html": "<h1>Orders</h1>" });
    setConfig(withOverrides(config, { previews: { enabled: false } }));
    expect(await redirectOf(render(created.slug))).toBe("not-found");
    // Nothing was deleted: it runs again once previews are back on.
    setConfig(config);
    expect((await render(created.slug)).props.slug).toBe(created.slug);
  });
});
