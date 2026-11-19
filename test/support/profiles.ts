import crypto from "node:crypto";
import { analyze, detectorConfiguration } from "@repo-facts/bundle";
import { SURVEYOR_RELEASE } from "@/lib/surveys/surveyor-release";
import { type JsonObject, MemoryReader, type MemoryFile, digestOf } from "@repo-facts/contract";
import { getConfig } from "@/lib/config";
import { buildProfile } from "@/lib/profiles/schema";
import type { ResolverTarget } from "@/lib/relationships/resolve";

export const sha1 = (seed: string) => crypto.createHash("sha1").update(seed).digest("hex");

/**
 * A Profile document for +files+, analyzed in memory by the pinned bundle
 * exactly as the worker analyzes a snapshot, without Git.
 */
export async function memoryProfile(files: Readonly<Record<string, MemoryFile>>, source: { public_id: string; name: string }, commit = sha1(`commit:${source.public_id}`)): Promise<{ document: JsonObject; digest: string }> {
  const limits = getConfig().analysis;
  const factDocument = await analyze(MemoryReader.fromFiles(files, { commit, budgets: limits }));
  const document = buildProfile({
    source: { public_id: source.public_id, name: source.name, clone_url: `https://git.example.com/acme/${source.name}.git`, git_ref: null },
    commit,
    surveyorRelease: SURVEYOR_RELEASE,
    configurationDigest: detectorConfiguration(limits).digest,
    factDocument,
  });
  return { document, digest: digestOf(document).digest };
}

/** A resolver target that contributed a Profile of +files+. */
export async function contributed(name: string, files: Readonly<Record<string, MemoryFile>>): Promise<ResolverTarget> {
  const source = { public_id: `src_${name}`, name };
  return { public_id: `tgt_${name}`, source, state: "complete", failure: null, profile: await memoryProfile(files, source) };
}

/** A resolver target that ended without a Profile. */
export function missing(name: string, state: "failed" | "canceled", failure: string | null = state === "failed" ? "remote_unavailable" : null): ResolverTarget {
  return { public_id: `tgt_${name}`, source: { public_id: `src_${name}`, name }, state, failure, profile: null };
}

export const manifest = (fields: Record<string, unknown>) => `${JSON.stringify(fields, null, 2)}\n`;
