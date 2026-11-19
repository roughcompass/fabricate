import { type AssessmentTarget, type SourceSnapshot, getTarget, internalRefFor, recordSnapshot } from "@/lib/assessments/assessment-records";
import { transitionTarget } from "@/lib/assessments/transitions";
import { CloneUrl, InvalidCloneUrl } from "@/lib/catalog/clone-url";
import { BoundaryViolation, SourceBoundary } from "@/lib/catalog/source-boundary";
import { type FabricateConfig, getConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { generatePublicId } from "@/lib/db/ids";
import { GitError } from "@/lib/git/errors";
import { failureText } from "@/lib/git/redact";
import { GitRunner, type Protocol } from "@/lib/git/runner";
import { AcquisitionError } from "./errors";
import { Mirror } from "./mirror";
import { withSourceLock } from "./source-lease";

/**
 * Acquires one Assessment target: pins the commit its configured reference
 * names and records the snapshot. This is the only network-capable phase of an
 * Assessment; analysis afterward reads the pinned commit only.
 *
 * Local sources are re-checked against the source boundary at acquisition
 * time, because a path or symbolic link can change after registration. Every
 * failure is normalized to a stable code with a redacted message.
 */

export interface AcquireOptions {
  config?: FabricateConfig;
  runner?: GitRunner;
  boundary?: SourceBoundary;
  signal?: AbortSignal;
}

export async function acquireSnapshot(db: Executor, target: AssessmentTarget, options: AcquireOptions = {}): Promise<SourceSnapshot> {
  const config = options.config ?? getConfig();
  const runner = options.runner ?? new GitRunner({ config });
  const { signal } = options;

  try {
    const { url, protocol } = gitSource(target, options.boundary ?? new SourceBoundary(config));
    return await withSourceLock(target.repositorySourceId, { waitMs: config.gitLockTimeoutSeconds * 1_000, signal }, async () => {
      const mirror = new Mirror(runner, target.sourcePublicId);
      await mirror.ensure();
      await mirror.clearIncoming(target.publicId);
      try {
        const resolved = await mirror.resolve(url, protocol, target.gitRef, signal);
        const fetched = await mirror.fetch(url, protocol, resolved, target.publicId, signal);

        const snapshotId = generatePublicId("snp");
        const snapshotRef = internalRefFor(snapshotId);
        await mirror.pin(snapshotRef, fetched.commitSha);
        try {
          if (signal?.aborted) throw new AcquisitionError("canceled", "Acquisition was canceled");
          return recordSnapshot(db, target, {
            publicId: snapshotId,
            commitSha: fetched.commitSha,
            treeSha: fetched.treeSha,
            refKind: resolved.kind,
            resolvedRef: resolved.name,
            acquisitionMetadata: {
              requested_ref: target.gitRef,
              resolved_ref: resolved.name,
              ref_kind: resolved.kind,
              protocol,
              clone_url: target.cloneUrl,
              shallow: true,
            },
          });
        } catch (error) {
          await mirror.unpin(snapshotRef);
          throw error;
        }
      } finally {
        await mirror.clearIncoming(target.publicId);
      }
    });
  } catch (error) {
    throw normalizeAcquisitionError(error);
  }
}

export type AcquisitionOutcome = { ok: true; snapshot: SourceSnapshot } | { ok: false; error: AcquisitionError; target: AssessmentTarget };

/**
 * Acquires a target and records the outcome on it. A failure moves only this
 * target to failed (or canceled), with a stable code and a redacted message;
 * no other target or record changes.
 */
export async function acquireTarget(db: Executor, target: AssessmentTarget, options: AcquireOptions = {}): Promise<AcquisitionOutcome> {
  try {
    return { ok: true, snapshot: await acquireSnapshot(db, target, options) };
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
