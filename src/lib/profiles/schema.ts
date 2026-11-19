import { type FactDocument, type JsonObject, digestOf, factDocumentProblems } from "@repo-facts/contract";
import { z } from "zod";
import { CURRENT_VERSION, DOCUMENT_SCHEMAS } from "@/lib/documents/schemas";
import { SURVEYOR_RELEASE_LABEL } from "@/lib/product";

/**
 * Repository Profile document, version 2.
 *
 * A Profile is an envelope around the `repo_facts.fact_document` that the
 * pinned detector bundle produced for one snapshot. It records the source
 * identity, commit, Surveyor release, and detector configuration digest, and
 * embeds the fact document unchanged, with its own digest. The fact document
 * carries every fact, evidence record, search, diagnostic, and Service
 * Dependency under the repo-facts contract.
 *
 * Run identity and times live on the Profile record, not in the document, so
 * identical snapshots analyzed with the same release and configuration
 * produce identical Profile documents.
 *
 * Version 2 embeds fact document version 2 (repo-facts 0.2.0), which adds the
 * design-system categories. Version 1 Profiles, from repo-facts 0.1.0, are
 * kept as stored; version 2 extends version 1, so readers of version 1 read
 * either.
 */

export const PROFILE_SCHEMA = DOCUMENT_SCHEMAS.repositoryProfile.name;
const PROFILE_SCHEMA_VERSION = CURRENT_VERSION.repositoryProfile;

interface ProfileSource {
  public_id: string;
  name: string;
  clone_url: string;
  git_ref: string | null;
}

export interface ProfileInput {
  source: ProfileSource;
  commit: string;
  surveyorRelease: string;
  configurationDigest: string;
  factDocument: FactDocument;
}

export function buildProfile(input: ProfileInput): JsonObject {
  const factDocument = input.factDocument as unknown as JsonObject;
  return {
    schema: PROFILE_SCHEMA,
    schema_version: PROFILE_SCHEMA_VERSION,
    source: { public_id: input.source.public_id, name: input.source.name, clone_url: input.source.clone_url, git_ref: input.source.git_ref },
    commit: input.commit,
    detector_release: input.surveyorRelease,
    detector_configuration_digest: input.configurationDigest,
    fact_document: factDocument,
    fact_document_digest: digestOf(factDocument).digest,
  };
}

/** The commit a Profile describes. */
export function profileCommit(document: JsonObject): string {
  return String(document.commit);
}

const OBJECT_ID = /^[0-9a-f]{40}$/;
const shared = {
  schema: z.literal(PROFILE_SCHEMA),
  schema_version: z.literal(PROFILE_SCHEMA_VERSION),
  detector_release: z.string().min(1),
  detector_configuration_digest: z.string().regex(/^[0-9a-f]{64}$/),
  fact_document: z.record(z.string(), z.unknown()),
  fact_document_digest: z.string().regex(/^[0-9a-f]{64}$/),
};
const envelope = z.strictObject({
  ...shared,
  source: z.strictObject({ public_id: z.string().min(1), name: z.string().min(1), clone_url: z.string().min(1), git_ref: z.string().min(1).nullable() }),
  commit: z.string().regex(OBJECT_ID),
});
/** Every problem with a Profile document: its envelope, and the embedded fact document under the repo-facts contract. */
export function profileProblems(document: JsonObject): string[] {
  const parsed = envelope.safeParse(document);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".") || "(document)"}: ${issue.message}`);

  const factDocument = document.fact_document as JsonObject;
  const problems = factDocumentProblems(factDocument).map((problem) => `fact_document: ${problem}`);
  if (digestOf(factDocument).digest !== document.fact_document_digest) problems.push("fact_document_digest does not match the embedded fact document");
  if (factDocument.commit !== document.commit) problems.push("The fact document must describe the Profile's commit");
  if (factDocument.detector_release !== document.detector_release) problems.push(`The fact document must record the Profile's ${SURVEYOR_RELEASE_LABEL}`);
  return problems;
}
