import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBuild } from "@/lib/catalog/build";
import { catalogConfiguration } from "@/lib/catalog/configuration";
import { storeEntry, storedEntries } from "@/lib/catalog/entries";
import { recipeDigest } from "@/lib/catalog/recipe";
import { entryCache } from "@/lib/catalog/supply";
import { type FrontendRegistryConfig, withOverrides } from "@/lib/config";
import { jobs, surveys } from "@/lib/db/schema";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { currentProfile } from "@/lib/profiling/current";
import { profileDocument, profileOfSurvey } from "@/lib/profiles/profile-records";
import { type Repository, getRepository } from "@/lib/repositories/repository-records";
import { REQUEST_SURVEY, surveyRepository } from "@/lib/surveys/background";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { fakeRegistry, republished, saltEntry, saltPackages } from "../support/catalog";
import { manifest } from "../support/profiles";

/*
 * Surveys with Reference Catalog entries (establish-frontend-registry, tasks
 * 4.6 to 4.8): a survey is given every current entry from the database and
 * downloads nothing; its Profile, version 3, names the entries it used; and
 * its recipe records them, so a rebuilt entry surveys again only the
 * Repositories whose current survey used the earlier one.
 */

const SALT_APP = {
  "package.json": manifest({ name: "web", version: "1.0.0", dependencies: { "@salt-ds/core": "1.75.0", "@salt-ds/theme": "1.48.0" } }),
  "src/App.tsx": 'import { Button } from "@salt-ds/core";\nexport const App = () => <Button appearance="solid">Go</Button>;\n',
};

