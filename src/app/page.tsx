import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TagList } from "@/components/ui/tag";
import { assessmentNumber, listAssessments } from "@/lib/assessments/assessment-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { listInitiatives, scopeLabel, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { releaseLabel } from "@/lib/standards/standard-records";
import { initiativeListOutcome } from "./initiatives/outcomes";

// The layout's title template applies to child segments only, so the root page sets its full title.
export const metadata: Metadata = { title: { absolute: "Initiatives · Fabricate" } };

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
  const create = (
    <ButtonLink href="/initiatives/new" variant="primary" icon="plus">
      New Initiative
    </ButtonLink>
  );

  return (
    <Page>
      <PageHeader
        title="Initiatives"
        description="Each Initiative scopes repositories for Assessments and selects Standard Releases to evaluate them against."
        primaryAction={create}
        alerts={<OutcomeToast outcome={initiativeListOutcome(param(query, "notice"))} />}
      />

      <Panel flush>
        {rows.length > 0 ? (
          <Table
            label="Initiatives"
            head={
              <>
                <Th>Initiative</Th>
                <Th>Scope</Th>
                <Th>Standard Releases</Th>
                <Th>Latest Assessment</Th>
              </>
            }
          >
            {rows.map(({ initiative, scope, releases, latest }) => (
              <tr key={initiative.publicId}>
                <Td label="Initiative">
                  <Primary>
                    <Link href={`/initiatives/${initiative.publicId}`}>{initiative.name}</Link>
                  </Primary>
                  {initiative.objective && <Secondary>{initiative.objective.length > 140 ? `${initiative.objective.slice(0, 140)}…` : initiative.objective}</Secondary>}
                </Td>
                <Td label="Scope">{scope}</Td>
                <Td label="Standard Releases">
                  <TagList values={releases} />
                </Td>
                <Td label="Latest Assessment">
                  {latest ? (
                    <>
                      <Link href={`/assessments/${latest.assessment.publicId}`}>{`Assessment #${latest.number}`}</Link>
                      <Secondary>
                        <Status state={latest.assessment.state} size="sm" /> · <RelativeTime value={latest.assessment.createdAt} />
                      </Secondary>
                    </>
                  ) : (
                    <Secondary>Not assessed yet</Secondary>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title="No Initiatives yet" icon="layers" action={create}>
            An Initiative assesses all enabled Sources or a chosen subset, and can evaluate them against published Standard Releases.
          </EmptyState>
        )}
      </Panel>
    </Page>
  );
}
