import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAction, rebuildAction } from "@/app/(operator)/applications/actions";
import ApplicationPage from "@/app/(operator)/applications/[slug]/page";
import ApplicationSettingsPage from "@/app/(operator)/applications/[slug]/settings/page";
import ApplicationsPage from "@/app/(operator)/applications/page";
import { GET as status } from "@/app/api/applications/status/route";
import { findApplication } from "@/lib/applications/records";
import type { Repository } from "@/lib/repositories/repository-records";
import { type FrontendRegistryConfig, getConfig, setConfig, withOverrides } from "@/lib/config";
import { buildRepository } from "../support/builders";
import { onboard } from "../support/applications";
import { formData, redirectOf, useAppDb } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);

/*
 * Applications' pages, actions, and status endpoint while previews are off
 * (add-applications task 1.3; applications/onboarding spec, "Applications are
 * available while previews are"): each answers not found, and nothing is
 * deleted, so the application is there again once previews are on.
 */

describe("application pages while previews are off", () => {
  const original = getConfig();
  const app = useAppDb();
  let repository: Repository;
  let config: FrontendRegistryConfig;

  beforeEach(() => {
    repository = buildRepository(app.db, { name: "spa-orders" });
    config = withOverrides(original, { previews: { enabled: true } });
    setConfig(config);
    onboard(app.db, config, repository);
  });
  afterEach(() => setConfig(original));

  const params = <T extends object>(value: T) => ({ params: Promise.resolve(value), searchParams: Promise.resolve({}) }) as never;

  it("answers not found for the Applications page, an application's page and settings, the status endpoint, and the actions, and finds them again once previews are on", async () => {
    const id = findApplication(app.db, "orders-portal")!.publicId;
    setConfig(withOverrides(config, { previews: { enabled: false } }));
    expect(await redirectOf(ApplicationsPage(params({})))).toBe("not-found");
    expect(await redirectOf(ApplicationPage(params({ slug: "orders-portal" })))).toBe("not-found");
    expect(await redirectOf(ApplicationSettingsPage(params({ slug: "orders-portal" })))).toBe("not-found");
    expect(await redirectOf(rebuildAction(formData({ application: "orders-portal" })))).toBe("not-found");
    expect(await redirectOf(deleteAction(formData({ application: "orders-portal" })))).toBe("not-found");
    expect(status(new Request(`http://localhost/api/applications/status?ids=${id}`)).status).toBe(404);

    setConfig(config);
    expect(findApplication(app.db, "orders-portal")).toMatchObject({ name: "Orders portal", status: "building" });
    const answer = await status(new Request(`http://localhost/api/applications/status?ids=${id},app_0000000000000000,nonsense`)).json();
    expect(answer).toMatchObject({ settling: true, applications: [{ id, name: "Orders portal", status: "building", image: "placeholder", settling: true }] });
    expect(typeof answer.version).toBe("string");
    expect(await ApplicationsPage(params({}))).toBeTruthy();
  });
});
