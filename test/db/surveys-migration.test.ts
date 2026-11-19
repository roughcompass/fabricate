import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { createTestDb, migrateToLatest } from "../support/db";
import { migrationFolderAt } from "../support/migrations";

/*
 * Migration 0049 (unify-surveys, design decision 8): snapshots and their
 * Profiles become surveys, one per repository, commit, and recipe, numbered
 * per Repository in creation order. Duplicates of a key merge into the
 * earliest, keeping its Profile; a snapshot without a Profile becomes a
 * failed survey; a preview's own Profile becomes a preview survey. Run
 * targets and preview preparations link their surveys, the profiling
 * initiative goes with its Runs and their maps, and each Repository's current
 * survey is its newest successful one of its configured reference.
 * Evaluations are untouched.
 */

const BEFORE = "0048_source_leases_removed";
const PROFILING = "ini_repoprofiling000";
const T0 = 1_790_000_000_000;
/** +n+ minutes after T0. */
const at = (n: number) => T0 + n * 60_000;
const RELEASE = "0.6.0";
const CONFIG = "1".repeat(64);
const OTHER_CONFIG = "2".repeat(64);
const TREE = "f".repeat(40);
/** web's default branch: profiled in the background, then by a Run, under one recipe. */
const WEB_MAIN = "a".repeat(40);
/** web's default branch later: its background profile failed. */
const WEB_NEXT = "b".repeat(40);
/** A branch of web a Run assessed. */
const WEB_BRANCH = "c".repeat(40);
/** orders' main: assessed by a Run, then profiled in the background, then assessed under another configuration. */
const ORDERS_MAIN = "d".repeat(40);
/** A commit of orders only a preview profiled. */
const ORDERS_PREVIEW = "e".repeat(40);

const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
const publicId = (prefix: string, key: string) => `${prefix}_${key.padEnd(16, "0")}`;

interface Run {
  id: number;
  publicId: string;
  targets: Target[];
}

interface Target {
  id: number;
  publicId: string;
  key: string;
}

