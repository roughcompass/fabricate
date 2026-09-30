import fs from "node:fs";
import type { FabricateConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { DETECTOR_RELEASE, DETECTORS } from "@/lib/detectors/bundle";
import type { Detector } from "@/lib/detectors/contract";
import { runDetectors } from "@/lib/detectors/run";
import type { ProfileSource } from "@/lib/profiles/reconcile";
import type { ProfileDocument } from "@/lib/profiles/schema";
import { openSnapshot } from "@/lib/snapshot/open";
import type { Budgets, SnapshotReader } from "@/lib/snapshot/reader";
import { acquire, acquisitionConfig, registerLocalSource } from "./acquisition";
import { createTestDb } from "./db";
import { GitFixture, type Repo } from "./git-fixture";

export type FileTree = Record<string, string | Buffer | { content: string; executable: true } | { symlink: string }>;

/**
 * Commits a file tree to a temporary repository, acquires it like a real
 * Assessment would, and opens a SnapshotReader on the pinned commit.
 */
export class SnapshotFixture {
  readonly fixture: GitFixture;
  readonly config: FabricateConfig;
  readonly db: Db;
  readonly work: Repo;
  private source: ReturnType<typeof registerLocalSource> | undefined;

  private constructor(prefix: string) {
    this.fixture = GitFixture.create(prefix);
    this.config = acquisitionConfig(this.fixture);
    this.db = createTestDb();
    this.work = this.fixture.repo("fleet/app");
  }

  static create(prefix = "snapshot"): SnapshotFixture {
    return new SnapshotFixture(prefix);
  }

  async open(files: FileTree, budgets?: Budgets): Promise<SnapshotReader> {
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === "string" || Buffer.isBuffer(content)) this.work.write(path, content);
      else if ("symlink" in content) this.work.symlink(path, content.symlink);
      else this.work.write(path, content.content, { executable: true });
    }
    this.work.commit();
    return this.openCommitted(budgets);
  }

  /** Opens a reader on whatever the work repository last committed, such as a hand-staged gitlink. */
  async openCommitted(budgets?: Budgets): Promise<SnapshotReader> {
    this.source ??= registerLocalSource(this.db, this.config, "app", this.work.path);
    const { target, snapshot } = await acquire(this.db, this.config, this.source);
    return openSnapshot(target, snapshot, { config: this.config, ...(budgets && { budgets }) });
  }

  /** Commits +files+ and runs the detector bundle (or +detectors+) over the snapshot. */
  async profile(files: FileTree, options: { detectors?: readonly Detector[]; budgets?: Budgets } = {}): Promise<{ document: ProfileDocument; reader: SnapshotReader }> {
    const reader = await this.open(files, options.budgets);
    const document = await runDetectors({ reader, source: this.profileSource, detectorRelease: DETECTOR_RELEASE, detectors: options.detectors ?? DETECTORS });
    return { document, reader };
  }

  get profileSource(): ProfileSource {
    return { public_id: this.source!.publicId, name: this.source!.name, clone_url: this.source!.cloneUrl, git_ref: this.source!.gitRef };
  }

  cleanup(): void {
    this.fixture.cleanup();
    fs.rmSync(this.config.repositoryStorage, { recursive: true, force: true });
  }
}
