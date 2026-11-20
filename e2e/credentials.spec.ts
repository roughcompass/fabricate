import fs from "node:fs";
import path from "node:path";
import { getApplication } from "../src/lib/applications/records";
import { findPreview } from "../src/lib/previews/records";
import { attemptLogFile } from "../src/lib/previews/storage";
import { PLANTED, leakingBuild } from "../test/support/credentials";
import { offlineViteApp } from "../test/support/preview-trees";
import { onboarded, registered } from "./support/applications";
import { E2E_PREVIEWS } from "./support/env";
import { expect, test } from "./support/fixtures";
import { paths } from "./support/paths";
import { runJobs, serverConfig } from "./support/results";

/*
 * No credential a build prints reaches a page or a route (add-applications:
 * closing the redaction gap). An application's build prints every form
 * npm, Yarn, Git, and HTTP clients use, then fails; its log is then given
 * the same lines raw, as a log written before builds redacted their output
 * would hold them. Every page that shows the build or its log, every route
 * that serves them, and the agent routes are read, and none holds a secret.
 */

test.skip(!E2E_PREVIEWS, "Applications exist only while previews are on (E2E_PREVIEWS=0)");
test.setTimeout(120_000);

test("no credential a build prints reaches any page or route, as written or from an older log", async ({ page, request, db, sourcesDir }) => {
  await onboarded(db, [registered(db, path.join(sourcesDir, "orders-web"), leakingBuild(offlineViteApp())), "Orders portal"]);
  await runJobs(db);
  const application = getApplication(db, "orders-portal");
  expect(application.status).toBe("build_failed");
  const preview = findPreview(db, application.latest.build!.preview)!;
  const repository = application.repository.publicId;
  const preparation = db.$client.prepare("select public_id from preview_preparations order by id desc limit 1").pluck().get() as string;
  // An older log, from before builds redacted their output, holds the credentials as printed.
  fs.appendFileSync(attemptLogFile(serverConfig(), preview)!, `${PLANTED.map((planted) => planted.line).join("\n")}\n`);

  const pages = [paths.applications, paths.application("orders-portal"), paths.applicationPreview("orders-portal"), paths.applicationPreview("orders-portal", { view: "code" }), paths.repository(repository), paths.repositoryPreview(repository, preview.publicId)];
  const routes = [
    `/api/previews/${preview.publicId}/log`,
    `/api/previews/${preview.publicId}/log?from=0&log=${path.posix.basename(preview.attemptLog!, ".log")}`,
    paths.applicationsStatus([application.publicId]),
    `/api/applications/eligibility?preparation=${preparation}&preview=${preview.publicId}`,
    `/api/repositories/${repository}/previews`,
    "/llms.txt",
    "/llms-full.txt",
  ];
  // The Repository's Profile, which agents read, answers too once its configured reference is surveyed; here it may not be yet.
  const profile = await request.get(`/repositories/${repository}/profile.json`);
  for (const { form, secret } of PLANTED) expect((await profile.text()).includes(secret), `${form} in profile.json`).toBe(false);
  for (const address of [...pages, ...routes]) {
    const response = await request.get(address);
    expect(response.status(), address).toBe(200);
    const body = await response.text();
    for (const { form, secret } of PLANTED) expect(body.includes(secret), `${form} in ${address}`).toBe(false);
  }

  // As the browser shows them, after the log's client has read it.
  for (const address of pages) {
    await page.goto(address);
    await page.waitForLoadState("networkidle");
    const shown = await page.content();
    for (const { form, secret } of PLANTED) expect(shown.includes(secret), `${form} on ${address}`).toBe(false);
  }

  // The failure detail and the log show where each one was, redacted.
  await page.goto(paths.application("orders-portal"));
  await expect(page.locator("#page-alerts pre")).toContainText("[REDACTED]");
  await page.goto(paths.repositoryPreview(repository, preview.publicId));
  await expect(page.getByRole("figure", { name: /^Attempt \d+ log$/ })).toContainText("//registry.example.com/:_authToken=[REDACTED]");
});
