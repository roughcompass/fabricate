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
import { viewedApplication } from "@/lib/demo/access";
import { createShare } from "@/lib/demo/shares";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { ensureWorkspace } from "@/lib/demo/workspaces";
import { startPreview } from "@/lib/previews/records";
import { buildRepository } from "../support/builders";
import { decidedPreparation, nextCommit, onboard, qualifyingVerdict } from "../support/applications";
import { publishFiles } from "../support/previews";
import { redirectOf, useAppDb } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);
// A visitor with no workspace yet.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const visitorKey = () => newWorkspaceKey();

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
  share: string | null;
  notice: string | null;
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

  const render = (slug: string, route: string[] = [], query: Record<string, string> = {}) => RunRoute({ params: Promise.resolve({ slug, path: route }), searchParams: Promise.resolve(query) }) as Promise<ReactElement<RunningProps>>;
  const published = (preview: { id: number }) => publishFiles(app.db, config, app.db.select().from(previewBuilds).where(eq(previewBuilds.id, preview.id)).get()!, { "index.html": "<h1>Orders</h1>" });

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

  it("opens a share link's commit with the sharer's view, or the current build with a notice once that build is gone (Shared build pruned)", async () => {
    const created = onboard(app.db, config, repository);
    const current = published({ id: created.latestPreviewId! });
    const orders = viewedApplication(app.db, created.slug)!;
    const sharer = ensureWorkspace(app.db, visitorKey());
    // Another commit of the same package, built as a preview, as an earlier build would have been.
    const other = decidedPreparation(app.db, repository, [qualifyingVerdict()], nextCommit());
    const earlier = published(startPreview(app.db, other.publicId, ".").preview);

    const atEarlier = createShare(app.db, orders.id, sharer.id, { commit: earlier.commitSha, route: "/accounts" });
    expect((await render(created.slug, ["accounts"], { share: atEarlier })).props).toMatchObject({ base: `/previews/${earlier.publicId}/`, commit: earlier.commitSha, share: atEarlier, notice: null });

    const atCurrent = createShare(app.db, orders.id, sharer.id, { commit: current.commitSha, route: "/" });
    expect((await render(created.slug, [], { share: atCurrent })).props).toMatchObject({ base: `/previews/${current.publicId}/`, share: atCurrent, notice: null });

    const gone = nextCommit();
    const atGone = createShare(app.db, orders.id, sharer.id, { commit: gone, route: "/" });
    expect((await render(created.slug, [], { share: atGone })).props).toMatchObject({ base: `/previews/${current.publicId}/`, commit: current.commitSha, share: atGone, notice: `The shared commit ${gone.slice(0, 12)} is no longer available, so this is the current build.` });

    // A token that isn't this application's opens the visitor's own view of the current build.
    expect((await render(created.slug, [], { share: "A".repeat(43) })).props).toMatchObject({ base: `/previews/${current.publicId}/`, share: null, notice: null });
  });
});
