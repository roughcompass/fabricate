import fs from "node:fs";
import path from "node:path";
import { type FrontendRegistryConfig, getConfig, isInside, namesProtectedDirectory } from "@/lib/config";

/**
 * Decides whether a local path may be used as a repository source.
 *
 * Symbolic links are resolved one path component at a time, and every
 * component is checked against the denied roots before it is touched. A path
 * that leads into fleet-kit/ (or any denied root), directly or through a link,
 * is therefore refused without reading or even inspecting anything inside it.
 *
 * A source must resolve inside an allowed root and outside every denied root.
 * Its Git directory, including gitfile targets, common directories, and object
 * alternates, must obey the same rules.
 */

export type BoundaryViolationCode =
  | "relative_path"
  | "denied_root"
  | "no_allowed_roots"
  | "outside_allowed_roots"
  | "not_found"
  | "unreadable"
  | "symlink_loop"
  | "not_a_directory"
  | "not_a_repository"
  | "git_metadata_outside_allowed_roots"
  | "alternates";

export class BoundaryViolation extends Error {
  override name = "BoundaryViolation";

  constructor(
    readonly code: BoundaryViolationCode,
    message: string,
  ) {
    super(message);
  }
}

export interface SourceLocation {
  /** The fully resolved working tree or bare repository directory. */
  path: string;
  /** The fully resolved Git directory. */
  gitDir: string;
}

const MAX_SYMLINKS = 40;

export class SourceBoundary {
  private readonly deniedRoots: readonly string[];
  private readonly allowedRoots: readonly string[];

  constructor(readonly config: FrontendRegistryConfig = getConfig()) {
    this.deniedRoots = [...new Set(config.deniedRoots.flatMap((root) => [root, realpathOrNull(root)]).filter((root): root is string => root !== null))];
    this.allowedRoots = config.allowedRoots.map(realpathOrNull).filter((root): root is string => root !== null);
  }

  /** Validates a local repository and returns its resolved location. */
  check(input: string): SourceLocation {
    const resolved = this.resolveDirectory(input, "Local sources");
    const gitDir = this.locateGitDir(resolved);
    this.checkGitMetadata(gitDir);
    return { path: resolved, gitDir };
  }

  /** Validates a directory that may contain repositories (used for imports). */
  checkDirectory(input: string): string {
    return this.resolveDirectory(input, "Import directories");
  }

  denied(candidate: string): boolean {
    return namesProtectedDirectory(candidate) || this.deniedRoots.some((root) => isInside(root, candidate));
  }

  allowed(candidate: string): boolean {
    return this.allowedRoots.some((root) => isInside(root, candidate));
  }

  private resolveDirectory(input: string, label: string): string {
    if (!path.isAbsolute(input)) throw new BoundaryViolation("relative_path", `${label} must be absolute paths`);
    const lexical = path.normalize(input).replace(/(.)\/+$/, "$1");
    if (this.denied(lexical)) throw new BoundaryViolation("denied_root", `${lexical} is inside a denied root`);
    if (this.config.allowedRoots.length === 0) throw new BoundaryViolation("no_allowed_roots", "No allowed local source roots are configured");

    const resolved = this.resolve(lexical);
    if (!this.allowed(resolved)) throw new BoundaryViolation("outside_allowed_roots", `${lexical} is outside the allowed source roots`);
    if (!statOrNull(resolved)?.isDirectory()) throw new BoundaryViolation("not_a_directory", `${lexical} is not a directory`);
    return resolved;
  }

