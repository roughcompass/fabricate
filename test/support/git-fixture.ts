import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Throwaway Git repositories for tests. Commands run with global and system
 * configuration disabled and fixed identities and timestamps, so object ids
 * are stable.
 */
const BASE_ENV: Record<string, string> = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: os.tmpdir(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.com",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.com",
  GIT_TERMINAL_PROMPT: "0",
};

let clock = 0;

export function git(directory: string, args: string[], options: { input?: string; env?: Record<string, string> } = {}): string {
  clock++;
  const timestamp = new Date(Date.UTC(2026, 0, 1) + clock * 1_000).toISOString();
  const env: Record<string, string> = { ...BASE_ENV, GIT_AUTHOR_DATE: timestamp, GIT_COMMITTER_DATE: timestamp, ...options.env };
  return execFileSync("git", ["-C", directory, ...args], {
    // A constructed environment; Next.js types require NODE_ENV, which Git does not need.
    env: env as NodeJS.ProcessEnv,
    input: options.input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export class GitFixture {
  private constructor(readonly root: string) {}

  static create(prefix = "git-fixture"): GitFixture {
    return new GitFixture(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))));
  }

  dir(relative: string): string {
    const directory = path.join(this.root, relative);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  repo(relative: string, options: { branch?: string } = {}): Repo {
    return new Repo(this.dir(relative), options.branch ?? "main");
  }

  bare(relative: string, options: { from?: Repo; branch?: string } = {}): BareRepo {
    const target = path.join(this.root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (options.from) git(this.root, ["clone", "--bare", "--quiet", options.from.path, target]);
    else git(this.root, ["init", "--bare", "--quiet", "-b", options.branch ?? "main", target]);
    return new BareRepo(target);
  }

  cleanup(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

export class Repo {
  constructor(
    readonly path: string,
    branch: string,
  ) {
    git(path, ["init", "--quiet", "-b", branch]);
  }

  git(...args: string[]): string {
    return git(this.path, args);
  }

  write(relative: string, content: string | Buffer, options: { executable?: boolean } = {}): this {
    const file = path.join(this.path, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    if (options.executable) fs.chmodSync(file, 0o755);
    return this;
  }

  symlink(relative: string, target: string): this {
    const link = path.join(this.path, relative);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link);
    return this;
  }

  remove(relative: string): this {
    fs.rmSync(path.join(this.path, relative), { recursive: true, force: true });
    return this;
  }

  commit(message = "Update fixture"): string {
    this.git("add", "--all");
    this.git("commit", "--quiet", "--allow-empty", "-m", message);
    return this.head();
  }

  tag(name: string, options: { message?: string } = {}): this {
    if (options.message) this.git("tag", "-a", name, "-m", options.message);
    else this.git("tag", name);
    return this;
  }

  branch(name: string): this {
    this.git("branch", name);
    return this;
  }

  checkout(name: string): this {
    this.git("checkout", "--quiet", name);
    return this;
  }

  head(): string {
    return this.rev("HEAD");
  }

  rev(revision: string): string {
    return this.git("rev-parse", revision).trim();
  }

  get url(): string {
    return `file://${this.path}`;
  }

  /** Records a submodule (gitlink) entry without cloning anything. */
  addGitlink(relative: string, commitSha: string, url = "https://git.example.com/acme/sub.git"): this {
    this.write(".gitmodules", `[submodule "${relative}"]\n\tpath = ${relative}\n\turl = ${url}\n`);
    this.git("add", ".gitmodules");
    this.git("update-index", "--add", "--cacheinfo", `160000,${commitSha},${relative}`);
    return this;
  }
}

export class BareRepo {
  constructor(readonly path: string) {}

  git(...args: string[]): string {
    return git(this.path, args);
  }

  rev(revision: string): string {
    return this.git("rev-parse", revision).trim();
  }

  get url(): string {
    return `file://${this.path}`;
  }
}
