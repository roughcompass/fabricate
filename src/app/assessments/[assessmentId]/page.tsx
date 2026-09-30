import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/badge";
import { Timestamp } from "@/components/ui/format";
import { Card, DetailsList, Page, PageHeader, ui } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Mono, Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { findAssessment, targetReferenceLabel, targetsOf } from "@/lib/assessments/assessment-records";
import { getDb } from "@/lib/db/client";
import { initiatives } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const metadata: Metadata = { title: "Assessment" };

export default async function AssessmentPage({ params, searchParams }: { params: Promise<{ assessmentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ assessmentId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const assessment = findAssessment(db, assessmentId);
  if (!assessment) notFound();

  const initiative = db.select().from(initiatives).where(eq(initiatives.id, assessment.initiativeId)).get()!;
  const targets = targetsOf(db, assessment.id);

  return (
    <Page>
      <PageHeader
        title={`Assessment ${assessment.publicId}`}
        back={{ href: `/initiatives/${initiative.publicId}`, label: initiative.name }}
        badge={<StatusBadge state={assessment.state} />}
        description="Each scoped repository is pinned to a commit and analyzed without running its code. This scope was frozen when the assessment started."
      />

      {query.notice === "started" && (
        <Notice tone="success" live>
          The assessment was started.
        </Notice>
      )}
      {query.notice === "already-started" && (
        <Notice tone="info" live>
          This assessment was already started; no duplicate work was created.
        </Notice>
      )}

      <Card title="Scope" description="Source configuration as it was when the assessment started." flush>
        <Table
          label="Assessment scope"
          head={
            <>
              <Th>Source</Th>
              <Th>Clone URL</Th>
              <Th>Reference</Th>
              <Th>Status</Th>
            </>
          }
        >
          {targets.map((target) => (
            <tr key={target.publicId} id={target.publicId}>
              <Td label="Source">
                <Primary>{target.sourceName}</Primary>
                <Secondary mono>{target.sourcePublicId}</Secondary>
              </Td>
              <Td label="Clone URL">
                <Mono>{target.cloneUrl}</Mono>
              </Td>
              <Td label="Reference">{target.gitRef ? <Mono>{target.gitRef}</Mono> : <span className={ui.muted}>{targetReferenceLabel(target)}</span>}</Td>
              <Td label="Status">
                <StatusBadge state={target.state} />
                {target.failureMessage && <Secondary>{target.failureMessage}</Secondary>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Recorded inputs">
        <DetailsList
          items={[
            ["Detector release", <Mono key="release">{assessment.detectorRelease}</Mono>],
            ["Configuration digest", <Mono key="digest">{assessment.configurationDigest.slice(0, 12)}</Mono>],
            ["Created", <Timestamp key="created" value={assessment.createdAt} />],
            ["Started", <Timestamp key="started" value={assessment.startedAt} />],
            ["Finished", <Timestamp key="finished" value={assessment.finishedAt} />],
          ]}
        />
      </Card>
    </Page>
  );
}