  /** Resolves every symbolic link, refusing denied components before touching them. */
  resolve(absolutePath: string): string {
    const pending = absolutePath.split(path.sep).filter(Boolean);
    let resolved = path.parse(absolutePath).root;
    let links = 0;

    while (pending.length) {
      const segment = pending.shift()!;
      if (segment === ".") continue;
      if (segment === "..") {
        resolved = path.dirname(resolved);
        continue;
      }

      const candidate = path.join(resolved, segment);
      if (this.denied(candidate)) throw new BoundaryViolation("denied_root", `${absolutePath} resolves inside a denied root`);

      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(candidate);
      } catch (error) {
        throw fromFsError(error, absolutePath);
      }

      if (stat.isSymbolicLink()) {
        if (++links > MAX_SYMLINKS) throw new BoundaryViolation("symlink_loop", `${absolutePath} contains a symbolic link loop`);
        const target = fs.readlinkSync(candidate);
        if (path.isAbsolute(target)) resolved = path.parse(target).root;
        pending.unshift(...target.split(path.sep).filter(Boolean));
        continue;
      }
      resolved = candidate;
    }
    return resolved;
  }

  private locateGitDir(directory: string): string {
    const dotGit = path.join(directory, ".git");
    const stat = lstatOrNull(dotGit);
    let gitDir: string;

    if (stat?.isDirectory() || stat?.isSymbolicLink()) {
      gitDir = this.confine(dotGit);
    } else if (stat?.isFile()) {
      const target = /^gitdir:\s*(.+?)\s*$/m.exec(readHead(dotGit, 512))?.[1];
      if (!target) throw new BoundaryViolation("not_a_repository", `${directory}/.git is not a valid gitfile`);
      gitDir = this.confine(path.resolve(directory, target));
    } else if (isBareRepository(directory)) {
      gitDir = directory;
    } else {
      throw new BoundaryViolation("not_a_repository", `${directory} is not a Git repository`);
    }

    if (!isBareRepository(gitDir)) throw new BoundaryViolation("not_a_repository", `${directory} is not a Git repository`);
    return gitDir;
  }

  /** Resolves a Git metadata path and requires it to obey the boundary. */
  private confine(candidate: string): string {
    if (this.denied(path.normalize(candidate))) throw new BoundaryViolation("denied_root", "Git metadata for this source is inside a denied root");
    const resolved = this.resolve(path.normalize(candidate));
    if (!this.allowed(resolved)) throw new BoundaryViolation("git_metadata_outside_allowed_roots", "Git metadata for this source is outside the allowed roots");
    return resolved;
  }

  private checkGitMetadata(gitDir: string): void {
    const commonDir = path.join(gitDir, "commondir");
    if (lstatOrNull(commonDir)?.isFile()) this.confine(path.resolve(gitDir, readHead(commonDir, 4096).trim()));

    const info = path.join(gitDir, "objects", "info");
    if (lstatOrNull(path.join(info, "http-alternates"))) {
      throw new BoundaryViolation("alternates", "Repositories with HTTP object alternates are not supported");
    }

    const alternates = path.join(info, "alternates");
    if (!lstatOrNull(alternates)?.isFile()) return;
    for (const line of readHead(alternates, 64 * 1024).split("\n")) {
      const entry = line.trim();
      if (entry && !entry.startsWith("#")) this.confine(path.resolve(gitDir, "objects", entry));
    }
  }
}

function isBareRepository(directory: string): boolean {
  return Boolean(lstatOrNull(path.join(directory, "HEAD"))?.isFile() && statOrNull(path.join(directory, "objects"))?.isDirectory() && statOrNull(path.join(directory, "refs"))?.isDirectory());
}

function readHead(file: string, bytes: number): string {
  const handle = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(handle, buffer, 0, bytes, 0);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    fs.closeSync(handle);
  }
}

function fromFsError(error: unknown, subject: string): BoundaryViolation {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") return new BoundaryViolation("not_found", `${subject} does not exist`);
  if (code === "EACCES" || code === "EPERM") return new BoundaryViolation("unreadable", `${subject} cannot be read`);
  if (code === "ELOOP") return new BoundaryViolation("symlink_loop", `${subject} contains a symbolic link loop`);
  return new BoundaryViolation("unreadable", `${subject} cannot be inspected (${code ?? "unknown error"})`);
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function statOrNull(target: string): fs.Stats | null {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function realpathOrNull(target: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}
