import { describe, expect, it } from "vitest";
import { createApplication, prepareBranch } from "@/lib/applications/pipeline";
import { buildRef, packageCode, refChoices, refPreview, remoteRefs } from "@/lib/applications/preview-mode";
import { getApplication } from "@/lib/applications/records";
import { type FrontendRegistryConfig, withOverrides } from "@/lib/config";
import { failAttempt } from "@/lib/previews/records";
import { decide, refusedVerdict } from "../support/applications";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { publishFiles } from "../support/previews";
import { VITE_REACT_APP } from "../support/preview-trees";

/*
 * Preview mode's other refs and Code tab (add-applications tasks 7.2 and
 * 7.3): another branch or tag is built as a repository preview of the
 * application's package and shown through its states, never changing the
 * application; the Code tab lists the package's committed files at the
 * commit shown, the manifest first chosen, a sensitive file listed unread.
 */

describe("preview mode", () => {
  const world = useAcquisitionWorld("preview-mode");
  let config: FrontendRegistryConfig;

  async function ordersPortal() {
    const work = world.fixture.repo("work/orders");
    for (const [file, content] of Object.entries({ ...VITE_REACT_APP, ".npmrc": "//registry.example.com/:_authToken=secret\n" })) work.write(file, content);
    work.commit("initial");
    work.git("checkout", "--quiet", "-b", "feature/new-nav");
    work.write("src/nav.ts", "export const nav = 1;\n");
    const feature = work.commit("New nav");
    work.checkout("main");
    const remote = world.fixture.bare("remotes/orders.git", { from: work });
    const repository = registerLocalRepository(world.db, world.config, "orders", remote.path);
    config = withOverrides(world.config, { previews: { enabled: true } });
    const preparation = decide(world.db, repository, await prepareBranch(world.db, repository.publicId, "main", { config }));
    createApplication(world.db, { repository: repository.publicId, branch: "main", packageDir: ".", preparation: preparation.publicId, name: "Orders portal", description: "", trusted: true }, config);
    return { repository, feature };
  }

  it("builds another branch as a preview of the package, follows its states, and leaves the application as it was (Previewing a feature branch)", async () => {
    const { repository, feature } = await ordersPortal();
    const application = getApplication(world.db, "orders-portal");
    let listing = await remoteRefs(application, world.db, config);
    expect(refChoices(application, listing)).toMatchObject({ tracked: "refs/heads/main", others: [{ name: "refs/heads/feature/new-nav", commit: feature }] });
    expect(refPreview(world.db, application, "refs/heads/feature/new-nav", listing)).toEqual({ kind: "unbuilt", commitSha: feature });
    expect(refPreview(world.db, application, "refs/heads/nowhere", listing)).toMatchObject({ kind: "unknown", reason: "The remote has no nowhere." });

    await buildRef(world.db, application, "refs/heads/feature/new-nav", config);
    listing = await remoteRefs(application, world.db, config);
    const checking = refPreview(world.db, application, "refs/heads/feature/new-nav", listing);
    expect(checking.kind).toBe("checking");
    if (checking.kind !== "checking") return;
    decide(world.db, repository, checking.preparation);
    // A decided commit with one qualifying package needs Show again to build it here, as the preparation job would have.
    await buildRef(world.db, application, "refs/heads/feature/new-nav", config);
    const building = refPreview(world.db, application, "refs/heads/feature/new-nav", listing);
    expect(building).toMatchObject({ kind: "building", commitSha: feature });
    if (building.kind !== "building") return;
    failAttempt(world.db, building.preview.publicId, { attempt: 1 }, "vite build exited with code 1");
    expect(refPreview(world.db, application, "refs/heads/feature/new-nav", listing)).toMatchObject({ kind: "failed", reason: "vite build exited with code 1" });
    await buildRef(world.db, application, "refs/heads/feature/new-nav", config);
    const rebuilt = refPreview(world.db, application, "refs/heads/feature/new-nav", listing);
    expect(rebuilt).toMatchObject({ kind: "building", preview: { attempt: 2 } });
    if (rebuilt.kind !== "building") return;
    publishFiles(world.db, config, rebuilt.preview, { "index.html": "<h1>New nav</h1>" });
    expect(refPreview(world.db, application, "refs/heads/feature/new-nav", listing)).toMatchObject({ kind: "ready" });
    expect(getApplication(world.db, "orders-portal")).toMatchObject({ trackedBranch: "main", latest: { commitSha: application.latest.commitSha } });
  });

  it("shows a refused ref's failed conditions", async () => {
    const { repository } = await ordersPortal();
    const application = getApplication(world.db, "orders-portal");
    await buildRef(world.db, application, "refs/heads/feature/new-nav", config);
    const listing = await remoteRefs(application, world.db, config);
    const checking = refPreview(world.db, application, "refs/heads/feature/new-nav", listing);
    if (checking.kind !== "checking") throw new Error(checking.kind);
    decide(world.db, repository, checking.preparation, [refusedVerdict(".")]);
    expect(refPreview(world.db, application, "refs/heads/feature/new-nav", listing)).toMatchObject({ kind: "refused", reasons: ["No supported build tool applies to this package. Previews support Vite, webpack, Rspack, and Rsbuild."] });
  });

  it("lists the package's committed files with the manifest chosen first, and a sensitive .npmrc unread (Reading the manifest, Sensitive file)", async () => {
    await ordersPortal();
    const application = getApplication(world.db, "orders-portal");
    const code = await packageCode(application, application.latest.commitSha, null, { config });
    expect(code.selected).toBe("package.json");
    expect("text" in code.content && code.content.text).toContain('"name": "orders-spa"');
    expect(code.files.find((file) => file.path === ".npmrc")).toMatchObject({ skipped: { reason: "sensitive" } });
    expect(code.files.find((file) => file.path === "src/main.tsx")).toMatchObject({ skipped: null });
    const npmrc = await packageCode(application, application.latest.commitSha, ".npmrc", { config });
    expect(npmrc).toMatchObject({ selected: ".npmrc", content: { skipped: "Files that commonly hold credentials are recorded but never read." } });
    expect(JSON.stringify(npmrc)).not.toContain("secret");
  });
});
