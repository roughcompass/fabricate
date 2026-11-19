import { describe, expect, it } from "vitest";
import { onboardingPackages, readableName, repositoryForCloneUrl, searchRepositories, suggestedDetails } from "@/lib/applications/onboarding";
import { prepareBranch } from "@/lib/applications/pipeline";
import { withOverrides } from "@/lib/config";
import { ValidationError } from "@/lib/db/errors";
import { repositories } from "@/lib/db/schema";
import { decide, decidedPreparation, onboard, qualifyingVerdict, refusedVerdict } from "../support/applications";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { buildRepository } from "../support/builders";
import { VITE_REACT_APP } from "../support/preview-trees";
import { manifest } from "../support/profiles";

/*
 * Onboarding's steps below the page (add-applications tasks 5.2 to 5.5):
 * searching and adding Repositories, checking a branch without enrolling its
 * remote, the packages a commit offers with those already taken, and the
 * details its manifest suggests.
 */

describe("onboarding", () => {
  const world = useAcquisitionWorld("onboarding");
  const config = () => withOverrides(world.config, { previews: { enabled: true } });

  it("searches Repositories by name or clone URL, ignoring case, ten at most", () => {
    for (let index = 0; index < 12; index++) buildRepository(world.db, { name: `orders-${index}` });
    buildRepository(world.db, { name: "ledger", cloneUrl: "https://git.example.com/acme/ORDERS-ledger.git" });
    const { matches, more } = searchRepositories(world.db, "Orders");
    expect(matches).toHaveLength(10);
    expect(more).toBe(true);
    expect(searchRepositories(world.db, "orders-ledger").matches.map((repository) => repository.name)).toEqual(["ledger"]);
    expect(searchRepositories(world.db, "  ").matches).toEqual([]);
  });

  it("registers a new clone URL, reuses a known one in another form, and gives the catalog's reason for a rejected one (New clone URL, Rejected clone URL)", () => {
    const work = world.fixture.repo("work/orders");
    work.write("README.md", "orders\n").commit();
    const added = repositoryForCloneUrl(world.db, `file://${work.path}`, config());
    expect(added).toMatchObject({ registered: true, repository: { name: "orders" } });
    expect(repositoryForCloneUrl(world.db, `file://${work.path}/`, config())).toMatchObject({ registered: false, repository: { publicId: added.repository.publicId } });
    expect(world.db.select().from(repositories).all()).toHaveLength(1);
    expect(() => repositoryForCloneUrl(world.db, "https://user:secret@git.example.com/acme/orders.git", config())).toThrow(ValidationError);
    try {
      repositoryForCloneUrl(world.db, "https://user:secret@git.example.com/acme/orders.git", config());
    } catch (error) {
      expect((error as ValidationError).messagesFor("cloneUrl")).toEqual(["HTTPS clone URLs cannot contain a username, password, or access token; configure a credential helper instead"]);
    }
  });

  it("checks a branch of a remote that isn't enrolled, without enrolling it or building anything", async () => {
    const work = world.fixture.repo("work/orders");
    for (const [file, content] of Object.entries(VITE_REACT_APP)) work.write(file, content);
    const commit = work.commit("initial");
    const remote = world.fixture.bare("remotes/orders.git", { from: work });
    const repository = registerLocalRepository(world.db, world.config, "orders", remote.path);
    const preparation = await prepareBranch(world.db, repository.publicId, "main", { config: config() });
    expect(preparation).toMatchObject({ state: "profiling", commitSha: commit, refName: "refs/heads/main" });
    await expect(prepareBranch(world.db, repository.publicId, "nowhere", { config: config() })).rejects.toThrow(/no branch or tag named|has no refs\/heads\/nowhere/);
    await expect(prepareBranch(world.db, repository.publicId, "main", { config: withOverrides(config(), { previews: { enabled: false } }) })).rejects.toThrow("Previews are turned off");

    // The details its manifest suggests, read from the pinned commit.
    const decided = decide(world.db, repository, preparation, [qualifyingVerdict(".", { name: "orders-spa" })]);
    expect(await suggestedDetails(decided, repository, ".", { config: config() })).toEqual({ name: "Orders spa", description: "" });
  });

  it("suggests the manifest's name, made readable, and its description (Prefilled details)", async () => {
    const work = world.fixture.repo("work/orders");
    for (const [file, content] of Object.entries(VITE_REACT_APP)) work.write(file, content);
    work.write("package.json", manifest({ ...JSON.parse(VITE_REACT_APP["package.json"]!), name: "@acme/orders-portal", description: "Order tracking for partners" }));
    work.commit("initial");
    const remote = world.fixture.bare("remotes/orders.git", { from: work });
    const repository = registerLocalRepository(world.db, world.config, "orders", remote.path);
    const decided = decide(world.db, repository, await prepareBranch(world.db, repository.publicId, "main", { config: config() }));
    expect(await suggestedDetails(decided, repository, ".", { config: config() })).toEqual({ name: "Orders portal", description: "Order tracking for partners" });
    // A manifest that can't be read suggests the package name alone.
    expect(await suggestedDetails(decided, repository, "apps/missing", { config: config() })).toEqual({ name: "", description: "" });
    expect(readableName("@acme/admin_remote.v2")).toBe("Admin remote v2");
  });

  it("lists a commit's packages, those that qualify first, each that's already an application with it (Package already onboarded)", () => {
    const repository = buildRepository(world.db, { name: "monorepo" });
    onboard(world.db, config(), repository, { name: "Billing", packageDir: "apps/billing", preparation: decidedPreparation(world.db, repository, [qualifyingVerdict("apps/billing")]) });
    const preparation = decidedPreparation(world.db, repository, [refusedVerdict("packages/bus"), qualifyingVerdict("apps/shell", { name: "@acme/shell" }), qualifyingVerdict("apps/billing", { name: "@acme/billing" })]);
    expect(onboardingPackages(world.db, preparation).map((candidate) => [candidate.directory, candidate.qualifies, candidate.taken?.name ?? null, candidate.reason])).toEqual([
      ["apps/billing", true, "Billing", null],
      ["apps/shell", true, null, null],
      ["packages/bus", false, null, "No supported build tool applies to this package. Previews support Vite, webpack, Rspack, and Rsbuild."],
    ]);
  });
});
