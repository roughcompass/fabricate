import path from "node:path";
import { type FabricateConfig, isInside } from "@/lib/config";
import { isPublicId } from "@/lib/db/ids";
import type { PreviewBuild } from "./records";

/**
 * Where preview files live under `previews.storage` (design decisions 1, 4,
 * and 9):
 *
 *     <storage>/<pvw_…>/staging/<attempt>-<claim>/   one claim's scratch: work/ (the extracted commit), home/, tmp/, shims/, output/
 *     <storage>/<pvw_…>/logs/<attempt>-<claim>.log   one claim's log; the preview's attempt_log names the latest attempt's
 *     <storage>/<pvw_…>/out/<attempt>-<claim>/       published output; the preview's artifact names the one served
 *     <storage>/.cache/<manager>/                    package caches every build shares
 *
 * Each worker claim of an attempt has its own staging directory, log, and
 * output, so a claim that lost its lease never writes over the one that took
 * over. The preview row records the log and artifact relative to the
 * preview's directory.
 */

/** A preview's own directory. */
export function previewDirectory(config: FabricateConfig, publicId: string): string {
  if (!isPublicId(publicId, "pvw")) throw new Error(`${JSON.stringify(publicId)} is not a preview id`);
  return path.join(config.previews.storage, publicId);
}

/** The directory a preview's published artifact is served from, or null before any attempt published one. */
export function publishedDirectory(config: FabricateConfig, preview: Pick<PreviewBuild, "publicId" | "artifact">): string | null {
  return preview.artifact === null ? null : within(previewDirectory(config, preview.publicId), preview.artifact);
}

/** The latest attempt's log file, or null until a worker starts the attempt. */
export function attemptLogFile(config: FabricateConfig, preview: Pick<PreviewBuild, "publicId" | "attemptLog">): string | null {
  return preview.attemptLog === null ? null : within(previewDirectory(config, preview.publicId), preview.attemptLog);
}

/** The package caches every build shares, one directory per manager. */
export function cacheDirectory(config: FabricateConfig): string {
  return path.join(config.previews.storage, ".cache");
}

/** The files of one worker claim of an attempt. */
export interface ClaimFiles {
  /** `<attempt>-<claim>`, which names the claim's staging directory, log, and output. */
  readonly key: string;
  readonly staging: string;
  /** The extracted commit, where the install and build run. */
  readonly work: string;
  readonly home: string;
  readonly tmp: string;
  readonly shims: string;
  /** Where the build's output is moved to be validated. */
  readonly output: string;
  /** The log, absolute and as the preview row records it. */
  readonly log: string;
  readonly logName: string;
  /** Where validated output is published, absolute and as the preview row records it. */
  readonly artifact: string;
  readonly artifactName: string;
}

export function claimFiles(config: FabricateConfig, publicId: string, attempt: number, claim: string): ClaimFiles {
  if (!/^[a-z0-9]+$/.test(claim)) throw new Error("A claim's files are named by a lowercase alphanumeric key");
  const root = previewDirectory(config, publicId);
  const key = `${attempt}-${claim}`;
  const staging = path.join(root, "staging", key);
  const logName = `logs/${key}.log`;
  const artifactName = `out/${key}`;
  return {
    key,
    staging,
    work: path.join(staging, "work"),
    home: path.join(staging, "home"),
    tmp: path.join(staging, "tmp"),
    shims: path.join(staging, "shims"),
    output: path.join(staging, "output"),
    log: path.join(root, logName),
    logName,
    artifact: path.join(root, artifactName),
    artifactName,
  };
}

/** +relative+ resolved inside +root+, refusing anything that would leave it. */
function within(root: string, relative: string): string {
  const resolved = path.resolve(root, relative);
  if (resolved === root || !isInside(root, resolved)) throw new Error(`${JSON.stringify(relative)} is outside the preview's directory`);
  return resolved;
}
