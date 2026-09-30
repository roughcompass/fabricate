import type { JsonObject } from "@repo-facts/contract";
import { type Executor, immediate } from "@/lib/db/client";
import { StaleRecordError, ValidationError } from "@/lib/db/errors";
import { canonicalStandard, standardDigest } from "./canonical";
import { type StandardDraft, type StandardRelease, deleteDraft, draftDocument, draftOf, getRelease, getStandard, insertRelease, releaseDocument, startDraftFromRelease } from "./standard-records";
import { type Issue, validateStandard } from "./validate";

/**
 * Explicit publication and revision.
 *
 * Publishing validates the complete draft, canonicalizes it with the
 * Standard's current name and purpose, and writes an immutable Release, all in
 * one immediate transaction that first rechecks the draft's lock version. Two
 * concurrent publications of one draft therefore create at most one Release:
 * the second finds the draft already published. The published draft is
 * consumed; later changes start from a Release in a new draft.
 */

export interface PublicationPreview {
  draft: StandardDraft;
  issues: Issue[];
  /** The digest the Release would have. */
  digest: string;
  controls: number;
}

/** What publishing the draft now would record, without writing anything. */
export function previewPublication(db: Executor, standardPublicId: string): PublicationPreview | null {
  const standard = getStandard(db, standardPublicId);
  const draft = draftOf(db, standard.id);
  if (!draft) return null;
  const document = releaseDocumentFor(draftDocument(draft), standard);
  const controls = Array.isArray(document.controls) ? document.controls.length : 0;
  return { draft, issues: validateStandard(draftDocument(draft), { metadata: standard }), digest: standardDigest(document), controls };
}

export function publishDraft(db: Executor, standardPublicId: string, expectedDraftLockVersion: number): StandardRelease {
  return immediate(db, (tx) => {
    const standard = getStandard(tx, standardPublicId);
    const draft = draftOf(tx, standard.id);
    if (!draft) throw new StaleRecordError(`${standard.name} has no draft to publish; it may already have been published`);
    if (draft.lockVersion !== expectedDraftLockVersion) throw new StaleRecordError("The draft changed after you reviewed it. Review it again before publishing.");

    const document = draftDocument(draft);
    const issues = validateStandard(document, { metadata: standard });
    if (issues.length) throw new ValidationError(issues);

    const release = insertRelease(tx, { standard, document: releaseDocumentFor(document, standard), draftLockVersion: draft.lockVersion });
    deleteDraft(tx, draft);
    return release;
  });
}

/** Starts a new draft from a Release; its Controls are copied, its publication record is not. */
export function reviseRelease(db: Executor, releasePublicId: string): StandardDraft {
  return immediate(db, (tx) => {
    const release = getRelease(tx, releasePublicId);
    const { standard: _published, ...document } = releaseDocument(release);
    return startDraftFromRelease(tx, release, document);
  });
}

/** The canonical Release document: the draft's content with the Standard's name and purpose at publication. */
function releaseDocumentFor(document: JsonObject, standard: { name: string; purpose: string }): JsonObject {
  const { standard: _previous, ...content } = document;
  return canonicalStandard({ ...content, standard: { name: standard.name, purpose: standard.purpose } }) as JsonObject;
}
