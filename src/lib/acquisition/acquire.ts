import { type AssessmentTarget, getTarget } from "@/lib/assessments/assessment-records";
import { transitionTarget } from "@/lib/assessments/transitions";
import { CloneUrl, InvalidCloneUrl } from "@/lib/catalog/clone-url";
import { BoundaryViolation, SourceBoundary } from "@/lib/catalog/source-boundary";
import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { GitError } from "@/lib/git/errors";
import { failureText } from "@/lib/git/redact";
import { GitRunner, type Protocol } from "@/lib/git/runner";
import { AcquisitionError } from "./errors";
import { Mirror, type Resolution } from "./mirror";

/**
 * Resolves a reference to the commit its remote advertises, before anything
 * is fetched, so a Run or background request can find its survey first
 * (unify-surveys, design decision 2). The survey job fetches and pins the
 * commit when the mirror lacks it.
 *
 * Local sources are re-checked against the source boundary each time,
 * because a path or symbolic link can change after registration. Every
 * failure is normalized to a stable code with a redacted message.
 */

export interface ResolveOptions {
  config?: FrontendRegistryConfig;
  runner?: GitRunner;
  boundary?: SourceBoundary;
  signal?: AbortSignal;
}

/** What +gitRef+ names on +source+'s remote: the default branch when null. */
export async function resolveReference(source: { sourcePublicId: string; cloneUrl: string; gitRef: string | null }, options: ResolveOptions = {}): Promise<Resolution> {
  const config = options.config ?? getConfig();
  const runner = options.runner ?? new GitRunner({ config });
  try {
    const { url, protocol } = gitSource(source, options.boundary ?? new SourceBoundary(config));
    return await new Mirror(runner, source.sourcePublicId).resolve(url, protocol, source.gitRef, options.signal);
  } catch (error) {
    throw normalizeAcquisitionError(error);
  }
}

export type ResolutionOutcome = { ok: true; resolution: Resolution } | { ok: false; error: AcquisitionError; target: AssessmentTarget };

/**
 * Resolves a Run target's reference. A failure is the target's own (design
 * decision 2): it moves only this target to failed, or canceled, with a stable
 * code and a redacted message, and creates no survey.
 */
export async function resolveTarget(db: Executor, target: AssessmentTarget, options: ResolveOptions = {}): Promise<ResolutionOutcome> {
  try {
    return { ok: true, resolution: await resolveReference(target, options) };
  } catch (caught) {
    const error = normalizeAcquisitionError(caught);
    const current = getTarget(db, target.publicId);
    const recorded =
      error.code === "canceled"
        ? transitionTarget(db, current, "canceled")
        : transitionTarget(db, current, "failed", { failureCode: error.code, failureMessage: error.message });
    return { ok: false, error, target: recorded };
  }
}

/** The URL and transport Git uses for a source, resolving local paths through the boundary. */
export function gitSource(target: Pick<AssessmentTarget, "cloneUrl">, boundary: SourceBoundary): { url: string; protocol: Protocol } {
  const url = CloneUrl.parse(target.cloneUrl);
  if (!url.isFile) return { url: url.toString(), protocol: url.protocol };
  const location = boundary.check(url.localPath!);
  return { url: CloneUrl.forLocalPath(location.path).toString(), protocol: "file" };
}

const AUTHENTICATION = /authentication failed|permission denied \(publickey|could not read username|terminal prompts disabled|http\/\d(?:\.\d)? 40[13]|returned error: 40[13]|access denied|invalid credentials/i;
const UNAVAILABLE = /could not resolve host|connection (?:refused|timed out|reset)|network is unreachable|no route to host|does not appear to be a git repository|repository not found|not found|unable to access|no such file or directory|could not read from remote repository|host key verification failed/i;
const MISSING_REF = /not our ref|couldn't find remote ref|no such ref|unknown revision/i;
const UNSUPPORTED = /object format|unsupported repository format|repository format version|unknown repository extension/i;

export function normalizeAcquisitionError(error: unknown): AcquisitionError {
  if (error instanceof AcquisitionError) return error;
  if (error instanceof BoundaryViolation) {
    // A local source that disappeared after registration is unavailable, not a boundary breach.
    const unavailable = error.code === "not_found" || error.code === "unreadable";
    return new AcquisitionError(unavailable ? "source_unavailable" : "boundary_violation", error.message);
  }
  if (error instanceof InvalidCloneUrl) return new AcquisitionError("unsupported_repository", error.message);
  if (error instanceof GitError) {
    switch (error.code) {
      case "timeout":
        return new AcquisitionError("timeout", error.message);
      case "canceled":
        return new AcquisitionError("canceled", "Acquisition was canceled");
      case "git_unavailable":
      case "git_unsupported":
        return new AcquisitionError("git_unavailable", error.message);
      case "command_failed": {
        const detail = error.stderr || error.message;
        if (AUTHENTICATION.test(detail)) return new AcquisitionError("authentication_failed", `The source refused access: ${firstLine(detail)}`);
        if (MISSING_REF.test(detail)) return new AcquisitionError("invalid_ref", `The configured reference could not be fetched: ${firstLine(detail)}`);
        if (UNSUPPORTED.test(detail)) return new AcquisitionError("unsupported_repository", `The source repository format is not supported: ${firstLine(detail)}`);
        if (UNAVAILABLE.test(detail)) return new AcquisitionError("source_unavailable", `The source could not be reached: ${firstLine(detail)}`);
        return new AcquisitionError("source_unavailable", `Git could not acquire the source: ${firstLine(detail)}`);
      }
      default:
        return new AcquisitionError("unexpected", error.message);
    }
  }
  return new AcquisitionError("unexpected", failureText(error));
}

function firstLine(text: string): string {
  const line = text.split("\n").map((part) => part.replace(/^(fatal|error): /, "").trim()).find(Boolean) ?? "no details";
  return failureText(line, 300);
}
