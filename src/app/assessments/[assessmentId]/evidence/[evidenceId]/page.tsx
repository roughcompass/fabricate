import { type Evidence, type JsonObject, type ResolvedEvidence, redactCredentials, resolveEvidence } from "@repo-facts/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { evidenceLocation } from "@/components/results/evidence";
import styles from "@/components/results/results.module.css";
import { ShortSha } from "@/components/ui/format";
import { Card, DetailsList, Page, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Mono } from "@/components/ui/table";
import { findAssessment, snapshotOf } from "@/lib/assessments/assessment-records";
import { getDb } from "@/lib/db/client";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { openSnapshot } from "@/lib/snapshot/open";

export const metadata: Metadata = { title: "Evidence" };

const REFUSALS: Record<string, string> = {
  commit_mismatch: "The stored snapshot is at a different commit than the evidence names.",
  path_missing: "The cited path is not in the pinned snapshot.",
  content_changed: "The cited file's content no longer matches the recorded digest.",
  unreadable: "The cited file could not be read within this deployment's limits.",
  location_invalid: "The cited location is outside the file.",
  excerpt_changed: "The cited lines no longer match the recorded excerpt.",
  id_mismatch: "The evidence record does not match its identifier.",
};

/** Re-reads the cited content from the pinned snapshot and verifies it; never throws. */
async function resolve(target: Parameters<typeof openSnapshot>[0], snapshot: Parameters<typeof openSnapshot>[1], record: Evidence): Promise<ResolvedEvidence | null> {
  try {
    return await resolveEvidence(await openSnapshot(target, snapshot), record);
  } catch {
    return null;
  }
}

export default async function EvidencePage({ params }: { params: Promise<{ assessmentId: string; evidenceId: string }> }) {
  const { assessmentId, evidenceId } = await params;
  const db = getDb();
  const assessment = findAssessment(db, assessmentId);
  if (!assessment) notFound();

  const owner = profilesOf(db, assessment.id)
    .map(({ profile, target }) => ({
      profile,
      target,
      record: ((profileDocument(profile).fact_document as JsonObject).evidence as JsonObject | undefined)?.[evidenceId],
    }))
    .find((item) => item.record);
  if (!owner) notFound();
  const record = owner.record as unknown as Evidence;
  const snapshot = snapshotOf(db, owner.target.id)!;
  const resolved = await resolve(owner.target, snapshot, record);
  const firstLine = resolved?.ok && resolved.lines ? resolved.lines.start : null;
  const excerpt = resolved?.ok ? redactCredentials(resolved.excerpt) : "";

  return (
    <Page>
      <PageHeader
        title={evidenceLocation(owner.record as JsonObject)}
        back={{
          href: `/profiles/${owner.profile.publicId}`,
          label: `${owner.target.sourceName} Profile`,
        }}
        description="Committed content that a fact, relationship, or Finding cites, re-read from the pinned snapshot and verified against its recorded digests."
      />

      <Card title="Record">
        <DetailsList
          items={[
            ["Repository", owner.target.sourceName],
            ["Commit", record.commit ? <ShortSha key="commit" sha={record.commit} /> : "Working tree"],
            ["Path", <Mono key="path">{record.path}</Mono>],
            [
              "Location",
              record.location.kind === "lines" ? `Lines ${record.location.start}–${record.location.end}` : record.location.kind === "pointer" ? <Mono key="pointer">{`${record.location.format} ${record.location.pointer}`}</Mono> : "The entry itself",
            ],
            ["Detector", <Mono key="detector">{record.detector}</Mono>],
            ["Rule", <Mono key="rule">{record.rule}</Mono>],
            ["Object id", <Mono key="object">{record.object_id.slice(0, 12)}</Mono>],
          ]}
        />
      </Card>

      <Card title="Excerpt">
        {resolved === null ? (
          <Notice tone="info" title="Excerpt unavailable">
            The pinned snapshot is not in this deployment&apos;s repository storage, so the cited lines cannot be shown. The record above still identifies the exact committed content.
          </Notice>
        ) : !resolved.ok ? (
          <Notice tone="warning" title="Evidence could not be verified">
            {REFUSALS[resolved.reason] ?? "The cited content could not be verified."} Nothing is shown rather than content that may not be what the detector read.
          </Notice>
        ) : record.location.kind === "entry" ? (
          <p>This evidence is the presence, type, or mode of the path itself, so there are no lines to show.</p>
        ) : (
          <figure aria-label={`Excerpt of ${record.path}`}>
            <pre className={styles.code}>
              <code>
                {excerpt.split("\n").map((line, index) => (
                  <span key={index}>
                    {firstLine !== null && (
                      <span className={styles.lineNumber} aria-hidden="true">
                        {firstLine + index}
                      </span>
                    )}
                    {line}
                    {"\n"}
                  </span>
                ))}
              </code>
            </pre>
          </figure>
        )}
      </Card>

      <p>
        <Link href={`/assessments/${assessment.publicId}`}>{`Back to Assessment ${assessment.publicId}`}</Link>
      </p>
    </Page>
  );
}