describe("surveys migration", () => {
  let db: Db;
  const run = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).run(...values);
  const all = (statement: string, ...values: unknown[]) => db.$client.prepare(statement).all(...values);
  const get = <T>(statement: string, ...values: unknown[]) => db.$client.prepare(statement).get(...values) as T;
  const idOf = (table: string, id: string) => get<{ id: number }>(`select id from ${table} where public_id = ?`, id).id;
  const columns = (table: string) => (all(`select name from pragma_table_info('${table}')`) as { name: string }[]).map((column) => column.name);
  const tables = () => (all("select name from sqlite_master where type = 'table'") as { name: string }[]).map((row) => row.name);

  function repository(name: string, gitRef: string | null): number {
    return Number(
      run(
        "insert into repository_sources (public_id, name, clone_url, canonical_url, git_ref, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
        publicId("src", name),
        name,
        `https://git.example.com/acme/${name}.git`,
        `https://git.example.com/acme/${name}`,
        gitRef,
        T0,
        T0,
      ).lastInsertRowid,
    );
  }

  /** A Run named +name+ of +initiative+, created at +time+ under +configurationDigest+, over +scope+ (repository and reference), moved to acquiring. */
  function startRun(name: string, initiative: number, time: number, configurationDigest: string, scope: readonly (readonly [number, string | null])[]): Run {
    const asm = publicId("asm", name);
    const id = Number(
      run(
        "insert into assessments (public_id, initiative_id, launch_token, detector_release, configuration, configuration_digest, profile_schema_version, relationship_schema_version, created_at, updated_at) values (?, ?, ?, ?, '{}', ?, 2, 1, ?, ?)",
        asm,
        initiative,
        crypto.randomUUID(),
        RELEASE,
        configurationDigest,
        time,
        time,
      ).lastInsertRowid,
    );
    const targets = scope.map(([repositoryId, gitRef], position) => {
      const key = `${name}t${position}`;
      const tgt = publicId("tgt", key);
      const targetId = Number(
        run(
          "insert into assessment_targets (public_id, assessment_id, repository_source_id, position, source_public_id, source_name, clone_url, canonical_url, git_ref, created_at, updated_at) select ?, ?, id, ?, public_id, name, clone_url, canonical_url, ?, ?, ? from repository_sources where id = ?",
          tgt,
          id,
          position,
          gitRef,
          time,
          time,
          repositoryId,
        ).lastInsertRowid,
      );
      return { id: targetId, publicId: tgt, key };
    });
    run("update assessments set state = 'acquiring', started_at = ? where id = ?", time, id);
    return { id, publicId: asm, targets };
  }

  /** Pins +target+ to +commit+, resolved from +resolvedRef+ at +time+, and moves it to analyzing. Returns the snapshot's id. */
  function pin(target: Target, commit: string, refKind: string, resolvedRef: string, time: number): number {
    run("update assessment_targets set state = 'acquiring', started_at = ? where id = ?", time, target.id);
    const snapshot = publicId("snp", target.key);
    const id = Number(
      run(
        "insert into source_snapshots (public_id, assessment_target_id, repository_source_id, commit_sha, tree_sha, ref_kind, resolved_ref, internal_ref, acquisition_metadata, acquired_at, created_at) select ?, id, repository_source_id, ?, ?, ?, ?, ?, '{}', ?, ? from assessment_targets where id = ?",
        snapshot,
        commit,
        TREE,
        refKind,
        resolvedRef,
        `refs/fabricate/snapshots/${snapshot}`,
        time,
        time,
        target.id,
      ).lastInsertRowid,
    );
    run("update assessment_targets set state = 'analyzing' where id = ?", target.id);
    return id;
  }

  /** Writes the Profile of +target+'s snapshot at +time+ and completes the target. Returns the Profile's id. */
  function profile(target: Target, snapshot: number, commit: string, time: number): number {
    const document = JSON.stringify({ commit, detector_release: RELEASE, schema: "fabricate.repository_profile", schema_version: 2, target: target.publicId });
    const id = Number(
      run(
        "insert into repository_profiles (public_id, assessment_id, assessment_target_id, source_snapshot_id, schema_version, detector_release, document, digest, created_at) select ?, assessment_id, id, ?, 2, ?, ?, ?, ? from assessment_targets where id = ?",
        publicId("prf", target.key),
        snapshot,
        RELEASE,
        document,
        sha256(document),
        time,
        target.id,
      ).lastInsertRowid,
    );
    run("update assessment_targets set state = 'complete', finished_at = ? where id = ?", time, target.id);
    return id;
  }

  function failTarget(target: Target, code: string, message: string, time: number): void {
    if (get<{ state: string }>("select state from assessment_targets where id = ?", target.id).state === "pending") run("update assessment_targets set state = 'acquiring' where id = ?", target.id);
    run("update assessment_targets set state = 'failed', failure_code = ?, failure_message = ?, finished_at = ? where id = ?", code, message, time, target.id);
  }

  /** Finalizes +assessment+ to +state+ at +time+, writing a Relationship Map first unless it failed. Returns the map's id. */
  function finishRun(assessment: Run, state: "complete" | "complete_with_issues" | "failed", time: number): number | null {
    run("update assessments set state = 'analyzing' where id = ?", assessment.id);
    if (state === "failed") {
      run("update assessments set state = 'failed', failure_reason = 'No repository could be assessed', finished_at = ? where id = ?", time, assessment.id);
      return null;
    }
    run("update assessments set state = 'finalizing' where id = ?", assessment.id);
    const document = JSON.stringify({ assessment: assessment.publicId, edges: [], nodes: [] });
    const map = Number(
      run(
        "insert into relationship_maps (public_id, assessment_id, schema_version, resolver_version, document, digest, created_at) values (?, ?, 1, '1', ?, ?, ?)",
        publicId("map", assessment.publicId.slice(4, 8)),
        assessment.id,
        document,
        sha256(document),
        time,
      ).lastInsertRowid,
    );
    for (const target of assessment.targets) {
      run(
        "insert into graph_nodes (map_id, assessment_id, node_id, kind, label, repository_source_id, assessment_target_id, document_digest, projection_version) select ?, assessment_id, ?, 'repository', source_name, repository_source_id, id, ?, 2 from assessment_targets where id = ?",
        map,
        `node_${target.key}`,
        sha256(document),
        target.id,
      );
    }
    run("update assessments set state = ?, finished_at = ? where id = ?", state, time, assessment.id);
    return map;
  }

  let web: number;
  let orders: number;
  let billing: number;
  let fleet: number;
  let profiling: number;
  const runs: Record<string, Run> = {};
  const profiles: Record<string, number> = {};
  let before: { evaluations: unknown[]; releases: unknown[]; findings: unknown[]; previews: unknown[] };

  beforeEach(() => {
    db = createTestDb(migrationFolderAt(BEFORE));
    // At 0048 the hidden profiling initiative exists, created by migration 0038.
    expect(all("select public_id, profiling from initiatives")).toEqual([{ public_id: PROFILING, profiling: 1 }]);
    profiling = idOf("initiatives", PROFILING);
    web = repository("web", null);
    orders = repository("orders", "main");
    billing = repository("billing", null);
    run("insert into initiatives (public_id, name, selection_mode, created_at, updated_at) values ('ini_fleet00000000000', 'Fleet', 'all', ?, ?)", T0, T0);
    fleet = idOf("initiatives", "ini_fleet00000000000");

    // 1. web is profiled in the background at WEB_MAIN, with a one-repository map.
    const p1 = (runs.p1 = startRun("p1", profiling, at(1), CONFIG, [[web, null]]));
    run("insert into profile_versions (repository_source_id, assessment_id, version, trigger, head_commit, created_at) values (?, ?, 1, 'imported', ?, ?)", web, p1.id, WEB_MAIN, at(1));
    profiles.p1 = profile(p1.targets[0]!, pin(p1.targets[0]!, WEB_MAIN, "default_branch", "refs/heads/main", at(1) + 1), WEB_MAIN, at(1) + 2);
    const p1Map = finishRun(p1, "complete", at(1) + 3)!;
    run(
      "insert into graph_edges (map_id, assessment_id, edge_id, type, state, from_node, to_node, rule, basis, evidence, document_digest, projection_version, reference_type, reference_identifier, kind) values (?, ?, 'edge_left_pad', 'package_dependency', 'unresolved', 'node_p1t0', 'node_left_pad', 'package-dependency', 'manifest', '[]', ?, 2, 'package', '{\"name\":\"left-pad\"}', 'third_party')",
      p1Map,
      p1.id,
      "0".repeat(64),
    );
    run("insert into graph_edge_candidates (map_id, assessment_id, edge_id, candidate_node, document_digest, projection_version) values (?, ?, 'edge_left_pad', 'node_left_pad', ?, 2)", p1Map, p1.id, "0".repeat(64));
    run(
      "insert into dependency_facts (profile_id, assessment_id, assessment_target_id, manifest, package_name, state, evidence, document_digest, projection_version) values (?, ?, ?, 'package.json', 'left-pad', 'observed', '[]', ?, 2)",
      profiles.p1,
      p1.id,
      p1.targets[0]!.id,
      "0".repeat(64),
    );

    // 2. An operator's Run over web and orders: web at the same commit and recipe, a duplicate of 1.
    const r1 = (runs.r1 = startRun("r1", fleet, at(2), CONFIG, [
      [web, null],
      [orders, "main"],
    ]));
    profiles.r1Web = profile(r1.targets[0]!, pin(r1.targets[0]!, WEB_MAIN, "default_branch", "refs/heads/main", at(2) + 1), WEB_MAIN, at(2) + 2);
    profiles.r1Orders = profile(r1.targets[1]!, pin(r1.targets[1]!, ORDERS_MAIN, "branch", "refs/heads/main", at(2) + 1), ORDERS_MAIN, at(2) + 2);
    finishRun(r1, "complete", at(2) + 3);
    run(
      "insert into evidence_index (profile_id, assessment_id, assessment_target_id, evidence_id, path, location_kind, detector, rule, document_digest, projection_version) values (?, ?, ?, 'ev_1', 'package.json', 'entry', 'package-metadata', 'manifest', ?, 2)",
      profiles.r1Web,
      r1.id,
      r1.targets[0]!.id,
      "0".repeat(64),
    );
    run("insert into jobs (kind, payload, idempotency_key, state, created_at, updated_at, run_after, finished_at) values ('assessment.finalize', ?, ?, 'succeeded', ?, ?, ?, ?)", JSON.stringify({ assessment: r1.publicId }), `assessment.finalize:${r1.publicId}`, at(2), at(2), at(2), at(2) + 3);

    // 3. web's next commit is profiled in the background and fails without a Profile; its target job is still recorded.
    const p2 = (runs.p2 = startRun("p2", profiling, at(3), CONFIG, [[web, null]]));
    run("insert into profile_versions (repository_source_id, assessment_id, version, trigger, head_commit, created_at) values (?, ?, 2, 'commit', ?, ?)", web, p2.id, WEB_NEXT, at(3));
    pin(p2.targets[0]!, WEB_NEXT, "default_branch", "refs/heads/main", at(3) + 1);
    failTarget(p2.targets[0]!, "analysis_failed", "Surveyor stopped", at(3) + 2);
    finishRun(p2, "failed", at(3) + 3);
    run("insert into jobs (kind, payload, idempotency_key, state, attempts, last_error, created_at, updated_at, run_after, finished_at) values ('assessment.target', ?, ?, 'failed', 3, 'Surveyor stopped', ?, ?, ?, ?)", JSON.stringify({ assessment: p2.publicId, target: p2.targets[0]!.publicId }), `assessment.target:${p2.targets[0]!.publicId}`, at(3), at(3), at(3), at(3) + 2);

    // 4. A Run on a branch of web: newer than web's background survey, but not its configured reference.
    const r2 = (runs.r2 = startRun("r2", fleet, at(4), CONFIG, [[web, "feature/x"]]));
    profiles.r2 = profile(r2.targets[0]!, pin(r2.targets[0]!, WEB_BRANCH, "branch", "refs/heads/feature/x", at(4) + 1), WEB_BRANCH, at(4) + 2);
    finishRun(r2, "complete", at(4) + 3);

    // 5. orders is profiled in the background at the commit and recipe the operator's Run already profiled: a later duplicate.
    const p3 = (runs.p3 = startRun("p3", profiling, at(5), CONFIG, [[orders, "main"]]));
    run("insert into profile_versions (repository_source_id, assessment_id, version, trigger, head_commit, created_at) values (?, ?, 1, 'added', ?, ?)", orders, p3.id, ORDERS_MAIN, at(5));
    profiles.p3 = profile(p3.targets[0]!, pin(p3.targets[0]!, ORDERS_MAIN, "branch", "refs/heads/main", at(5) + 1), ORDERS_MAIN, at(5) + 2);
    finishRun(p3, "complete", at(5) + 3);

    // 6. A Run under another configuration: orders' main again, a new key; web couldn't be reached.
    const r3 = (runs.r3 = startRun("r3", fleet, at(6), OTHER_CONFIG, [
      [orders, "main"],
      [web, null],
    ]));
    profiles.r3 = profile(r3.targets[0]!, pin(r3.targets[0]!, ORDERS_MAIN, "branch", "refs/heads/main", at(6) + 1), ORDERS_MAIN, at(6) + 2);
    failTarget(r3.targets[1]!, "source_unavailable", "The repository could not be reached", at(6) + 1);
    finishRun(r3, "complete_with_issues", at(6) + 3);

    // An Evaluation of the operator's first Run, with a Finding on its web target.
    const release = JSON.stringify({ controls: [], schema: "fabricate.standard", schema_version: 1 });
    run("insert into standards (public_id, name, purpose, created_at, updated_at) values ('std_baseline00000000', 'Baseline', 'Engineering baseline', ?, ?)", T0, T0);
    run(
      "insert into standard_releases (public_id, standard_id, version, document_schema_version, document, digest, profile_schema_versions, relationship_schema_versions, draft_lock_version, published_at, created_at) select 'rel_baseline00000000', id, 1, 1, ?, ?, '[2]', '[1]', 0, ?, ? from standards",
      release,
      sha256(release),
      T0,
      T0,
    );
    run(
      "insert into evaluations (public_id, initiative_id, assessment_id, launch_token, evaluator_version, configuration, configuration_digest, profile_schema_version, relationship_schema_version, coverage_gaps, created_at, updated_at) values ('evl_baseline00000000', ?, ?, ?, '1', '{}', ?, 2, 1, '[]', ?, ?)",
      fleet,
      r1.id,
      crypto.randomUUID(),
      "3".repeat(64),
      at(7),
      at(7),
    );
    const evaluation = idOf("evaluations", "evl_baseline00000000");
    run("insert into evaluation_releases (evaluation_id, standard_release_id, release_digest, position, created_at, updated_at) select ?, id, digest, 0, ?, ? from standard_releases", evaluation, at(7), at(7));
    run("update evaluations set state = 'evaluating', started_at = ? where id = ?", at(7), evaluation);
    run("update evaluation_releases set state = 'evaluating', started_at = ? where evaluation_id = ?", at(7), evaluation);
    run(
      "insert into findings (public_id, evaluation_id, evaluation_release_id, standard_release_id, assessment_target_id, control_key, subject_type, subject_key, outcome, severity, position, document_schema_version, document, digest, created_at) select 'fnd_web0000000000000', evaluation_id, id, standard_release_id, ?, 'node', 'repository', 'src_web0000000000000', 'gap', 'high', 0, 1, '{}', ?, ? from evaluation_releases where evaluation_id = ?",
      r1.targets[0]!.id,
      sha256("{}"),
      at(7),
      evaluation,
    );
    run("update evaluation_releases set state = 'complete', finished_at = ? where evaluation_id = ?", at(7) + 1, evaluation);
    run("update evaluations set state = 'finalizing' where id = ?", evaluation);
    run("update evaluations set state = 'complete', summary = '{}', result_digest = ?, finished_at = ? where id = ?", "4".repeat(64), at(7) + 2, evaluation);

    // Preview preparations: one decided from the operator Run's duplicate Profile, built; one from a Profile of its own; one still profiling.
    const r1WebProfile = get<{ digest: string }>("select digest from repository_profiles where id = ?", profiles.r1Web);
    run(
      "insert into preview_preparations (public_id, repository_source_id, commit_sha, ref_name, ref_kind, state, repository_profile_id, profile_digest, packages, requested_at, created_at, updated_at, finished_at) values ('ppr_webmain000000000', ?, ?, 'refs/heads/main', 'branch', 'ready', ?, ?, '[]', ?, ?, ?, ?)",
      web,
      WEB_MAIN,
      profiles.r1Web,
      r1WebProfile.digest,
      at(8),
      at(8),
      at(8) + 1,
      at(8) + 1,
    );
    run(
      "insert into preview_builds (public_id, repository_source_id, preparation_id, commit_sha, package_dir, ref_name, ref_kind, profile_digest, deciding_facts, created_at, updated_at) select 'pvw_webmain000000000', repository_source_id, id, commit_sha, '.', ref_name, ref_kind, profile_digest, '{}', ?, ? from preview_preparations where public_id = 'ppr_webmain000000000'",
      at(8) + 2,
      at(8) + 2,
    );
    const previewDocument = JSON.stringify({ commit: ORDERS_PREVIEW, detector_configuration_digest: CONFIG, detector_release: RELEASE, schema: "fabricate.repository_profile", schema_version: 2 });
    run(
      "insert into preview_preparations (public_id, repository_source_id, commit_sha, ref_name, ref_kind, state, profile_document, profile_digest, packages, refusal, requested_at, created_at, updated_at, finished_at) values ('ppr_orderspreview000', ?, ?, 'refs/heads/release', 'branch', 'refused', ?, ?, '[]', '{\"reason\":\"No package qualifies for a preview\"}', ?, ?, ?, ?)",
      orders,
      ORDERS_PREVIEW,
      previewDocument,
      sha256(previewDocument),
      at(9),
      at(9),
      at(9) + 1,
      at(9) + 1,
    );
    run("insert into preview_preparations (public_id, repository_source_id, commit_sha, ref_name, ref_kind, requested_at, created_at, updated_at) values ('ppr_webbranch0000000', ?, ?, 'refs/heads/feature/x', 'branch', ?, ?, ?)", web, WEB_BRANCH, at(10), at(10), at(10));

    before = {
      evaluations: all("select * from evaluations"),
      releases: all("select * from evaluation_releases"),
      findings: all("select * from findings"),
      previews: all("select * from preview_builds"),
    };
    migrateToLatest(db);
  });
  afterEach(() => db.$client.close());

  const surveyOf = (repositoryId: number, number: number) => get<{ id: number; public_id: string }>("select id, public_id from surveys where repository_source_id = ? and number = ?", repositoryId, number);

  it("makes one survey per repository, commit, and recipe, numbered per Repository in creation order", () => {
    const snapshot = (key: string) => `refs/fabricate/snapshots/${publicId("snp", key)}`;
    expect(
      all(
        "select repository_source_id, number, commit_sha, tree_sha, internal_ref, reference, from_configured_reference, resolved_at, surveyor_release, configuration_digest, profile_schema_version, state, attempts, failure_code, failure_message, trigger, requested_by_assessment_id, created_at, finished_at from surveys order by repository_source_id, number",
      ),
    ).toEqual([
      // Background profiling came first; the operator's Run of the same key joined it.
      { repository_source_id: web, number: 1, commit_sha: WEB_MAIN, tree_sha: TREE, internal_ref: snapshot("p1t0"), reference: "refs/heads/main", from_configured_reference: 1, resolved_at: at(1) + 1, surveyor_release: RELEASE, configuration_digest: CONFIG, profile_schema_version: 2, state: "succeeded", attempts: 1, failure_code: null, failure_message: null, trigger: "added", requested_by_assessment_id: null, created_at: at(1) + 1, finished_at: at(1) + 2 },
      // A snapshot without a Profile is a failed survey, with its target's failure.
      { repository_source_id: web, number: 2, commit_sha: WEB_NEXT, tree_sha: TREE, internal_ref: snapshot("p2t0"), reference: "refs/heads/main", from_configured_reference: 1, resolved_at: at(3) + 1, surveyor_release: RELEASE, configuration_digest: CONFIG, profile_schema_version: 2, state: "failed", attempts: 1, failure_code: "analysis_failed", failure_message: "Surveyor stopped", trigger: "commit", requested_by_assessment_id: null, created_at: at(3) + 1, finished_at: at(3) + 2 },
      { repository_source_id: web, number: 3, commit_sha: WEB_BRANCH, tree_sha: TREE, internal_ref: snapshot("r2t0"), reference: "refs/heads/feature/x", from_configured_reference: 0, resolved_at: at(4) + 1, surveyor_release: RELEASE, configuration_digest: CONFIG, profile_schema_version: 2, state: "succeeded", attempts: 1, failure_code: null, failure_message: null, trigger: "run", requested_by_assessment_id: runs.r2!.id, created_at: at(4) + 1, finished_at: at(4) + 2 },
      // The operator's Run came first; the later background profile of the same key joined it.
      { repository_source_id: orders, number: 1, commit_sha: ORDERS_MAIN, tree_sha: TREE, internal_ref: snapshot("r1t1"), reference: "refs/heads/main", from_configured_reference: 1, resolved_at: at(2) + 1, surveyor_release: RELEASE, configuration_digest: CONFIG, profile_schema_version: 2, state: "succeeded", attempts: 1, failure_code: null, failure_message: null, trigger: "run", requested_by_assessment_id: runs.r1!.id, created_at: at(2) + 1, finished_at: at(2) + 2 },
      // The same commit under another configuration is another survey.
      { repository_source_id: orders, number: 2, commit_sha: ORDERS_MAIN, tree_sha: TREE, internal_ref: snapshot("r3t0"), reference: "refs/heads/main", from_configured_reference: 1, resolved_at: at(6) + 1, surveyor_release: RELEASE, configuration_digest: OTHER_CONFIG, profile_schema_version: 2, state: "succeeded", attempts: 1, failure_code: null, failure_message: null, trigger: "run", requested_by_assessment_id: runs.r3!.id, created_at: at(6) + 1, finished_at: at(6) + 2 },
      // A preview's own Profile is a preview survey, numbered after the rest.
      { repository_source_id: orders, number: 3, commit_sha: ORDERS_PREVIEW, tree_sha: null, internal_ref: `refs/fabricate/previews/${ORDERS_PREVIEW}`, reference: "refs/heads/release", from_configured_reference: 0, resolved_at: at(9), surveyor_release: RELEASE, configuration_digest: CONFIG, profile_schema_version: 2, state: "succeeded", attempts: 1, failure_code: null, failure_message: null, trigger: "preview", requested_by_assessment_id: null, created_at: at(9), finished_at: at(9) + 1 },
    ]);
    expect(all("select public_id from surveys where public_id not glob 'srv_*'")).toEqual([]);
  });

  it("keeps the earliest Profile of each key, attached to its survey, and makes a preview's own Profile a Profile of its survey", () => {
    const previewDocument = get<{ document: string; digest: string }>("select document, digest from repository_profiles where survey_id = ?", surveyOf(orders, 3).id);
    expect(all("select id, public_id, survey_id from repository_profiles order by id")).toEqual([
      { id: profiles.p1, public_id: publicId("prf", "p1t0"), survey_id: surveyOf(web, 1).id },
      { id: profiles.r1Orders, public_id: publicId("prf", "r1t1"), survey_id: surveyOf(orders, 1).id },
      { id: profiles.r2, public_id: publicId("prf", "r2t0"), survey_id: surveyOf(web, 3).id },
      { id: profiles.r3, public_id: publicId("prf", "r3t0"), survey_id: surveyOf(orders, 2).id },
      { id: expect.any(Number), public_id: expect.stringMatching(/^prf_/), survey_id: surveyOf(orders, 3).id },
    ]);
    expect(JSON.parse(previewDocument.document)).toMatchObject({ commit: ORDERS_PREVIEW, detector_release: RELEASE });
    expect(previewDocument.digest).toBe(sha256(previewDocument.document));
    expect(columns("repository_profiles")).toEqual(["id", "public_id", "survey_id", "schema_version", "detector_release", "document", "digest", "created_at"]);
    // The projection is recreated empty, keyed by Profile alone, for the rebuild to fill.
    expect(all("select * from evidence_index")).toEqual([]);
    expect(all("select * from dependency_facts")).toEqual([]);
    for (const table of ["evidence_index", "dependency_facts"]) expect(columns(table), table).not.toEqual(expect.arrayContaining(["assessment_id"]));
    expect(columns("dependency_facts")).toContain("kind");
  });

  it("deletes the profiling initiative with its Runs, targets, versions, maps, graph rows, and jobs", () => {
    expect(all("select public_id, name from initiatives")).toEqual([{ public_id: "ini_fleet00000000000", name: "Fleet" }]);
    expect(columns("initiatives")).not.toContain("profiling");
    expect(all("select public_id from assessments order by id")).toEqual([{ public_id: runs.r1!.publicId }, { public_id: runs.r2!.publicId }, { public_id: runs.r3!.publicId }]);
    expect(all("select distinct assessment_id from assessment_targets order by assessment_id")).toEqual([{ assessment_id: runs.r1!.id }, { assessment_id: runs.r2!.id }, { assessment_id: runs.r3!.id }]);
    expect(all("select assessment_id from relationship_maps order by assessment_id")).toEqual([{ assessment_id: runs.r1!.id }, { assessment_id: runs.r2!.id }, { assessment_id: runs.r3!.id }]);
    for (const table of ["graph_nodes", "graph_edges", "graph_edge_candidates"]) {
      expect(all(`select * from ${table} where assessment_id not in (select id from assessments)`), table).toEqual([]);
    }
    expect(all("select count(*) as n from graph_edges")).toEqual([{ n: 0 }]);
    expect(all("select kind, json_extract(payload, '$.assessment') as assessment from jobs")).toEqual([{ kind: "assessment.finalize", assessment: runs.r1!.publicId }]);
    expect(tables()).not.toEqual(expect.arrayContaining(["profile_versions"]));
    expect(tables()).not.toEqual(expect.arrayContaining(["source_snapshots"]));
  });

  it("makes each Repository's current survey its newest successful one of its configured reference, not a Run on a branch or a failed survey", () => {
    expect(all("select id, current_survey_id, configured_commit, configured_resolved_at from repository_sources order by id")).toEqual([
      // web's branch Run and its failed background survey are newer, but neither counts.
      { id: web, current_survey_id: surveyOf(web, 1).id, configured_commit: WEB_MAIN, configured_resolved_at: at(1) + 1 },
      // The Run under another configuration resolved main later; the preview's commit didn't come from main.
      { id: orders, current_survey_id: surveyOf(orders, 2).id, configured_commit: ORDERS_MAIN, configured_resolved_at: at(6) + 1 },
      { id: billing, current_survey_id: null, configured_commit: null, configured_resolved_at: null },
    ]);
  });

  it("links each Run target to its survey, a duplicate to the earliest, with how its reference resolved", () => {
    const target = (assessment: string, position: number) => runs[assessment]!.targets[position]!.id;
    expect(all("select id, state, ref_kind, resolved_ref, resolved_at, survey_id, failure_code from assessment_targets order by id")).toEqual([
      { id: target("r1", 0), state: "complete", ref_kind: "default_branch", resolved_ref: "refs/heads/main", resolved_at: at(2) + 1, survey_id: surveyOf(web, 1).id, failure_code: null },
      { id: target("r1", 1), state: "complete", ref_kind: "branch", resolved_ref: "refs/heads/main", resolved_at: at(2) + 1, survey_id: surveyOf(orders, 1).id, failure_code: null },
      { id: target("r2", 0), state: "complete", ref_kind: "branch", resolved_ref: "refs/heads/feature/x", resolved_at: at(4) + 1, survey_id: surveyOf(web, 3).id, failure_code: null },
      { id: target("r3", 0), state: "complete", ref_kind: "branch", resolved_ref: "refs/heads/main", resolved_at: at(6) + 1, survey_id: surveyOf(orders, 2).id, failure_code: null },
      // Unreachable before its commit was known: no resolution, no survey.
      { id: target("r3", 1), state: "failed", ref_kind: null, resolved_ref: null, resolved_at: null, survey_id: null, failure_code: "source_unavailable" },
    ]);
    // A Run reads its targets' Profiles through their surveys: web's is the one background profiling wrote.
    expect(all("select t.id as target, p.id as profile from assessment_targets t join repository_profiles p on p.survey_id = t.survey_id where t.assessment_id = ? order by t.position", runs.r1!.id)).toEqual([
      { target: target("r1", 0), profile: profiles.p1 },
      { target: target("r1", 1), profile: profiles.r1Orders },
    ]);
  });

  it("links each preview preparation to its commit's survey, keeping its decision and builds", () => {
    expect(all("select public_id, state, survey_id, profile_digest, packages, refusal from preview_preparations order by id")).toEqual([
      // Decided from the operator Run's duplicate Profile: linked to the survey it merged into.
      { public_id: "ppr_webmain000000000", state: "ready", survey_id: surveyOf(web, 1).id, profile_digest: expect.any(String), packages: "[]", refusal: null },
      { public_id: "ppr_orderspreview000", state: "refused", survey_id: surveyOf(orders, 3).id, profile_digest: expect.any(String), packages: "[]", refusal: '{"reason":"No package qualifies for a preview"}' },
      { public_id: "ppr_webbranch0000000", state: "profiling", survey_id: null, profile_digest: null, packages: null, refusal: null },
    ]);
    expect(columns("preview_preparations")).not.toEqual(expect.arrayContaining(["repository_profile_id"]));
    expect(columns("preview_preparations")).not.toEqual(expect.arrayContaining(["profile_document"]));
    expect(all("select * from preview_builds")).toEqual(before.previews);
  });

  it("leaves Evaluations and their Findings untouched, with every foreign key intact", () => {
    expect(all("select * from evaluations")).toEqual(before.evaluations);
    expect(all("select * from evaluation_releases")).toEqual(before.releases);
    expect(all("select * from findings")).toEqual(before.findings);
    expect(all("select * from pragma_foreign_key_check")).toEqual([]);
  });

  it("keeps the rules for the tables it rebuilt", () => {
    const [web1, web2] = [surveyOf(web, 1).id, surveyOf(web, 2).id];
    expect(() => run("delete from surveys where id = ?", web1)).toThrow(/retained/);
    expect(() => run("update surveys set state = 'queued' where id = ?", web1)).toThrow(/terminal survey cannot change/);
    expect(() => run("update surveys set configuration_digest = ? where id = ?", OTHER_CONFIG, web2)).toThrow(/keeps its Repository, number, commit, and recipe/);
    expect(() => run("delete from repository_profiles")).toThrow(/retained/);
    expect(() => run("delete from assessment_targets")).toThrow(/retained/);
    expect(() => run("delete from assessments")).toThrow(/retained/);
    expect(() => run("delete from relationship_maps")).toThrow(/retained/);
    expect(() => run("update assessment_targets set survey_id = ? where id = ?", surveyOf(web, 3).id, runs.r1!.targets[0]!.id)).toThrow(/terminal target cannot change|links its survey once/);
    // The current survey is a successful survey of the commit the Repository's configured reference names.
    expect(() => run("update repository_sources set current_survey_id = ? where id = ?", surveyOf(web, 3).id, web)).toThrow(/current survey is a successful survey of the commit the configured reference names/);
    // A failed survey takes the next attempt under its key; a new survey takes the next number.
    expect(() => run("update surveys set state = 'queued', finished_at = null where id = ?", web2)).not.toThrow();
    expect(() =>
      run(
        "insert into surveys (public_id, repository_source_id, number, commit_sha, reference, from_configured_reference, resolved_at, surveyor_release, configuration_digest, profile_schema_version, trigger, created_at) values ('srv_again00000000000', ?, 1, ?, 'refs/heads/main', 1, ?, ?, ?, 2, 'manual', ?)",
        web,
        "9".repeat(40),
        T0,
        RELEASE,
        CONFIG,
        T0,
      ),
    ).toThrow(/next number/);
  });
});
