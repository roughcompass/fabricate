import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb, migrateUpTo } from "../support/db";
import { migrationFolderAt } from "../support/migrations";

/*
 * Migration 0051 (establish-frontend-registry, task 4.8): surveys gain the
 * Reference Catalog part of their recipe, recorded when they succeed, and the
 * trigger `catalog`. The table is rebuilt, so every survey, every reference
 * to one, and every trigger that reads surveys must come through unchanged.
 */

const T0 = 1_790_000_000_000;
const RELEASE = "0.6.0";
const CONFIG = "1".repeat(64);
const MAIN = "a".repeat(40);
const NEXT = "b".repeat(40);

describe("survey Catalog recipes migration", () => {
  let db: Db;
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  const get = <T>(statement: string, ...values: unknown[]) => db.$client.prepare(statement).get(...values) as T;
  const survey = (number: number, commit: string, state: string, extra: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      public_id: `srv_${String(number).padEnd(16, "0")}`,
      repository_source_id: 1,
      number,
      commit_sha: commit,
      reference: "refs/heads/main",
      from_configured_reference: 1,
      resolved_at: T0,
      surveyor_release: RELEASE,
      configuration_digest: CONFIG,
      profile_schema_version: 2,
      state: "queued",
      trigger: "added",
      created_at: T0 + number,
      ...extra,
    };
    run(`insert into surveys (${Object.keys(row).join(", ")}) values (${Object.keys(row).map(() => "?").join(", ")})`, ...Object.values(row));
    const id = get<{ id: number }>("select id from surveys where number = ?", number).id;
    if (state === "queued") return id;
    run("update surveys set state = 'running', attempts = 1, internal_ref = ? where id = ?", `refs/fabricate/snapshots/srv_${number}`, id);
    if (state === "succeeded") run("insert into repository_profiles (public_id, survey_id, schema_version, detector_release, document, digest, created_at) values (?, ?, 2, ?, '{}', ?, ?)", `prf_${String(number).padEnd(16, "0")}`, id, RELEASE, "c".repeat(64), T0);
    if (state !== "running") run("update surveys set state = ?, finished_at = ?, failure_code = ? where id = ?", state, T0 + 100, state === "failed" ? "analysis_failed" : null, id);
    return id;
  };

  beforeEach(() => {
    db = createTestDb(migrationFolderAt("0050_catalog_entries"));
    run("insert into repository_sources (public_id, name, clone_url, canonical_url, created_at, updated_at) values ('src_web0000000000000', 'web', 'https://git.example.com/acme/web.git', 'https://git.example.com/acme/web', ?, ?)", T0, T0);
    const current = survey(1, MAIN, "succeeded");
    survey(2, NEXT, "failed");
    survey(3, NEXT, "queued", { configuration_digest: "2".repeat(64), trigger: "recipe" });
    run("update repository_sources set configured_commit = ?, configured_resolved_at = ?, current_survey_id = ? where id = 1", MAIN, T0, current);
    migrateUpTo(db, "0051_survey_catalog_recipes");
  });

  it("keeps every survey and the references to it, with no Catalog recipe recorded", () => {
    expect(db.$client.prepare("select number, state, trigger, catalog, catalog_digest from surveys order by number").all()).toEqual([
      { number: 1, state: "succeeded", trigger: "added", catalog: null, catalog_digest: null },
      { number: 2, state: "failed", trigger: "added", catalog: null, catalog_digest: null },
      { number: 3, state: "queued", trigger: "recipe", catalog: null, catalog_digest: null },
    ]);
    expect(get("select current_survey_id as id from repository_sources")).toEqual({ id: 1 });
    expect(get("select survey_id from repository_profiles")).toEqual({ survey_id: 1 });
    expect(db.$client.prepare("select * from pragma_foreign_key_check").all()).toEqual([]);
  });

  it("accepts the trigger catalog, and records a Catalog recipe only on a successful survey", () => {
    const id = survey(4, MAIN, "running", { trigger: "catalog" });
    const recipe = '{"entries":[],"things":["design_system:salt"]}';
    expect(() => run("update surveys set catalog = ?, catalog_digest = ? where id = ?", recipe, "d".repeat(64), id)).toThrow(/surveys_catalog/);
    run("insert into repository_profiles (public_id, survey_id, schema_version, detector_release, document, digest, created_at) values ('prf_4000000000000000', ?, 3, ?, '{}', ?, ?)", id, RELEASE, "e".repeat(64), T0);
    run("update surveys set state = 'succeeded', finished_at = ?, catalog = ?, catalog_digest = ? where id = ?", T0, recipe, "d".repeat(64), id);
    expect(get("select trigger, catalog from surveys where id = ?", id)).toEqual({ trigger: "catalog", catalog: recipe });
    expect(() => run("insert into surveys (public_id, repository_source_id, number, commit_sha, reference, from_configured_reference, resolved_at, surveyor_release, configuration_digest, profile_schema_version, trigger, created_at) values ('srv_9', 1, 5, ?, 'main', 1, ?, ?, ?, 2, 'detector', ?)", MAIN, T0, RELEASE, CONFIG, T0)).toThrow(/surveys_trigger/);
  });

  it("allows several successful surveys of one commit and recipe, but only one on its way or failed", () => {
    // Survey 1 succeeded on MAIN; a second, under new entries, may run and succeed too.
    survey(4, MAIN, "succeeded", { trigger: "catalog" });
    survey(5, MAIN, "queued", { trigger: "catalog" });
    expect(() => survey(6, MAIN, "queued", { trigger: "manual" })).toThrow(/UNIQUE constraint failed: surveys/);
    // Survey 2 failed on NEXT, so NEXT has no room for another until it's retried.
    expect(() => survey(6, NEXT, "queued")).toThrow(/UNIQUE constraint failed: surveys/);
  });

  it("keeps the triggers that guard surveys and the records that point at them", () => {
    expect(() => run("delete from surveys where number = 1")).toThrow(/surveys are retained/);
    expect(() => run("update surveys set commit_sha = ? where number = 1", NEXT)).toThrow(/a terminal survey cannot change/);
    expect(() => run("update surveys set commit_sha = ? where number = 3", MAIN)).toThrow(/keeps its Repository, number, commit, and recipe/);
    expect(() => run("update surveys set state = 'succeeded' where number = 3")).toThrow(/state transition is not allowed/);
    expect(() => survey(9, MAIN, "queued")).toThrow(/takes its Repository's next number/);
    expect(() => run("insert into repository_profiles (public_id, survey_id, schema_version, detector_release, document, digest, created_at) values ('prf_x', 3, 2, ?, '{}', ?, ?)", RELEASE, "f".repeat(64), T0)).toThrow(/written by its running survey/);
    expect(() => run("update repository_sources set current_survey_id = 2")).toThrow(/the current survey is a successful survey/);
    expect(db.$client.prepare("select name from sqlite_master where type = 'trigger' and (tbl_name = 'surveys' or sql like '%surveys%') order by name").all().map((row) => (row as { name: string }).name)).toEqual([
      "assessment_targets_survey_matches",
      "preview_preparations_survey_matches",
      "repository_profiles_written_by_survey",
      "repository_sources_current_survey",
      "surveys_identity_fixed",
      "surveys_initial_state",
      "surveys_never_deleted",
      "surveys_numbered",
      "surveys_pin_fixed",
      "surveys_state_transitions",
      "surveys_terminal_frozen",
    ]);
  });
});
