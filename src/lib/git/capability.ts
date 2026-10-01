import { GitError } from "./errors";
import { GitRunner } from "./runner";

/**
 * Startup check that the Git executable exists and supports the controls
 * GitRunner depends on: GIT_CONFIG_GLOBAL (2.32), --end-of-options (2.24),
 * and per-protocol allow lists.
 */
export const MINIMUM_GIT_VERSION = "2.32.0";

export interface GitCapability {
  executable: string;
  version: string;
  supported: boolean;
}

export async function gitCapability(runner = new GitRunner()): Promise<GitCapability> {
  const output = await runner.version();
  const version = /^git version (\d+(?:\.\d+)+)/.exec(output)?.[1];
  if (!version) throw new GitError("git_unsupported", `Could not parse a Git version from ${JSON.stringify(output.slice(0, 80))}`);

  return { executable: runner.executable, version, supported: compareVersions(version, MINIMUM_GIT_VERSION) >= 0 };
}

export async function verifyGit(runner = new GitRunner()): Promise<GitCapability> {
  let capability: GitCapability;
  try {
    capability = await gitCapability(runner);
  } catch (error) {
    if (error instanceof GitError) throw new GitError(error.code, `Git is required but unavailable: ${error.message}`);
    throw error;
  }
  if (!capability.supported) {
    throw new GitError("git_unsupported", `Git ${capability.version} at ${capability.executable} is unsupported; DE FabLab requires ${MINIMUM_GIT_VERSION} or newer`);
  }
  return capability;
}

export function describeCapability({ executable, version, supported }: GitCapability): string {
  return `Git ${version} at ${executable} (${supported ? "supported" : `unsupported; requires ${MINIMUM_GIT_VERSION}+`})`;
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
