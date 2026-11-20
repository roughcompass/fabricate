import { describe, expect, it } from "vitest";
import { createApplication, prepareBranch } from "@/lib/applications/pipeline";
import { REF_LIMITS, buildRef, packageCode, refChoices, refPreview, remoteRefs } from "@/lib/applications/preview-mode";
import { cachedRemoteRefs, forgetRemoteRefs } from "@/lib/previews/ref-cache";
import type { RemoteRef } from "@/lib/previews/refs";
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
    expect(refChoices(application, listing)).toMatchObject({ tracked: "refs/heads/main", branches: [{ name: "refs/heads/feature/new-nav", commit: feature }], tags: [], total: { branches: 1, tags: 0 }, find: null });
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

  it("lists branches first and the highest-numbered tags up to their limits, finds the rest by name, and keeps the ref shown (thousands of tags)", () => {
    const ref = (name: string): RemoteRef => ({ name, label: name.replace(/^refs\/(heads|tags)\//, ""), kind: name.startsWith("refs/heads/") ? "branch" : "tag", commit: "a".repeat(40), configured: name === "refs/heads/main" });
    const tags = Array.from({ length: 3_000 }, (_, index) => ref(`refs/tags/v1.${Math.floor(index / 100)}.${index % 100}`));
    const branches = ["main", ...Array.from({ length: 60 }, (_, index) => `feature/${String(index).padStart(2, "0")}`)].map((name) => ref(`refs/heads/${name}`));
    const listing = { configured: { label: "main", request: { kind: "ref" as const, name: "main" } }, refs: [...branches, ...tags], unavailable: null };
    const application = { trackedRef: "refs/heads/main" };

    const plain = refChoices(application, listing);
    expect(plain.branches).toHaveLength(REF_LIMITS.branches);
    expect(plain.branches[0]!.label).toBe("feature/00");
    expect(plain.tags.map((tag) => tag.label).slice(0, 3)).toEqual(["v1.29.99", "v1.29.98", "v1.29.97"]);
    expect(plain.tags).toHaveLength(REF_LIMITS.tags);
    expect(plain.total).toEqual({ branches: 60, tags: 3_000 });

    const found = refChoices(application, listing, { find: " V1.3.4 " });
    expect(found.find).toEqual({ text: "V1.3.4", matched: 11 });
    expect(found.tags.map((tag) => tag.label)).toEqual(["v1.3.49", "v1.3.48", "v1.3.47", "v1.3.46", "v1.3.45", "v1.3.44", "v1.3.43", "v1.3.42", "v1.3.41", "v1.3.40", "v1.3.4"]);
    const many = refChoices(application, listing, { find: "v1" });
    expect(many.find!.matched).toBe(3_000);
    expect(many.branches.length + many.tags.length).toBe(REF_LIMITS.matches);

    // A ref shown from a search stays listed once the search is gone.
    expect(refChoices(application, listing, { selected: "refs/tags/v1.0.7" }).tags[0]!.label).toBe("v1.0.7");
    expect(refChoices(application, listing, { selected: "refs/heads/feature/59" }).branches[0]!.label).toBe("feature/59");
  });

  it("reads a remote's refs once a minute, shares a read under way, and reads again after Show", async () => {
    const repository = { cloneUrl: "https://git.example.com/acme/orders.git", gitRef: null };
    let reads = 0;
    const read = async () => {
      reads += 1;
      return { configured: { label: "Default branch", request: { kind: "ref" as const, name: null } }, refs: [], unavailable: null };
    };
    const cached = withOverrides(world.config, { previews: { refCacheSeconds: 60 } });
    forgetRemoteRefs(repository);
    await Promise.all([cachedRemoteRefs(repository, { config: cached, read, now: 0 }), cachedRemoteRefs(repository, { config: cached, read, now: 10 })]);
    await cachedRemoteRefs(repository, { config: cached, read, now: 59_999 });
    expect(reads).toBe(1);
    await cachedRemoteRefs(repository, { config: cached, read, now: 60_000 });
    expect(reads).toBe(2);
    forgetRemoteRefs(repository);
    await cachedRemoteRefs(repository, { config: cached, read, now: 60_001 });
    expect(reads).toBe(3);
    // 0 reads the remote on every view.
    const uncached = withOverrides(world.config, { previews: { refCacheSeconds: 0 } });
    await cachedRemoteRefs(repository, { config: uncached, read, now: 60_002 });
    await cachedRemoteRefs(repository, { config: uncached, read, now: 60_003 });
    expect(reads).toBe(5);
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
