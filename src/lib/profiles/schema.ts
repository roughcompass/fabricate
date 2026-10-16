import { type FactDocument, type JsonObject, digestOf, factDocumentProblems } from "@repo-facts/contract";
import { z } from "zod";
import { CURRENT_VERSION, DOCUMENT_SCHEMAS } from "@/lib/documents/schemas";

/**
 * Repository Profile document, version 2.
 *
 * A Profile is an envelope around the `repo_facts.fact_document` that the
 * pinned detector bundle produced for one snapshot. It records the source
 * identity, commit, detector release, and detector configuration digest, and
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
 *
 * A template version's Profile (converge-templates-and-prototypes, design
 * decision 2) is version 2 with `template` and `content_digest`, the Git tree
 * id of its exported files, in place of `source` and `commit`: stored files
 * have no repository and no commit.
 */

export const PROFILE_SCHEMA = DOCUMENT_SCHEMAS.repositoryProfile.name;
export const PROFILE_SCHEMA_VERSION = CURRENT_VERSION.repositoryProfile;

export interface ProfileSource {
  public_id: string;
  name: string;
  clone_url: string;
  git_ref: string | null;
}

export interface ProfileInput {
  source: ProfileSource;
  commit: string;
  detectorRelease: string;
  configurationDigest: string;
  factDocument: FactDocument;
}

/** The template version a template Profile describes. A first acceptance is assessed before its template exists. */
export interface ProfileTemplate {
  public_id: string | null;
  name: string;
  version_public_id: string | null;
  version_number: number | null;
  prototype_version_public_id: string;
}

export interface TemplateProfileInput {
  template: ProfileTemplate;
  contentDigest: string;
  detectorRelease: string;
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
    detector_release: input.detectorRelease,
    detector_configuration_digest: input.configurationDigest,
    fact_document: factDocument,
    fact_document_digest: digestOf(factDocument).digest,
  };
}

export function buildTemplateProfile(input: TemplateProfileInput): JsonObject {
  const factDocument = input.factDocument as unknown as JsonObject;
  const { template } = input;
  return {
    schema: PROFILE_SCHEMA,
    schema_version: PROFILE_SCHEMA_VERSION,
    template: {
      public_id: template.public_id,
      name: template.name,
      version_public_id: template.version_public_id,
      version_number: template.version_number,
      prototype_version_public_id: template.prototype_version_public_id,
    },
    content_digest: input.contentDigest,
    detector_release: input.detectorRelease,
    detector_configuration_digest: input.configurationDigest,
    fact_document: factDocument,
    fact_document_digest: digestOf(factDocument).digest,
  };
}

/** Whether +document+ is a template version's Profile rather than a repository's. */
export function isTemplateProfile(document: JsonObject): boolean {
  return "template" in document;
}

/** The commit a Profile describes, or null for a template version's stored files. */
export function profileCommit(document: JsonObject): string | null {
  return typeof document.commit === "string" ? document.commit : null;
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
const sourceEnvelope = z.strictObject({
  ...shared,
  source: z.strictObject({ public_id: z.string().min(1), name: z.string().min(1), clone_url: z.string().min(1), git_ref: z.string().min(1).nullable() }),
  commit: z.string().regex(OBJECT_ID),
});
const templateEnvelope = z.strictObject({
  ...shared,
  template: z
    .strictObject({
      public_id: z.string().regex(/^ptp_[a-z0-9]{16}$/).nullable(),
      name: z.string().min(1),
      version_public_id: z.string().regex(/^ptv_[a-z0-9]{16}$/).nullable(),
      version_number: z.number().int().min(1).nullable(),
      prototype_version_public_id: z.string().regex(/^ver_[a-z0-9]{16}$/),
    })
    .refine((template) => (template.public_id === null) === (template.version_public_id === null) && (template.public_id === null) === (template.version_number === null), "A template's id, version id, and version number are given together or not at all"),
  content_digest: z.string().regex(OBJECT_ID),
});

/** Every problem with a Profile document: its envelope, and the embedded fact document under the repo-facts contract. */
export function profileProblems(document: JsonObject): string[] {
  const parsed = (isTemplateProfile(document) ? templateEnvelope : sourceEnvelope).safeParse(document);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".") || "(document)"}: ${issue.message}`);

  const factDocument = document.fact_document as JsonObject;
  const problems = factDocumentProblems(factDocument).map((problem) => `fact_document: ${problem}`);
  if (digestOf(factDocument).digest !== document.fact_document_digest) problems.push("fact_document_digest does not match the embedded fact document");
  // Stored files have no commit, so a template's fact document names none.
  if ((factDocument.commit ?? null) !== profileCommit(document)) problems.push("The fact document must describe the Profile's commit");
  if (factDocument.detector_release !== document.detector_release) problems.push("The fact document must record the Profile's detector release");
  return problems;
}
