import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { oneOf, param } from "@/lib/web/query";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Status, statusLabel } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { TagList } from "@/components/ui/tag";
import { type Run, runNumber, listRuns } from "@/lib/runs/run-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { CONCLUSION_FILTERS, conclusionCounts, type ConclusionFilter, conclusionState, type LatestConclusion, latestConclusions } from "@/lib/evaluations/conclusions";
import { listAssessments, scopeLabel, selectedReleases, selectedSources } from "@/lib/assessments/assessment-records";
import { releaseLabel } from "@/lib/standards/standard-records";
import { assessmentsHref } from "@/lib/web/list-filters";
import { assessmentListOutcome } from "./outcomes";
import { routes } from "@/lib/web/routes";

// The layout's title template applies to child segments only, so the root page sets its full title.
export const metadata: Metadata = { title: "Assessments" };

export default async function AssessmentsPage({ searchParams }: PageProps<"/assessments">) {
  const query = await searchParams;
  const conclusion = oneOf(query, "conclusion", CONCLUSION_FILTERS) ?? null;
  const db = getDb();
  const sourceCount = listSources(db).length;
  // Each Assessment's latest completed Evaluation, in one query; Home counts the same conclusions.
  const conclusions = latestConclusions(db);
  const counts = conclusionCounts(conclusions);
  const all = listAssessments(db).map((assessment) => {
    const latest = listRuns(db, assessment.id)[0];
    return {
      assessment,
      scope: assessment.selectionMode === "all" ? `${scopeLabel(assessment, 0)} (${sourceCount})` : scopeLabel(assessment, selectedSources(db, assessment.id).length),
      releases: selectedReleases(db, assessment.id).map(({ release, standard }) => releaseLabel(standard, release)),
      latest: latest && { run: latest, number: runNumber(db, latest) },
    };
  });
  const rows = conclusion ? all.filter(({ assessment }) => conclusions.get(assessment.id)?.conclusion === conclusion) : all;
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
        alerts={<OutcomeToast outcome={assessmentListOutcome(param(query, "notice"))} />}
      />

      <Tabs label="Filter Assessments">
        <TabLink href={assessmentsHref()} active={conclusion === null} count={all.length}>
          All
        </TabLink>
        {CONCLUSION_FILTERS.filter((filter) => filter !== "not_applicable" || counts.not_applicable > 0 || conclusion === filter).map((filter) => (
          <TabLink key={filter} href={assessmentsHref({ conclusion: filter })} active={conclusion === filter} count={counts[filter]}>
            <Status state={conclusionState(filter)} size="sm" />
          </TabLink>
        ))}
      </Tabs>

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
                <Th>Conclusion</Th>
              </>
            }
          >
            {rows.map(({ assessment, scope, releases, latest }) => (
              <tr key={assessment.publicId}>
                <Td label="Assessment">
                  <Primary>
                    <Link href={routes.assessment(assessment.publicId)}>{assessment.name}</Link>
                  </Primary>
                  {assessment.objective && <Secondary>{assessment.objective.length > 140 ? `${assessment.objective.slice(0, 140)}…` : assessment.objective}</Secondary>}
                </Td>
                <Td label="Scope">{scope}</Td>
                <Td label="Standard Releases">
                  <TagList values={releases} />
                </Td>
                <Td label="Latest Run">
                  <LatestRun latest={latest} />
                </Td>
                <Td label="Conclusion">
                  <Conclusion latest={conclusions.get(assessment.id)} />
                </Td>
              </tr>
            ))}
          </Table>
        ) : conclusion ? (
          <EmptyState title="No matching Assessments">{conclusion === "none" ? "Every Assessment has a completed Evaluation." : `No Assessment's latest completed Evaluation concluded “${statusLabelOf(conclusion)}”.`}</EmptyState>
        ) : (
          <EmptyState title="No Assessments yet" icon="checklist" action={create}>
            An Assessment covers all Repositories or a chosen subset, and can evaluate them against published Standard Releases.
          </EmptyState>
        )}
      </Panel>

    </Page>
  );
}

function LatestRun({ latest }: { latest: { run: Run; number: number } | undefined }) {
  if (!latest) return <Secondary>Not assessed yet</Secondary>;
  return (
    <>
      <Link href={routes.run(latest.run.publicId)}>{`Run #${latest.number}`}</Link>
      <Secondary>
        <Status state={latest.run.state} size="sm" /> · <RelativeTime value={latest.run.createdAt} />
      </Secondary>
    </>
  );
}

/** The status registry's state for a conclusion filter: "none" reads Not evaluated. */
const statusLabelOf = (filter: ConclusionFilter) => statusLabel(conclusionState(filter));

/** The conclusion of an Assessment's latest completed Evaluation, linked to it, or Not evaluated. */
function Conclusion({ latest }: { latest: LatestConclusion | undefined }) {
  if (!latest?.evaluation) return <Secondary>Not evaluated</Secondary>;
  return (
    <>
      <Link href={routes.evaluation(latest.evaluation.publicId)}>{`Evaluation #${latest.evaluation.number}`}</Link>
      <Secondary>
        <Status state={conclusionState(latest.conclusion)} size="sm" />
      </Secondary>
    </>
  );
}
