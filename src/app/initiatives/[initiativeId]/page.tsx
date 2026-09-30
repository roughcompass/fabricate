import crypto from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Timestamp, countLabel } from "@/components/ui/format";
import { Card, DetailsList, EmptyState, Page, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Mono, Secondary, Table, Td, Th } from "@/components/ui/table";
import { listAssessments, targetsOf } from "@/lib/assessments/assessment-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { findInitiative, scopeLabel, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { releaseLabel } from "@/lib/standards/standard-records";
import { startAssessment } from "../actions";
import { LaunchForm } from "../launch-form";
import styles from "../initiatives.module.css";

export const metadata: Metadata = { title: "Initiative" };

const NOTICES: Record<string, [tone: "success" | "warning", message: string]> = {
  created: ["success", "The initiative was created."],
  updated: ["success", "The initiative was updated. Existing Assessments and Evaluations keep the scope and Releases they started with."],
  retained: ["warning", "This initiative has Assessments, so it is retained to keep their history reviewable."],
};

export default async function InitiativePage({ params, searchParams }: { params: Promise<{ initiativeId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ initiativeId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const initiative = findInitiative(db, initiativeId);
  if (!initiative) notFound();

  const sources = selectedSources(db, initiative.id);
  const releases = selectedReleases(db, initiative.id);
  const assessments = listAssessments(db, initiative.id).map((assessment) => ({ assessment, targets: targetsOf(db, assessment.id) }));
  const enabledCount = listSources(db, { enabled: true }).length;
  const notice = typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  return (
    <Page>
      <PageHeader
        title={initiative.name}
        back={{ href: "/", label: "Initiatives" }}
        description={initiative.objective || undefined}
        actions={
          <>
            <ButtonLink href={`/initiatives/${initiative.publicId}/edit`} icon="edit">
              Edit
            </ButtonLink>
            <LaunchForm action={startAssessment.bind(null, initiative.publicId)} launchToken={crypto.randomUUID()} />
          </>
        }
      />

      {notice && (
        <Notice tone={notice[0]} live>
          {notice[1]}
        </Notice>
      )}

      <Card title="Scope">
        <DetailsList
          items={[
            ["Repositories", initiative.selectionMode === "all_enabled" ? `All enabled sources (${enabledCount} now)` : scopeLabel(initiative, sources.length)],
            ...(initiative.selectionMode === "explicit"
              ? ([
                  [
                    "Selected",
                    <ul key="selected" className={styles.releases}>
                      {sources.map((source) => (
                        <li key={source.publicId} className={styles.release}>
                          <span>{source.name}</span>
                          {!source.enabled && <StatusBadge state="disabled" />}
                        </li>
                      ))}
                    </ul>,
                  ],
                ] as const)
              : []),
            ["Public id", <Mono key="id">{initiative.publicId}</Mono>],
          ]}
        />
      </Card>

      <Card
        title="Standard Releases"
        description={
          releases.length
            ? "Each selected Release is evaluated independently. Assessments never depend on these selections."
            : "None selected. Assessments establish current state without a Standard; select a published Release to run Evaluations."
        }
      >
        {releases.length > 0 && (
          <ul className={styles.releases}>
            {releases.map(({ release, standard }) => (
              <li key={release.publicId} className={styles.release}>
                <Link href={`/standards/${standard.publicId}/releases/${release.publicId}`}>{releaseLabel(standard, release)}</Link>
                <Mono>{release.digest.slice(0, 12)}</Mono>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Assessments" description="Current-state runs, newest first. Each keeps the scope it started with." flush={assessments.length > 0}>
        {assessments.length > 0 ? (
          <Table
            label="Assessment history"
            head={
              <>
                <Th>Assessment</Th>
                <Th>Status</Th>
                <Th>Scope</Th>
                <Th>Started</Th>
                <Th>Finished</Th>
              </>
            }
          >
            {assessments.map(({ assessment, targets }) => {
              const failed = targets.filter((target) => target.state === "failed").length;
              const canceled = targets.filter((target) => target.state === "canceled").length;
              return (
                <tr key={assessment.publicId}>
                  <Td label="Assessment">
                    <Link href={`/assessments/${assessment.publicId}`}>
                      <Mono>{assessment.publicId}</Mono>
                    </Link>
                    <Secondary>
                      <Timestamp value={assessment.createdAt} />
                    </Secondary>
                  </Td>
                  <Td label="Status">
                    <StatusBadge state={assessment.state} />
                  </Td>
                  <Td label="Scope">
                    {[countLabel(targets.length, "source"), failed ? `${failed} failed` : null, canceled ? `${canceled} canceled` : null].filter(Boolean).join(" · ")}
                  </Td>
                  <Td label="Started">
                    <Timestamp value={assessment.startedAt} />
                  </Td>
                  <Td label="Finished">
                    <Timestamp value={assessment.finishedAt} />
                  </Td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState title="Not assessed yet">Start an assessment to pin every scoped repository to a commit and analyze it without running its code.</EmptyState>
        )}
      </Card>
    </Page>
  );
}
