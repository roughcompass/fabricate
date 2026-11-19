import { beforeAll, describe, expect, it } from "vitest";
import { surveyRefFor } from "@/lib/acquisition/mirror";
import { getConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { packageProducers, repositoryRelationships } from "@/lib/profiles/relationships";
import { currentRecipe, moveSurvey, pinSurvey, recordConfiguredResolution, requestSurvey } from "@/lib/surveys/records";
import { finishSurvey } from "@/lib/surveys/run";
import { buildRepository } from "../../support/builders";
import { createTestDb } from "../../support/db";
import { type MapWorld, seedMapWorld } from "../../support/map-world";
import { manifest, memoryProfile, sha1 } from "../../support/profiles";

describe("A repository's relationships", () => {
  let db: Db;
  let world: MapWorld;
  beforeAll(async () => {
    db = createTestDb();
    world = await seedMapWorld(db);
  });

  it("lists the repositories that use it and those it uses, from the newest Assessment Run that mapped it", () => {
    const tokens = repositoryRelationships(db, world.repositories["design-tokens"]!.id);
    expect(tokens.run?.publicId).toBe(world.run.publicId);
    expect(tokens.uses).toEqual([]);
    expect(tokens.usedBy.map((repository) => [repository.name, repository.types])).toEqual([
      ["fx-board", ["package_dependency"]],
      ["payee-hub", ["package_dependency"]],
      ["rates", ["package_dependency"]],
    ]);
    expect(tokens.mapHref).toMatch(new RegExp(`^/runs/${world.run.publicId}/map\\?focus=node_`));
    const shell = repositoryRelationships(db, world.repositories["access-shell"]!.id);
    expect(shell.uses.map((repository) => repository.name)).toContain("fx-board");
    expect(shell.uses.find((repository) => repository.name === "fx-board")!.types).toContain("composition");
  });

  it("knows no relationships for a repository no Assessment Run has mapped, which isn't the same as none", () => {
    expect(repositoryRelationships(db, buildRepository(db, { name: "unmapped" }).id)).toEqual({ run: null, uses: [], usedBy: [], mapHref: null });
  });
});

describe("Package producers across the fleet", () => {
  it("names the repository whose current Profile publishes a package, and never one whose package is private or only on a branch", async () => {
    const db = createTestDb();
    /** Surveys +source+ at a commit of its configured reference, or of a branch, whose package.json is +packageManifest+. */
    const surveyed = async (repository: ReturnType<typeof buildRepository>, packageManifest: string, fromConfiguredReference = true) => {
      const commitSha = sha1(`${repository.publicId}:${packageManifest}`);
      const { survey } = requestSurvey(db, { repositoryId: repository.id, commitSha, reference: "refs/heads/main", fromConfiguredReference, trigger: fromConfiguredReference ? "added" : "run", ...currentRecipe(getConfig()) });
      if (fromConfiguredReference) recordConfiguredResolution(db, repository.id, commitSha, new Date());
      const running = pinSurvey(db, moveSurvey(db, survey, "running", { attempts: 1 }), { treeSha: null, internalRef: surveyRefFor(survey.publicId) });
      finishSurvey(db, running, { document: (await memoryProfile({ "package.json": packageManifest }, { public_id: repository.publicId, name: repository.name }, commitSha)).document });
      return repository;
    };
    const tokens = await surveyed(buildRepository(db, { name: "design-tokens" }), manifest({ name: "@acme/design-tokens", version: "1.0.0" }));
    // A private workspace named like a public package, as mattermost's e2e workspace is named cypress.
    await surveyed(buildRepository(db, { name: "chat" }), manifest({ name: "cypress", private: true }));
    // A branch's Profile isn't the Repository's current one.
    await surveyed(tokens, manifest({ name: "@acme/next-tokens", version: "2.0.0-next.1" }), false);

    const producers = packageProducers(db, ["@acme/design-tokens", "@acme/next-tokens", "cypress", "react"]);
    expect([...producers.entries()]).toEqual([["@acme/design-tokens", [{ publicId: tokens.publicId, name: "design-tokens" }]]]);
    expect(packageProducers(db, []).size).toBe(0);
  });
});
