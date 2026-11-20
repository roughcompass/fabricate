import { describe, expect, it, vi } from "vitest";
import { checkApplications } from "@/lib/applications/check";
import { buildApplication, buildSavedPreview } from "@/lib/applications/pipeline";
import { getConfig, withOverrides } from "@/lib/config";
import { JOB_PRIORITIES } from "@/lib/db/schema";
import type { GitRunner } from "@/lib/git/runner";
import { createTestDb } from "../support/db";

vi.mock("@/lib/applications/pipeline", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/applications/pipeline")>()), buildApplication: vi.fn(async () => undefined), buildSavedPreview: vi.fn(async () => undefined) }));

/*
 * The automatic check at fleet scale (restore-toolbar-tools-and-branch-
 * previews, design decision 3; task 2.4): 500 applications, one per remote,
 * each with 20 saved branches, make 10,000 targets. The check reads each
 * remote once, with the Git runner stubbed, and starts attempts only for the
 * targets that moved; starting them is stubbed too, since pinning a commit is
 * each moved target's own cost, not the check's.
 */

const APPLICATIONS = 500;
const SAVED = 20;
const T0 = 1_795_000_000_000;
const sha = (seed: number) => seed.toString(16).padStart(40, "0");

describe("applications check at fleet scale", () => {
  it(`reads ${APPLICATIONS} remotes once each for ${APPLICATIONS * (SAVED + 1)} branches, and starts only those that moved`, { timeout: 30_000 }, async () => {
    const db = createTestDb();
    const urls: string[] = [];
    const insert = db.$client.transaction(() => {
      const repository = db.$client.prepare("insert into repository_sources (public_id, name, clone_url, canonical_url, created_at, updated_at) values (?, ?, ?, ?, ?, ?)");
      const application = db.$client.prepare(
        "insert into applications (public_id, slug, name, name_key, repository_source_id, package_dir, tracked_ref, latest_commit_sha, latest_outcome, latest_reasons, latest_requested_at, created_at, updated_at) values (?, ?, ?, ?, ?, '.', 'refs/heads/main', ?, 'failed', '[{\"text\":\"no\"}]', ?, ?, ?)",
      );
      const saved = db.$client.prepare(
        "insert into application_previews (public_id, application_id, key, ref, latest_commit_sha, latest_outcome, latest_reasons, latest_requested_at, created_at, updated_at) values (?, ?, ?, ?, ?, 'failed', '[{\"text\":\"no\"}]', ?, ?, ?)",
      );
      for (let index = 0; index < APPLICATIONS; index++) {
        const url = `https://git.example.com/fleet/app-${index}`;
        urls.push(url);
        const repositoryId = repository.run(`src_${String(index).padStart(16, "0")}`, `app-${index}`, `${url}.git`, url, T0, T0).lastInsertRowid;
        const applicationId = application.run(`app_${String(index).padStart(16, "0")}`, `app-${index}`, `App ${index}`, `app ${index}`, repositoryId, sha(index * 100), T0, T0, T0).lastInsertRowid;
        for (let branch = 0; branch < SAVED; branch++) saved.run(`apv_${String(index * 100 + branch).padStart(16, "0")}`, applicationId, `feature-${branch}`, `refs/heads/feature/${branch}`, sha(index * 100 + branch + 1), T0, T0, T0);
      }
    });
    insert();
    const config = withOverrides(getConfig(), { previews: { enabled: true, trustedSources: urls } });

    // Every 50th remote's tracked branch moved, and every 10th remote's first saved branch.
    const reads: string[] = [];
    const runner = {
      async lsRemote(url: string) {
        reads.push(url);
        const index = Number(/app-(\d+)/.exec(url)![1]);
        const lines = [`${index % 50 === 0 ? sha(9_000_000 + index) : sha(index * 100)}\trefs/heads/main`];
        for (let branch = 0; branch < SAVED; branch++) lines.push(`${index % 10 === 0 && branch === 0 ? sha(8_000_000 + index) : sha(index * 100 + branch + 1)}\trefs/heads/feature/${branch}`);
        return `${lines.join("\n")}\n`;
      },
    } as unknown as GitRunner;

    const started = Date.now();
    const result = await checkApplications(db, config, { runner });
    const elapsed = Date.now() - started;

    expect(reads).toHaveLength(APPLICATIONS);
    expect(new Set(reads).size).toBe(APPLICATIONS);
    expect(result).toEqual({ checked: APPLICATIONS * (SAVED + 1), started: APPLICATIONS / 50 + APPLICATIONS / 10, unreadable: 0 });
    expect(vi.mocked(buildApplication)).toHaveBeenCalledTimes(APPLICATIONS / 50);
    expect(vi.mocked(buildSavedPreview)).toHaveBeenCalledTimes(APPLICATIONS / 10);
    // Saved branches' rebuilds wait behind tracked branches and operator actions.
    for (const [, , options] of vi.mocked(buildSavedPreview).mock.calls) expect(options).toMatchObject({ priority: JOB_PRIORITIES.background });
    expect(elapsed).toBeLessThan(20_000);
    db.$client.close();
  });
});
