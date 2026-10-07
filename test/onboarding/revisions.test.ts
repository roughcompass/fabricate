import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { generatePublicId } from "@/lib/db/ids";
import { microfrontends } from "@/lib/db/schema";
import { statedActor } from "@/lib/onboarding/attribution";
import { StaleDraftError, draftOf, latestSubmitted, latestValidation, revisionsOf, saveDraft, startDraft, submitDraft } from "@/lib/onboarding/revisions";
import { buildSource } from "../support/builders";
import { createTestDb, rawRun } from "../support/db";

const ana = statedActor("ana@example.com");

describe("onboarding revisions", () => {
  let db: Db;
  let mfe: number;
  let repository: number;

  beforeEach(() => {
    db = createTestDb();
    mfe = db.insert(microfrontends).values({ publicId: generatePublicId("mfe"), name: "Payee search", createdAt: new Date() }).returning().get().id;
    repository = buildSource(db, { name: "payee" }).id;
  });

  const submit = (lockVersion: number, issues: { code: string; severity: "blocking" | "warning"; location: string; message: string }[] = []) =>
    submitDraft(db, "microfrontend", mfe, {
      lockVersion,
      actor: ana,
      prepare: (_tx, draft) => ({
        issues,
        document: { ...draft.document, canonical: true },
        activate: true,
        revisionColumns: { name: "Payee search", owner_team: "Payee", repository_source_id: repository, rendering: '{"esm":{"exports":["./Search"]}}' },
        identityColumns: { owner_team: "Payee" },
      }),
    });

  it("starts one Draft at a time, numbered in order, and opens the same Draft again", () => {
    const first = startDraft(db, "microfrontend", mfe, ana, { name: "Payee search" });
    expect(first).toMatchObject({ number: 1, state: "draft", lockVersion: 0, document: { name: "Payee search" }, basedOnRevisionId: null, createdBy: "ana@example.com" });
    expect(startDraft(db, "microfrontend", mfe, statedActor("ben"), { name: "ignored" }).id).toBe(first.id);
    expect(db.$client.prepare("select draft_revision_id as draft from microfrontends where id = ?").get(mfe)).toEqual({ draft: first.id });
    expect(() => rawRun(db, "insert into microfrontend_revisions (microfrontend_id, number, state, document, created_by, created_at, updated_at) values (?, 2, 'draft', '{}', 'ben', 1, 1)", mfe)).toThrow(/UNIQUE constraint failed: microfrontend_revisions.microfrontend_id/);
    expect(() => rawRun(db, "insert into microfrontend_revisions (microfrontend_id, number, state, document, created_by, created_at, updated_at) values (?, 5, 'submitted', '{}', 'ben', 1, 1)", mfe)).toThrow(/takes the next number/);
  });

  it("refuses a save based on an older version, keeping what was entered and leaving the Draft unchanged (Concurrent edits)", () => {
    const draft = startDraft(db, "microfrontend", mfe, ana, { name: "Payee search" });
    const saved = saveDraft(db, "microfrontend", mfe, { lockVersion: draft.lockVersion, document: { name: "Payee search v2" } });
    expect(saved).toMatchObject({ lockVersion: 1, document: { name: "Payee search v2" } });

    let stale: StaleDraftError | undefined;
    try {
      saveDraft(db, "microfrontend", mfe, { lockVersion: draft.lockVersion, document: { name: "Ben's name" } });
    } catch (error) {
      stale = error as StaleDraftError;
    }
    expect(stale).toBeInstanceOf(StaleDraftError);
    expect(stale!.attempted).toEqual({ name: "Ben's name" });
    expect(stale!.current).toMatchObject({ lockVersion: 1, document: { name: "Payee search v2" } });
    expect(draftOf(db, "microfrontend", mfe)).toMatchObject({ lockVersion: 1, document: { name: "Payee search v2" } });
    expect(() => rawRun(db, "update microfrontend_revisions set document = '{}' where id = ?", draft.id)).toThrow(/advances its lock version/);
  });

  it("records the validation of a blocked submission, and submits nothing (Several onboarding issues)", () => {
    const draft = startDraft(db, "microfrontend", mfe, ana, { name: "Payee search" });

    const result = submit(draft.lockVersion, [
      { code: "source.missing", severity: "blocking", location: "repository", message: "Choose the Repository" },
      { code: "contract.missing", severity: "blocking", location: "contract", message: "Describe the contract" },
      { code: "seal.missing", severity: "warning", location: "sealId", message: "No SEAL ID" },
    ]);

    expect(result.submitted).toBe(false);
    expect(result.issues.map((issue) => issue.location)).toEqual(["contract", "repository", "sealId"]);
    expect(draftOf(db, "microfrontend", mfe)).toMatchObject({ id: draft.id, state: "draft", lockVersion: 0 });
    expect(latestSubmitted(db, "microfrontend", mfe)).toBeUndefined();
    expect(latestValidation(db, "microfrontend", draft.id)).toMatchObject({ blocking: 2, issues: [{ code: "contract.missing" }, { code: "source.missing" }, { code: "seal.missing" }] });
  });

  it("freezes a submitted revision, and starts the next Draft from it", () => {
    const draft = startDraft(db, "microfrontend", mfe, ana, { name: "Payee search" });
    expect(() => submit(draft.lockVersion + 1)).toThrow(StaleDraftError);

    const result = submit(draft.lockVersion);

    expect(result).toMatchObject({ submitted: true, revision: { number: 1, state: "submitted", submittedBy: "ana@example.com", document: { name: "Payee search", canonical: true } } });
    expect(result.revision.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(db.$client.prepare("select active_revision_id as active, draft_revision_id as draft, owner_team as team from microfrontends where id = ?").get(mfe)).toEqual({ active: draft.id, draft: null, team: "Payee" });
    expect(() => rawRun(db, "update microfrontend_revisions set owner_team = 'Other', lock_version = lock_version + 1 where id = ?", draft.id)).toThrow(/never changed/);
    expect(() => rawRun(db, "delete from microfrontend_revisions")).toThrow(/retained/);
    expect(() => rawRun(db, "update microfrontends set active_revision_id = NULL, draft_revision_id = ? where id = ?", draft.id, mfe)).toThrow(/the draft a Draft/);

    const next = startDraft(db, "microfrontend", mfe, ana);
    expect(next).toMatchObject({ number: 2, basedOnRevisionId: draft.id, document: { name: "Payee search", canonical: true } });
    saveDraft(db, "microfrontend", mfe, { lockVersion: 0, document: { name: "Payee search", owner: "changed" } });
    expect(latestSubmitted(db, "microfrontend", mfe)!.document).toEqual({ name: "Payee search", canonical: true });
    expect(revisionsOf(db, "microfrontend", mfe).map((revision) => [revision.number, revision.state])).toEqual([
      [1, "submitted"],
      [2, "draft"],
    ]);
    expect(db.$client.prepare("select event, revision from onboarding_events order by id").all()).toEqual([
      { event: "draft_started", revision: 1 },
      { event: "submitted", revision: 1 },
      { event: "draft_started", revision: 2 },
    ]);
  });

  it("refuses a Draft that isn't a JSON object, or is too large", () => {
    startDraft(db, "microfrontend", mfe, ana);
    expect(() => saveDraft(db, "microfrontend", mfe, { lockVersion: 0, document: ["not", "an", "object"] })).toThrow(/A draft is a JSON object/);
    expect(() => saveDraft(db, "microfrontend", mfe, { lockVersion: 0, document: { blob: "x".repeat(300_000) } })).toThrow(/larger than 256 KB/);
    expect(() => statedActor("  ")).toThrow(/Enter your name/);
  });
});
