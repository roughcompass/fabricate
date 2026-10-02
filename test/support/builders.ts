import crypto from "node:crypto";
import { DETECTOR_RELEASE, detectorConfiguration } from "@repo-facts/bundle";
import type { Budgets, JsonObject } from "@repo-facts/contract";
import { createAssessment } from "@/lib/assessments/assessment-records";
import { type RepositorySource, insertSource, listSources } from "@/lib/catalog/source-records";
import { getConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { type Standard, type StandardRelease, blankDraftDocument, createStandard, insertRelease } from "@/lib/standards/standard-records";
import { type Initiative, createInitiative } from "@/lib/initiatives/initiative-records";
import { CURRENT_VERSION } from "@/lib/documents/schemas";

const suffix = () => crypto.randomBytes(3).toString("hex");

/** A remote source with a unique canonical URL unless one is given. */
export function buildSource(db: Executor, overrides: Partial<{ name: string; cloneUrl: string; canonicalUrl: string; gitRef: string | null; enabled: boolean }> = {}): RepositorySource {
  const name = overrides.name ?? `source-${suffix()}`;
  const cloneUrl = overrides.cloneUrl ?? `https://git.example.com/acme/${name}.git`;
  const canonicalUrl = overrides.canonicalUrl ?? cloneUrl.replace(/\.git$/, "");
  return insertSource(db, { name, cloneUrl, canonicalUrl, gitRef: overrides.gitRef ?? null, enabled: overrides.enabled ?? true });
}

/**
 * An Assessment over +sources+ (default: every enabled source), written directly without launching jobs.
 * Like a launched one, it records the pinned bundle's release and configuration.
 */
export function buildAssessment(db: Executor, options: { initiative?: Initiative; sources?: readonly RepositorySource[]; limits?: Budgets } = {}) {
  const sources = options.sources ?? listSources(db, { enabled: true });
  return createAssessment(db, {
    initiative: options.initiative ?? buildInitiative(db),
    launchToken: crypto.randomUUID(),
    detectorRelease: DETECTOR_RELEASE,
    configuration: detectorConfiguration(options.limits ?? getConfig().analysis).configuration,
    profileSchemaVersion: CURRENT_VERSION.repositoryProfile,
    relationshipSchemaVersion: 1,
    sources,
  });
}

/** A published Release written directly from a canonical document. */
export function buildRelease(db: Executor, options: { standard?: Standard; document?: JsonObject } = {}): StandardRelease {
  const standard = options.standard ?? createStandard(db, { name: `Standard ${suffix()}`, purpose: "Engineering baseline" }).standard;
  return insertRelease(db, { standard, document: options.document ?? { ...blankDraftDocument(), controls: [] }, draftLockVersion: 0 });
}

export function buildInitiative(db: Executor, options: { name?: string; sources?: readonly RepositorySource[] } = {}): Initiative {
  return createInitiative(db, {
    name: options.name ?? `Initiative ${suffix()}`,
    objective: "Assess the fleet",
    selectionMode: options.sources ? "explicit" : "all_enabled",
    sourcePublicIds: options.sources?.map((source) => source.publicId),
  });
}
