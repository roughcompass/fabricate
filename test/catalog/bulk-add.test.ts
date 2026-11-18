import { beforeEach, describe, expect, it, vi } from "vitest";
import { BULK_LIMIT, addRepositories, parseBulkLines } from "@/lib/catalog/bulk-add";
import { SourceBoundary } from "@/lib/catalog/source-boundary";
import { listSources } from "@/lib/catalog/source-records";
import { getConfig, withOverrides } from "@/lib/config";
import { type Db, setDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { versionsOf } from "@/lib/profiling/versions";
import { createTestDb } from "../support/db";
import { GitFixture } from "../support/git-fixture";
import { redirectOf } from "../support/next";

vi.mock("next/navigation", async () => (await import("../support/next")).navigationStub);
vi.mock("next/cache", async () => (await import("../support/next")).cacheStub);

describe("bulk lines", () => {
  it("reads one clone URL per line, with an optional reference, skipping blank lines and numbering them as pasted", () => {
    expect(parseBulkLines("https://github.com/vickykatoch/helios.git\n\n  git@example.com:acme/x.git  \r\nhttps://github.com/openmrs/openmrs-esm-core.git   release/1.2\n")).toEqual([
      { line: 1, text: "https://github.com/vickykatoch/helios.git", cloneUrl: "https://github.com/vickykatoch/helios.git", gitRef: "" },
      { line: 3, text: "git@example.com:acme/x.git", cloneUrl: "git@example.com:acme/x.git", gitRef: "" },
      { line: 4, text: "https://github.com/openmrs/openmrs-esm-core.git   release/1.2", cloneUrl: "https://github.com/openmrs/openmrs-esm-core.git", gitRef: "release/1.2" },
    ]);
  });
});

describe("adding Repositories in bulk", () => {
  let db: Db;
  let boundary: SourceBoundary;
  let fixture: GitFixture;
  beforeEach(() => {
    db = createTestDb();
    fixture = GitFixture.create("bulk");
    fixture.repo("fleet/orders").write("README.md", "orders").commit();
    boundary = new SourceBoundary(withOverrides(getConfig(), { allowedRoots: [fixture.dir("fleet")] }));
    return () => fixture.cleanup();
  });

  it("adds every line it can, named after its owner and repository and queued for profiling, and reports each refused line", () => {
    const result = addRepositories(
      db,
      [
        "https://github.com/vickykatoch/helios.git",
        "https://github.com/openmrs/openmrs-esm-core.git main",
        "git@github.com:acme/scp.git",
        "https://GitHub.com/vickykatoch/helios",
        "",
        `file://${fixture.dir("fleet")}/orders`,
        "file:///etc",
        "https://github.com/acme/bad-ref.git bad..ref",
      ].join("\n"),
      boundary,
    );

    expect(result.created.map((source) => [source.name, source.gitRef])).toEqual([
      ["vickykatoch-helios", null],
      ["openmrs-openmrs-esm-core", "main"],
      ["orders", null],
    ]);
    expect(result.failed.map((failure) => [failure.line, failure.message])).toEqual([
      [3, expect.stringMatching(/scp-style shorthand/)],
      [4, expect.stringMatching(/already registered as vickykatoch-helios/)],
      [7, expect.stringMatching(/outside the allowed source roots|allowed root/i)],
      [8, "Reference is not a valid branch, tag, or commit"],
    ]);
    for (const source of result.created) expect(versionsOf(db, source.id).map((version) => [version.trigger, version.assessment.state])).toEqual([["imported", "queued"]]);
  });

  it("refuses nothing to add, and more lines than the limit, before adding any", () => {
    expect(() => addRepositories(db, " \n\n", boundary)).toThrow(/at least one clone URL/);
    const many = Array.from({ length: BULK_LIMIT + 1 }, (_, index) => `https://git.example.com/acme/repo-${index}.git`).join("\n");
    expect(() => addRepositories(db, many, boundary)).toThrow(ValidationError);
    expect(listSources(db)).toEqual([]);
  });

  describe("the Server Action", () => {
    beforeEach(() => setDb(db));

    it("opens the list with a count when every line is added", async () => {
      const { addRepositoriesInBulk } = await import("@/app/(operator)/repositories/actions");
      const form = new FormData();
      form.set("urls", "https://github.com/vickykatoch/helios.git\nhttps://github.com/vickykatoch/atlas.git");
      expect(await redirectOf(addRepositoriesInBulk({ values: { urls: "" }, errors: {}, added: 0, failed: [] }, form))).toBe("/repositories?notice=bulk-added&count=2");
    });

    it("keeps only the refused lines, without echoing a credential", async () => {
      const { addRepositoriesInBulk } = await import("@/app/(operator)/repositories/actions");
      const form = new FormData();
      form.set("urls", "https://github.com/vickykatoch/helios.git\nhttps://user:hunter2@git.example.com/acme/app.git");
      const state = await addRepositoriesInBulk({ values: { urls: "" }, errors: {}, added: 0, failed: [] }, form);

      expect(state).toMatchObject({ added: 1, values: { urls: "https://[REDACTED]@git.example.com/acme/app.git" }, submission: 1 });
      expect(state.failed).toHaveLength(1);
      expect(JSON.stringify(state)).not.toContain("hunter2");
    });
  });
});
