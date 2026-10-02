import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TagList } from "@/components/ui/tag";
import { type Assessment, assessmentNumber, listAssessments } from "@/lib/assessments/assessment-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { listInitiatives, scopeLabel, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { releaseLabel } from "@/lib/standards/standard-records";
import { initiativeListOutcome } from "./outcomes";

// The layout's title template applies to child segments only, so the root page sets its full title.
export const metadata: Metadata = { title: "Assessments" };

export default async function InitiativesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const db = getDb();
  const enabledCount = listSources(db, { enabled: true }).length;
  const rows = listInitiatives(db).map((initiative) => {
    const latest = listAssessments(db, initiative.id)[0];
    return {
      initiative,
      scope: initiative.selectionMode === "all_enabled" ? `${scopeLabel(initiative, 0)} (${enabledCount})` : scopeLabel(initiative, selectedSources(db, initiative.id).length),
      releases: selectedReleases(db, initiative.id).map(({ release, standard }) => releaseLabel(standard, release)),
      latest: latest && { assessment: latest, number: assessmentNumber(db, latest) },
    };
  });
  const claims = listInitiatives(db, { systemOwned: true }).map((initiative) => {
    const latest = listAssessments(db, initiative.id)[0];
    return { initiative, repository: selectedSources(db, initiative.id)[0], latest: latest && { assessment: latest, number: assessmentNumber(db, latest) } };
  });
  const create = (
    <ButtonLink href="/assessments/new" variant="primary" icon="plus">
      New Assessment
    </ButtonLink>
  );

  return (
    <Page>
      <PageHeader
        title="Assessments"
        description="Each Assessment scopes repositories for Runs and selects Standard Releases to evaluate them against."
        primaryAction={create}
        alerts={<OutcomeToast outcome={initiativeListOutcome(param(query, "notice"))} />}
      />

      <Panel flush>
        {rows.length > 0 ? (
          <Table
            label="Assessments"
            head={
              <>
                <Th>Assessment</Th>
                <Th>Scope</Th>
                <Th>Standard Releases</Th>
                <Th>Latest Run</Th>
              </>
            }
          >
            {rows.map(({ initiative, scope, releases, latest }) => (
              <tr key={initiative.publicId}>
                <Td label="Assessment">
                  <Primary>
                    <Link href={`/assessments/${initiative.publicId}`}>{initiative.name}</Link>
                  </Primary>
                  {initiative.objective && <Secondary>{initiative.objective.length > 140 ? `${initiative.objective.slice(0, 140)}…` : initiative.objective}</Secondary>}
                </Td>
                <Td label="Scope">{scope}</Td>
                <Td label="Standard Releases">
                  <TagList values={releases} />
                </Td>
                <Td label="Latest Run">
                  <LatestRun latest={latest} />
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title="No Assessments yet" icon="checklist" action={create}>
            An Assessment covers all enabled Repositories or a chosen subset, and can evaluate them against published Standard Releases.
          </EmptyState>
        )}
      </Panel>

      {claims.length > 0 && (
        <Section title="Created for claims" description="Claiming a Repository creates an Assessment of it alone, reused for later claims.">
          <Panel flush>
            <Table
              label="Assessments created for claims"
              head={
                <>
                  <Th>Assessment</Th>
                  <Th>Repository</Th>
                  <Th>Latest Run</Th>
                </>
              }
            >
              {claims.map(({ initiative, repository, latest }) => (
                <tr key={initiative.publicId}>
                  <Td label="Assessment">
                    <Primary>
                      <Link href={`/assessments/${initiative.publicId}`}>{initiative.name}</Link>
                    </Primary>
                  </Td>
                  <Td label="Repository">{repository ? <Link href={`/repositories/claim/${repository.publicId}`}>{repository.name}</Link> : <Secondary>None</Secondary>}</Td>
                  <Td label="Latest Run">
                    <LatestRun latest={latest} />
                  </Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </Section>
      )}
    </Page>
  );
}

function LatestRun({ latest }: { latest: { assessment: Assessment; number: number } | undefined }) {
  if (!latest) return <Secondary>Not assessed yet</Secondary>;
  return (
    <>
      <Link href={`/runs/${latest.assessment.publicId}`}>{`Run #${latest.number}`}</Link>
      <Secondary>
        <Status state={latest.assessment.state} size="sm" /> · <RelativeTime value={latest.assessment.createdAt} />
      </Secondary>
    </>
  );
}
