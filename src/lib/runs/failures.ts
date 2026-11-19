import semver from "semver";
import { PRODUCT } from "@/lib/product";
import type { TargetFailureCode } from "./transitions";

/**
 * What each failure means and what to do, in words (operator-interface/
 * page-patterns spec, content standard "Failures"). Pages lead with the
 * sentence; the code and the recorded message stay in a failure's details.
 * A survey that failed because the recipe it was requested with isn't the
 * installed one is recorded as analysis_failed; its message names the two
 * Surveyor releases, so it reads as a Surveyor release mismatch.
 */

export type FailureKind = TargetFailureCode | "surveyor_mismatch";

export const FAILURE_SENTENCES: Readonly<Record<FailureKind, string>> = {
  authentication_failed: "The Git server refused the credentials it was given. Add a Bitbucket token for its server in Admin, then try again.",
  source_unavailable: "The repository couldn't be reached. Check its clone URL in its Settings and that its server is up, then try again.",
  boundary_violation: "Its clone URL is outside the sources the Frontend Registry may read. Use a clone URL inside an allowed source root.",
  invalid_ref: "Its reference doesn't name a branch, tag, or commit. Correct the reference in its Settings.",
  ambiguous_ref: "Its reference names both a branch and a tag. Use the full name, such as refs/heads/main, in its Settings.",
  timeout: "Reading the repository took too long. Try again; a very large repository may need a longer limit.",
  canceled: "It was canceled before it finished. Start it again to finish it.",
  lock_timeout: "Another survey was still reading the repository. Try again in a few minutes.",
  git_unavailable: `Git isn't available to the ${PRODUCT.name}. Install Git where it runs, then try again.`,
  object_verification_failed: "The repository's content didn't match what was recorded for its commit. Re-profile it to read it again.",
  unsupported_repository: `The ${PRODUCT.name} can't read this repository. Check that its clone URL is a Git repository.`,
  unexpected: "The repository couldn't be read. Try again; if it keeps failing, the server log has the details.",
  acquisition_failed: "The repository couldn't be read. Try again; if it keeps failing, the server log has the details.",
  analysis_failed: "The repository was read, but surveying it failed. Re-profile it; if it keeps failing, the server log has the details.",
  surveyor_mismatch: "This version was requested with a different Surveyor release than the installed one. Re-profile the Repository to survey it with the installed release.",
};

const MISMATCH = /needs Surveyor (\S+) .*but this worker runs Surveyor (\S+)/;

/** The kind of a failure: its code, or for a survey that couldn't run on the installed recipe, a Surveyor release mismatch. */
export function failureKind(code: string | null | undefined, message?: string | null): FailureKind | null {
  if (!code) return null;
  if (code === "analysis_failed" && message && MISMATCH.test(message)) return "surveyor_mismatch";
  return code in FAILURE_SENTENCES ? (code as FailureKind) : "unexpected";
}

/** What a failure means and what to do; for a Surveyor release mismatch, which release it needs. */
export function failureSentence(code: string | null | undefined, message?: string | null): string {
  const kind = failureKind(code, message);
  if (!kind) return "It failed.";
  const mismatch = kind === "surveyor_mismatch" ? MISMATCH.exec(message!) : null;
  if (mismatch) {
    const [, needed, installed] = mismatch as unknown as [string, string, string];
    return semver.valid(needed) && semver.valid(installed) && semver.gt(needed, installed)
      ? `This version needs Surveyor ${needed}, a newer release than the installed ${installed}. Upgrade the ${PRODUCT.name}, or re-profile the Repository to survey it with ${installed}.`
      : `This version was requested with Surveyor ${needed}, not the installed ${installed}. Re-profile the Repository to survey it with ${installed}.`;
  }
  return FAILURE_SENTENCES[kind];
}