describe("surveys given Reference Catalog entries", () => {
  const world = useAcquisitionWorld("catalog-surveys");
  const downloads: string[] = [];
  let config: FrontendRegistryConfig;
  let web: Repository;
  let plain: Repository;

  const run = () => drainJobs(world.db, jobHandlers(world.db, config));
  const surveysOf = (repository: Repository) => world.db.select().from(surveys).where(eq(surveys.repositoryId, repository.id)).orderBy(asc(surveys.number)).all();
  const factDocument = (repository: Repository) => profileDocument(currentProfile(world.db, repository.id)!.profile).fact_document as Record<string, unknown> & { catalog_entries: unknown[]; categories: Record<string, { facts: { key: string; value: Record<string, unknown> }[] }> };

  beforeEach(async () => {
    config = world.config;
    entryCache.clear();
    // A survey never downloads: any request fails the test's expectations below.
    downloads.length = 0;
    vi.stubGlobal("fetch", (input: string | URL | Request) => {
      downloads.push(String(input));
      return Promise.reject(new Error("surveys don't download"));
    });
    const webWork = world.fixture.repo("fleet/web");
    for (const [file, text] of Object.entries(SALT_APP)) webWork.write(file, text);
    webWork.commit("first");
    const plainWork = world.fixture.repo("fleet/plain");
    plainWork.write("package.json", manifest({ name: "plain", version: "1.0.0", dependencies: { react: "19.3.1" } })).commit("first");
    web = registerLocalRepository(world.db, config, "web", webWork.path);
    plain = registerLocalRepository(world.db, config, "plain", plainWork.path);
  });
  afterEach(() => vi.unstubAllGlobals());

  const surveyBoth = async () => {
    for (const repository of [web, plain]) await surveyRepository(world.db, repository, "added", { config });
    await run();
  };

  it("reads the stored entries without downloading, and a second survey reuses the worker's cache", async () => {
    storeEntry(world.db, saltEntry());
    const before = entryCache.reads;

    await surveyRepository(world.db, web, "added", { config });
    await run();
    expect(entryCache.reads).toBe(before + 1);
    await surveyRepository(world.db, plain, "added", { config });
    await run();
    expect(entryCache.reads).toBe(before + 1);

    expect(downloads).toEqual([]);
    expect(factDocument(web).categories.design_systems!.facts.map((fact) => fact.key)).toEqual(["salt"]);
  });

  it("writes a version 3 Profile that names the Salt 1.75.0 entry and its digest (Profile names its Catalog entries)", async () => {
    const salt = saltEntry();
    storeEntry(world.db, salt);
    await surveyBoth();

    const { profile, survey } = currentProfile(world.db, web.id)!;
    expect(profileDocument(profile)).toMatchObject({ schema_version: 3, source: { public_id: web.publicId } });
    const named = { kind: "design_system", id: "salt", version: "1.75.0", format_version: 1, digest: salt.digest, wanted: { package: "@salt-ds/core", version: "1.75.0" } };
    expect(factDocument(web).catalog_entries).toEqual([named]);
    expect(factDocument(web).categories.design_systems!.facts[0]!.value.entry).toEqual({ version: "1.75.0", digest: salt.digest });
    // The survey's recipe records the entries, with the things it was given entries of.
    expect(survey.catalog).toEqual({ things: ["design_system:salt"], entries: [named] });
    expect(survey.catalogDigest).toBe(recipeDigest(survey.catalog!));
    // A Repository that doesn't use Salt names no entry, but was given Salt's.
    expect(factDocument(plain).catalog_entries).toEqual([]);
    expect(currentProfile(world.db, plain.id)!.survey.catalog).toEqual({ things: ["design_system:salt"], entries: [] });
  });

  it("surveys again, with the trigger catalog, only the Repositories whose current survey used a rebuilt entry (Salt entry rebuilt)", async () => {
    storeEntry(world.db, saltEntry());
    await surveyBoth();
    const [webBefore, plainBefore] = [currentProfile(world.db, web.id)!, currentProfile(world.db, plain.id)!];

    // Salt 1.75.0 is rebuilt from a later snapshot of Salt's published data, so its content and digest change.
    const mcp = saltPackages().find((item) => item.name === "@salt-ds/mcp")!;
    const registry = fakeRegistry([...saltPackages(), republished(mcp, "0.0.0-snapshot-20260415000000", "2026-04-15T00:00:00.000Z")]);
    config = withOverrides(world.config, { catalog: { registry: registry.registry } });
    const rebuilt = await runBuild(world.db, { kind: "design_system", id: "salt", version: "1.75.0", reason: "published" }, { config, fetch: registry.fetch });
    expect(rebuilt.stored).toBe(true);
    expect(rebuilt.entry.digest).not.toBe(saltEntry().digest);
    expect(storedEntries(world.db)).toHaveLength(2);

    // Only web's current survey used the earlier entry, so only web is requested.
    const requests = world.db.select().from(jobs).where(and(eq(jobs.kind, REQUEST_SURVEY), eq(jobs.state, "queued"))).all();
    expect(requests.map((job) => JSON.parse(job.payload) as unknown)).toEqual([{ repository: web.publicId, trigger: "check" }]);
    await run();

    const [first, second] = surveysOf(web);
    expect(second).toMatchObject({ number: 2, trigger: "catalog", commitSha: first!.commitSha, state: "succeeded", surveyorRelease: first!.surveyorRelease, configurationDigest: first!.configurationDigest });
    expect(second!.catalog!.entries.map((entry) => entry.digest)).toEqual([rebuilt.entry.digest]);
    expect(currentProfile(world.db, web.id)).toMatchObject({ version: 2 });
    // The earlier survey and its Profile remain.
    expect(profileOfSurvey(world.db, webBefore.survey.id)?.id).toBe(webBefore.profile.id);
    expect(surveysOf(plain)).toHaveLength(1);
    expect(currentProfile(world.db, plain.id)!.survey.id).toBe(plainBefore.survey.id);

    // Asking again finds both up to date.
    for (const repository of [web, plain]) expect(await surveyRepository(world.db, repository, "manual", { config })).toMatchObject({ status: "current" });
    expect(downloads).toEqual([]);
  });

  it("surveys a Repository again when a thing is described after its survey, as when the first Salt entry is built", async () => {
    await surveyBoth();
    // With no entries, Surveyor can't recognize Salt.
    expect(factDocument(web).categories.design_systems!.facts).toEqual([]);
    expect(currentProfile(world.db, web.id)!.survey.catalog).toEqual({ things: [], entries: [] });

    storeEntry(world.db, saltEntry());
    for (const repository of [web, plain]) expect(await surveyRepository(world.db, getRepository(world.db, repository.publicId), "check", { config })).toMatchObject({ status: "queued", survey: { number: 2, trigger: "catalog" } });
    await run();
    expect(factDocument(web).categories.design_systems!.facts.map((fact) => fact.key)).toEqual(["salt"]);
    expect(currentProfile(world.db, plain.id)!.survey.catalog!.things).toEqual(catalogConfiguration(config).things.map((thing) => thing.key));
  });
});
