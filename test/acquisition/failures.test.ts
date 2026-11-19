import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireTarget } from "@/lib/acquisition/acquire";
import { type AssessmentTarget, getTarget, snapshotOf } from "@/lib/assessments/assessment-records";
import { transitionTarget } from "@/lib/assessments/transitions";
import { type RepositorySource, insertSource } from "@/lib/catalog/source-records";
import { GitRunner } from "@/lib/git/runner";
import { registerLocalSource, useAcquisitionWorld } from "../support/acquisition";
import { buildAssessment } from "../support/builders";
import { fakeExecutable } from "../support/fake-git";

const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

describe("acquisition failures", () => {
  const world = useAcquisitionWorld("failures");
  let healthy: RepositorySource;
  const cleanups: (() => void)[] = [];

  beforeEach(() => {
    const work = world.fixture.repo("fleet/healthy");
    work.write("README.md", "healthy\n").commit();
    healthy = registerLocalSource(world.db, world.config, "healthy", work.path);
  });

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  /** An assessment over [failing, healthy] with both targets acquiring. */
  const pair = (failing: RepositorySource): [AssessmentTarget, AssessmentTarget] => {
    const { targets } = buildAssessment(world.db, { sources: [failing, healthy] });
    const byName = new Map(targets.map((target) => [target.sourceName, transitionTarget(world.db, target, "acquiring")]));
    return [byName.get(failing.name)!, byName.get("healthy")!];
  };

  /** Real Git, except that ls-remote runs +body+ first. */
  const wrappedRunner = (body: string, timeoutMs?: number) => {
    const fake = fakeExecutable(`case "$*" in *ls-remote*) ${body} ;; esac\nexec '${realGit}' "$@"`);
    cleanups.push(fake.cleanup);
    return new GitRunner({ config: world.config, executable: fake.executable, timeoutMs });
  };

  it("records an unreachable remote on its own target while a sibling source succeeds", async () => {
    const unreachable = insertSource(world.db, { name: "unreachable", cloneUrl: "https://127.0.0.1:1/acme/orders.git", canonicalUrl: "https://127.0.0.1:1/acme/orders" });
    const [failing, sibling] = pair(unreachable);

    const failed = await acquireTarget(world.db, failing, { config: world.config });
    const succeeded = await acquireTarget(world.db, sibling, { config: world.config });

    expect(failed).toMatchObject({ ok: false, error: { code: "source_unavailable" } });
    expect(getTarget(world.db, failing.publicId)).toMatchObject({ state: "failed", failureCode: "source_unavailable" });
    expect(snapshotOf(world.db, failing.id)).toBeUndefined();
    expect(succeeded.ok).toBe(true);
    expect(getTarget(world.db, sibling.publicId)).toMatchObject({ state: "acquiring", failureCode: null });
    expect(snapshotOf(world.db, sibling.id)?.commitSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("treats a local source removed after registration as unavailable", async () => {
    const work = world.fixture.repo("fleet/removed");
    work.commit();
    const removed = registerLocalSource(world.db, world.config, "removed", work.path);
    fs.rmSync(work.path, { recursive: true, force: true });
    const [failing] = pair(removed);

    expect(await acquireTarget(world.db, failing, { config: world.config })).toMatchObject({ ok: false, error: { code: "source_unavailable" } });
  });

  it("records an invalid reference", async () => {
    const work = world.fixture.repo("fleet/orders");
    work.commit();
    const [failing] = pair(registerLocalSource(world.db, world.config, "orders", work.path, "no-such-branch"));

    await acquireTarget(world.db, failing, { config: world.config });
    expect(getTarget(world.db, failing.publicId)).toMatchObject({ state: "failed", failureCode: "invalid_ref", failureMessage: expect.stringContaining("no-such-branch") });
  });

  it("records a Git command that exceeds the timeout", async () => {
    const work = world.fixture.repo("fleet/slow");
    work.commit();
    const [failing, sibling] = pair(registerLocalSource(world.db, world.config, "slow", work.path));

    const outcome = await acquireTarget(world.db, failing, { config: world.config, runner: wrappedRunner("sleep 5", 300) });
    expect(outcome).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(getTarget(world.db, failing.publicId).failureCode).toBe("timeout");
    expect((await acquireTarget(world.db, sibling, { config: world.config })).ok).toBe(true);
  });

  it("marks a canceled acquisition canceled rather than failed", async () => {
    const work = world.fixture.repo("fleet/canceled");
    work.commit();
    const [failing] = pair(registerLocalSource(world.db, world.config, "canceled", work.path));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);

    const outcome = await acquireTarget(world.db, failing, { config: world.config, runner: wrappedRunner("sleep 5"), signal: controller.signal });
    expect(outcome).toMatchObject({ ok: false, error: { code: "canceled" } });
    expect(getTarget(world.db, failing.publicId)).toMatchObject({ state: "canceled", failureCode: null });
    expect(snapshotOf(world.db, failing.id)).toBeUndefined();
  });

  it("never persists credentials that appear in Git's diagnostics", async () => {
    const work = world.fixture.repo("fleet/private");
    work.commit();
    const [failing] = pair(registerLocalSource(world.db, world.config, "private", work.path));
    const runner = wrappedRunner(
      `echo "fatal: unable to access 'https://deploy:s3cr3t-token@git.example.com/acme/private.git/': The requested URL returned error: 403" >&2; echo "Authorization: Bearer tok_abcdef123456" >&2; exit 128`,
    );

    const outcome = await acquireTarget(world.db, failing, { config: world.config, runner });
    const stored = getTarget(world.db, failing.publicId);

    expect(outcome).toMatchObject({ ok: false, error: { code: "authentication_failed" } });
    expect(stored.failureCode).toBe("authentication_failed");
    for (const text of [stored.failureMessage ?? "", outcome.ok ? "" : outcome.error.message]) {
      expect(text).not.toContain("s3cr3t-token");
      expect(text).not.toContain("tok_abcdef123456");
    }
  });
});
