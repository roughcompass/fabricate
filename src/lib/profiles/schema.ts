import { type FactDocument, type JsonObject, digestOf, factDocumentProblems } from "@repo-facts/contract";
import { z } from "zod";
import { CURRENT_VERSION, DOCUMENT_SCHEMAS } from "@/lib/documents/schemas";
import { SURVEYOR_RELEASE_LABEL } from "@/lib/product";

/**
 * Repository Profile document, version 3.
 *
 * A Profile is an envelope around the `repo_facts.fact_document` that the
 * pinned Surveyor release produced for one commit. It names the Repository
 * and the commit, and records the Surveyor release and configuration digest,
 * and embeds the fact document unchanged, with its own digest. The fact
 * document carries every fact, evidence record, search, diagnostic, and
 * Service Dependency under Surveyor's contract, and names the Reference
 * Catalog entries its facts were compared against.
 *
 * Survey identity and times live on the survey and Profile records, not in
 * the document, so identical commits surveyed with the same recipe produce
 * identical Profile documents. A survey is shared by every request for its
 * commit and recipe, so the envelope names the Repository by its public id
 * only: its name, clone URL, and the reference a request resolved belong to
 * the Repository and the survey, not to the Profile.
 *
 * Version 3 embeds fact document version 3 (Surveyor 0.7.0). Version 2
 * embedded fact document version 2 (Surveyor 0.2.0 to 0.6.0), and version 1
 * fact document version 1; both are kept as stored. Version 3 extends both
 * (src/lib/documents/schemas.ts), so a Standard that reads version 1 or 2
 * reads it.
 */

export const PROFILE_SCHEMA = DOCUMENT_SCHEMAS.repositoryProfile.name;
const PROFILE_SCHEMA_VERSION = CURRENT_VERSION.repositoryProfile;
/** The fact document version a Profile of the current version embeds. */
const FACT_DOCUMENT_VERSION = 3;

export interface ProfileInput {
  /** The Repository's public id. */
  repository: string;
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
    source: { public_id: input.repository },
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
const envelope = z.strictObject({
  schema: z.literal(PROFILE_SCHEMA),
  schema_version: z.literal(PROFILE_SCHEMA_VERSION),
  source: z.strictObject({ public_id: z.string().min(1) }),
  commit: z.string().regex(OBJECT_ID),
  detector_release: z.string().min(1),
  detector_configuration_digest: z.string().regex(/^[0-9a-f]{64}$/),
  fact_document: z.record(z.string(), z.unknown()),
  fact_document_digest: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Every problem with a new Profile document: its envelope, and the embedded fact document under Surveyor's contract. */
export function profileProblems(document: JsonObject): string[] {
  const parsed = envelope.safeParse(document);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".") || "(document)"}: ${issue.message}`);

  const factDocument = document.fact_document as JsonObject;
  const problems = factDocumentProblems(factDocument).map((problem) => `fact_document: ${problem}`);
  if (factDocument.schema_version !== FACT_DOCUMENT_VERSION) problems.push(`A version ${PROFILE_SCHEMA_VERSION} Profile embeds fact document version ${FACT_DOCUMENT_VERSION}`);
  if (digestOf(factDocument).digest !== document.fact_document_digest) problems.push("fact_document_digest does not match the embedded fact document");
  if (factDocument.commit !== document.commit) problems.push("The fact document must describe the Profile's commit");
  if (factDocument.detector_release !== document.detector_release) problems.push(`The fact document must record the Profile's ${SURVEYOR_RELEASE_LABEL}`);
  return problems;
}
