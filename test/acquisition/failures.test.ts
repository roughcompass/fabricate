import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveTarget } from "@/lib/acquisition/acquire";
import { type RunTarget, getTarget } from "@/lib/runs/run-records";
import { processTarget } from "@/lib/runs/orchestration";
import { transitionTarget } from "@/lib/runs/transitions";
import { type Repository, insertRepository } from "@/lib/repositories/repository-records";
import { surveys } from "@/lib/db/schema";
import { GitRunner } from "@/lib/git/runner";
import { surveyById } from "@/lib/surveys/records";
import { runSurvey } from "@/lib/surveys/run";
import { registerLocalRepository, useAcquisitionWorld } from "../support/acquisition";
import { buildRun } from "../support/builders";
import { fakeExecutable } from "../support/fake-git";

const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

describe("acquisition failures", () => {
  const world = useAcquisitionWorld("failures");
  let healthy: Repository;
  const cleanups: (() => void)[] = [];

  beforeEach(() => {
    const work = world.fixture.repo("fleet/healthy");
    work.write("README.md", "healthy\n").commit();
    healthy = registerLocalRepository(world.db, world.config, "healthy", work.path);
  });

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  /** An assessment over [failing, healthy] with both targets acquiring. */
  const pair = (failing: Repository): [RunTarget, RunTarget] => {
    const { targets } = buildRun(world.db, { repositories: [failing, healthy] });
    const byName = new Map(targets.map((target) => [target.repositoryName, transitionTarget(world.db, target, "acquiring")]));
    return [byName.get(failing.name)!, byName.get("healthy")!];
  };

  /** Real Git, except that the +command+ subcommand runs +body+ first. */
  const wrappedRunner = (body: string, options: { timeoutMs?: number; command?: "ls-remote" | "fetch" } = {}) => {
    const fake = fakeExecutable(`case "$*" in *" ${options.command ?? "ls-remote"} "*) ${body} ;; esac\nexec '${realGit}' "$@"`);
    cleanups.push(fake.cleanup);
    return new GitRunner({ config: world.config, executable: fake.executable, timeoutMs: options.timeoutMs });
  };

  const surveysOf = (repository: Repository) => world.db.select().from(surveys).all().filter((survey) => survey.repositoryId === repository.id);

  it("records an unreachable remote on its own target, with no survey, while a sibling source resolves", async () => {
    const unreachable = insertRepository(world.db, { name: "unreachable", cloneUrl: "https://127.0.0.1:1/acme/orders.git", canonicalUrl: "https://127.0.0.1:1/acme/orders" });
    const [failing, sibling] = pair(unreachable);

    const failed = await resolveTarget(world.db, failing, { config: world.config });
    const succeeded = await resolveTarget(world.db, sibling, { config: world.config });

    expect(failed).toMatchObject({ ok: false, error: { code: "source_unavailable" }, target: { state: "failed", failureCode: "source_unavailable" } });
    expect(getTarget(world.db, failing.publicId)).toMatchObject({ state: "failed", failureCode: "source_unavailable", refKind: null, surveyId: null });
    expect(surveysOf(unreachable)).toEqual([]);
    expect(succeeded).toMatchObject({ ok: true, resolution: { kind: "default_branch", name: "refs/heads/main", commitSha: expect.stringMatching(/^[0-9a-f]{40}$/) } });
    expect(getTarget(world.db, sibling.publicId)).toMatchObject({ state: "acquiring", failureCode: null });
  });

  it("treats a local source removed after registration as unavailable", async () => {
    const work = world.fixture.repo("fleet/removed");
    work.commit();
    const removed = registerLocalRepository(world.db, world.config, "removed", work.path);
    fs.rmSync(work.path, { recursive: true, force: true });
    const [failing] = pair(removed);

    expect(await resolveTarget(world.db, failing, { config: world.config })).toMatchObject({ ok: false, error: { code: "source_unavailable" } });
    expect(getTarget(world.db, failing.publicId)).toMatchObject({ state: "failed", failureCode: "source_unavailable" });
  });

  it("records an invalid reference", async () => {
    const work = world.fixture.repo("fleet/orders");
    work.commit();
    const [failing] = pair(registerLocalRepository(world.db, world.config, "orders", work.path, "no-such-branch"));

    await resolveTarget(world.db, failing, { config: world.config });
    expect(getTarget(world.db, failing.publicId)).toMatchObject({ state: "failed", failureCode: "invalid_ref", failureMessage: expect.stringContaining("no-such-branch") });
  });

  it("records a Git command that exceeds the timeout", async () => {
    const work = world.fixture.repo("fleet/slow");
    work.commit();
    const [failing, sibling] = pair(registerLocalRepository(world.db, world.config, "slow", work.path));

    const outcome = await resolveTarget(world.db, failing, { config: world.config, runner: wrappedRunner("sleep 5", { timeoutMs: 300 }) });
    expect(outcome).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(getTarget(world.db, failing.publicId).failureCode).toBe("timeout");
    expect((await resolveTarget(world.db, sibling, { config: world.config })).ok).toBe(true);
  });

  it("marks a canceled resolution canceled rather than failed", async () => {
    const work = world.fixture.repo("fleet/canceled");
    work.commit();
    const [failing] = pair(registerLocalRepository(world.db, world.config, "canceled", work.path));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);

    const outcome = await resolveTarget(world.db, failing, { config: world.config, runner: wrappedRunner("sleep 5"), signal: controller.signal });
    expect(outcome).toMatchObject({ ok: false, error: { code: "canceled" } });
    expect(getTarget(world.db, failing.publicId)).toMatchObject({ state: "canceled", failureCode: null, surveyId: null });
  });

  it("never persists credentials that appear in Git's diagnostics", async () => {
    const work = world.fixture.repo("fleet/private");
    work.commit();
    const [failing] = pair(registerLocalRepository(world.db, world.config, "private", work.path));
    const runner = wrappedRunner(
      `echo "fatal: unable to access 'https://deploy:s3cr3t-token@git.example.com/acme/private.git/': The requested URL returned error: 403" >&2; echo "Authorization: Bearer tok_abcdef123456" >&2; exit 128`,
    );

    const outcome = await resolveTarget(world.db, failing, { config: world.config, runner });
    const stored = getTarget(world.db, failing.publicId);

    expect(outcome).toMatchObject({ ok: false, error: { code: "authentication_failed" } });
    expect(stored.failureCode).toBe("authentication_failed");
    for (const text of [stored.failureMessage ?? "", outcome.ok ? "" : outcome.error.message]) {
      expect(text).not.toContain("s3cr3t-token");
      expect(text).not.toContain("tok_abcdef123456");
    }
  });

  it("normalizes a failure while a survey fetches its commit, redacts it, and fails the target waiting on it with the same code", async () => {
    const work = world.fixture.repo("fleet/private");
    work.commit();
    const repository = registerLocalRepository(world.db, world.config, "private", work.path);
    const { targets } = buildRun(world.db, { repositories: [repository] });
    const waiting = await processTarget(world.db, targets[0]!.publicId, { config: world.config });
    expect(waiting).toMatchObject({ state: "analyzing", surveyId: expect.any(Number) });
    const runner = wrappedRunner(`echo "fatal: unable to access 'https://deploy:s3cr3t-token@git.example.com/acme/private.git/': The requested URL returned error: 403" >&2; exit 128`, { command: "fetch" });

    const survey = await runSurvey(world.db, surveyById(world.db, waiting.surveyId!).publicId, { config: world.config, runner });
    const target = getTarget(world.db, waiting.publicId);

    expect(survey).toMatchObject({ state: "failed", failureCode: "authentication_failed", internalRef: null });
    expect(target).toMatchObject({ state: "failed", failureCode: "authentication_failed" });
    for (const text of [survey.failureMessage ?? "", target.failureMessage ?? ""]) expect(text).not.toContain("s3cr3t-token");
  });
});
