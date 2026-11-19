import fs from "node:fs";
import type { MemoryFile } from "@repo-facts/contract";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { openSnapshot } from "@/lib/snapshot/open";
import type { Budgets, SnapshotReader, SnapshotReaderOptions } from "@/lib/snapshot/reader";
import { acquire, acquisitionConfig, registerLocalSource } from "./acquisition";
import { createTestDb } from "./db";
import { GitFixture, type Repo } from "./git-fixture";

/** Files to commit, in the repo-facts `MemoryFile` shapes: text, bytes, executables, symbolic links, and submodules. */
export type FileTree = Readonly<Record<string, MemoryFile>>;

/**
 * Commits a file tree to a temporary repository, acquires it like a real
 * Assessment would, and opens a SnapshotReader on the pinned commit.
 */
export class SnapshotFixture {
  readonly fixture: GitFixture;
  readonly config: FrontendRegistryConfig;
  readonly db: Db;
  readonly work: Repo;
  private source: ReturnType<typeof registerLocalSource> | undefined;

  private constructor(prefix: string, overrides: Parameters<typeof acquisitionConfig>[1]) {
    this.fixture = GitFixture.create(prefix);
    this.config = acquisitionConfig(this.fixture, overrides);
    this.db = createTestDb();
    this.work = this.fixture.repo("fleet/app");
  }

  static create(prefix = "snapshot", overrides: Parameters<typeof acquisitionConfig>[1] = {}): SnapshotFixture {
    return new SnapshotFixture(prefix, overrides);
  }

  async open(files: FileTree, budgets?: Budgets, options: SnapshotReaderOptions = {}): Promise<SnapshotReader> {
    this.commitFiles(files);
    return this.openCommitted(budgets, options);
  }

  /** Opens a reader on whatever the work repository last committed, such as a hand-staged gitlink. */
  async openCommitted(budgets?: Budgets, options: SnapshotReaderOptions = {}): Promise<SnapshotReader> {
    return (await this.acquireCommitted(budgets, options)).reader;
  }

  /** Commits +files+ and acquires them, returning the Assessment records along with a reader. */
  async acquireFiles(files: FileTree) {
    this.commitFiles(files);
    return this.acquireCommitted();
  }

  private commitFiles(files: FileTree): void {
    const gitlinks: [string, string][] = [];
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === "string") this.work.write(path, content);
      else if (content instanceof Uint8Array) this.work.write(path, Buffer.from(content));
      else if ("symlink" in content) this.work.symlink(path, content.symlink);
      else if ("gitlink" in content) gitlinks.push([path, content.gitlink]);
      else this.work.write(path, typeof content.content === "string" ? content.content : Buffer.from(content.content), { executable: true });
    }
    // Submodules are staged after `add --all`, which would otherwise drop them for lacking a directory. No .gitmodules is written.
    this.work.git("add", "--all");
    for (const [path, commit] of gitlinks) this.work.git("update-index", "--add", "--cacheinfo", `160000,${commit},${path}`);
    this.work.git("commit", "--quiet", "--allow-empty", "-m", "Snapshot fixture");
  }

  /** Pins whatever the work repository last committed for a survey, and opens a reader on it. */
  async acquireCommitted(budgets?: Budgets, options: SnapshotReaderOptions = {}) {
    this.source ??= registerLocalSource(this.db, this.config, "app", this.work.path);
    const { survey, target, snapshot } = await acquire(this.db, this.config, this.source);
    const reader = await openSnapshot(target, snapshot, { config: this.config, ...(budgets && { budgets }), ...options });
    return { survey, target, snapshot, reader };
  }

  cleanup(): void {
    this.fixture.cleanup();
    fs.rmSync(this.config.repositoryStorage, { recursive: true, force: true });
  }
}
