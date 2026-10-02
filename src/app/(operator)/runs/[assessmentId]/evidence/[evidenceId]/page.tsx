import { type Evidence, type JsonObject, type ResolvedEvidence, redactCredentials, resolveEvidence } from "@repo-facts/contract";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { evidenceLocation } from "@/components/results/evidence";
import { Alert } from "@/components/ui/alert";
import { CodeBlock } from "@/components/ui/code-block";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { ShortValue, Tag } from "@/components/ui/tag";
import { assessmentNumber, findAssessment, snapshotOf } from "@/lib/assessments/assessment-records";
import { getDb } from "@/lib/db/client";
import { initiativeById } from "@/lib/initiatives/initiative-records";
import { evidenceSection } from "@/lib/profiles/links";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import type { FactDocument } from "@/lib/profiles/states";
import { openSnapshot } from "@/lib/snapshot/open";

const REFUSALS: Record<string, string> = {
  commit_mismatch: "The stored snapshot is at a different commit than the evidence names.",
  path_missing: "The cited path is not in the pinned snapshot.",
  content_changed: "The cited file's content no longer matches the recorded digest.",
  unreadable: "The cited file could not be read within this deployment's limits.",
  location_invalid: "The cited location is outside the file.",
  excerpt_changed: "The cited lines no longer match the recorded excerpt.",
  id_mismatch: "The evidence record does not match its identifier.",
};

const load = cache((assessmentId: string, evidenceId: string) => {
  const db = getDb();
  const assessment = findAssessment(db, assessmentId);
  if (!assessment) return undefined;
  const owner = profilesOf(db, assessment.id)
    .map(({ profile, target }) => {
      const facts = profileDocument(profile).fact_document as JsonObject;
      return { profile, target, facts, record: (facts.evidence as JsonObject | undefined)?.[evidenceId] };
    })
    .find((item) => item.record);
  if (!owner) return undefined;
  // The Profile breadcrumb returns to the section that cites this evidence.
  const section = evidenceSection(owner.facts as unknown as FactDocument, evidenceId);
  return { assessment, owner, section, initiative: initiativeById(db, assessment.initiativeId), number: assessmentNumber(db, assessment) };
});

export async function generateMetadata({ params }: { params: Promise<{ assessmentId: string; evidenceId: string }> }): Promise<Metadata> {
  const { assessmentId, evidenceId } = await params;
  const found = load(assessmentId, evidenceId);
  return { title: found ? `${evidenceLocation(found.owner.record as JsonObject)} · ${found.owner.target.sourceName}` : "Evidence not found" };
}

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
  const found = load(assessmentId, evidenceId);
  if (!found) notFound();
  const { assessment, owner, section, initiative, number } = found;
  const record = owner.record as unknown as Evidence;
  const snapshot = snapshotOf(db, owner.target.id)!;
  const resolved = await resolve(owner.target, snapshot, record);
  const firstLine = resolved?.ok && resolved.lines ? resolved.lines.start : null;
  const excerpt = resolved?.ok ? redactCredentials(resolved.excerpt) : "";

  return (
    <Page>
      <PageHeader
        breadcrumbs={[
          { href: "/assessments", label: "Assessments" },
          { href: `/assessments/${initiative.publicId}`, label: initiative.name },
          { href: `/runs/${assessment.publicId}`, label: `Run #${number}` },
          { href: `/profiles/${owner.profile.publicId}${section ? `#${section}` : ""}`, label: owner.target.sourceName },
        ]}
        title={evidenceLocation(owner.record as JsonObject)}
        description="Committed content that a fact, relationship, or Finding cites, re-read from the pinned snapshot and verified against its recorded digests."
        alerts={
          resolved !== null &&
          !resolved.ok && (
            <Alert tone="warning" title="Evidence could not be verified">
              {REFUSALS[resolved.reason] ?? "The cited content could not be verified."} Nothing is shown rather than content that may not be what the detector read.
            </Alert>
          )
        }
      />

      <Section title="Record">
        <DescriptionList surface
          items={[
            ["Repository", owner.target.sourceName],
            ["Commit", record.commit ? <ShortValue key="commit" value={record.commit} label="commit" /> : "Working tree"],
            ["Path", <Tag key="path" copy label="path">{record.path}</Tag>],
            ["Location", record.location.kind === "lines" ? (record.location.start === record.location.end ? `Line ${record.location.start}` : `Lines ${record.location.start}–${record.location.end}`) : record.location.kind === "pointer" ? <Tag key="pointer">{`${record.location.format} ${record.location.pointer}`}</Tag> : "The entry itself"],
            ["Detector", <Tag key="detector">{record.detector}</Tag>],
            ["Rule", <Tag key="rule">{record.rule}</Tag>],
            ["Object ID", <ShortValue key="object" value={record.object_id} label="object ID" />],
          ]}
        />
      </Section>

      <Section title="Excerpt">
        {resolved === null ? (
          <Panel flush>
            <EmptyState title="Excerpt unavailable" icon="file">
              The pinned snapshot is not in this deployment&apos;s repository storage, so the cited lines cannot be shown. The record above still identifies the exact committed content.
            </EmptyState>
          </Panel>
        ) : !resolved.ok ? (
          <p>No excerpt is shown for unverified evidence.</p>
        ) : record.location.kind === "entry" ? (
          <p>This evidence is the presence, type, or mode of the path itself, so there are no lines to show.</p>
        ) : (
          <div aria-label={`Excerpt of ${record.path}`} role="group">
            <CodeBlock label={record.path} firstLine={firstLine} code={excerpt} />
          </div>
        )}
      </Section>
    </Page>
  );
}
