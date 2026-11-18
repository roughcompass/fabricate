import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status, statusLabel } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { TagList } from "@/components/ui/tag";
import { type Assessment, assessmentNumber, listAssessments } from "@/lib/assessments/assessment-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { CONCLUSION_FILTERS, type ConclusionFilter, type LatestConclusion, conclusionCounts, isConclusionFilter, latestConclusions } from "@/lib/evaluations/conclusions";
import { listInitiatives, saltPatternsInitiative, scopeLabel, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { releaseLabel } from "@/lib/standards/standard-records";
import { assessmentsHref } from "@/lib/web/list-filters";
import { initiativeListOutcome } from "./outcomes";

// The layout's title template applies to child segments only, so the root page sets its full title.
export const metadata: Metadata = { title: "Assessments" };

export default async function InitiativesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const conclusion = isConclusionFilter(param(query, "conclusion")) ? (param(query, "conclusion") as ConclusionFilter) : null;
  const db = getDb();
  const sourceCount = listSources(db).length;
  // Each Assessment's latest completed Evaluation, in one query; Home counts the same conclusions.
  const conclusions = latestConclusions(db);
  const counts = conclusionCounts(conclusions);
  const all = listInitiatives(db).map((initiative) => {
    const latest = listAssessments(db, initiative.id)[0];
    return {
      initiative,
      scope: initiative.selectionMode === "all" ? `${scopeLabel(initiative, 0)} (${sourceCount})` : scopeLabel(initiative, selectedSources(db, initiative.id).length),
      releases: selectedReleases(db, initiative.id).map(({ release, standard }) => releaseLabel(standard, release)),
      latest: latest && { assessment: latest, number: assessmentNumber(db, latest) },
    };
  });
  const rows = conclusion ? all.filter(({ initiative }) => conclusions.get(initiative.id)?.conclusion === conclusion) : all;
  // A conclusion tab filters the operator's Assessments only, so Assessments created for claims stay out of view while one is active.
  const claims = conclusion ? [] : listInitiatives(db, { systemOwned: true }).map((initiative) => {
    const latest = listAssessments(db, initiative.id)[0];
    return { initiative, repository: selectedSources(db, initiative.id)[0], latest: latest && { assessment: latest, number: assessmentNumber(db, latest) } };
  });
  // Salt Patterns: DE FabLab's own Assessment of template versions, kept apart like claims.
  const owned = conclusion ? null : (() => {
    const initiative = saltPatternsInitiative(db);
    const latest = listAssessments(db, initiative.id)[0];
    return { initiative, releases: selectedReleases(db, initiative.id).map(({ release, standard }) => releaseLabel(standard, release)), latest: latest && { assessment: latest, number: assessmentNumber(db, latest) } };
  })();
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
                <Td label="Conclusion">
                  <Conclusion latest={conclusions.get(initiative.id)} />
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

      {owned && (
        <Section title="Owned by DE FabLab" description="Holds template versions to the Releases selected on it when they're accepted or re-checked.">
          <Panel flush>
            <Table
              label="Assessments owned by DE FabLab"
              head={
                <>
                  <Th>Assessment</Th>
                  <Th>Standard Releases</Th>
                  <Th>Latest Run</Th>
                </>
              }
            >
              <tr>
                <Td label="Assessment">
                  <Primary>
                    <Link href={`/assessments/${owned.initiative.publicId}`}>{owned.initiative.name}</Link>
                  </Primary>
                  <Secondary>Template versions</Secondary>
                </Td>
                <Td label="Standard Releases">{owned.releases.length ? <TagList values={owned.releases} /> : <Secondary>None selected</Secondary>}</Td>
                <Td label="Latest Run">
                  <LatestRun latest={owned.latest} />
                </Td>
              </tr>
            </Table>
          </Panel>
        </Section>
      )}

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

/** The status registry's state for a conclusion filter: "none" reads Not evaluated. */
const conclusionState = (filter: ConclusionFilter) => (filter === "none" ? "not_evaluated" : filter);
const statusLabelOf = (filter: ConclusionFilter) => statusLabel(conclusionState(filter));

/** The conclusion of an Assessment's latest completed Evaluation, linked to it, or Not evaluated. */
function Conclusion({ latest }: { latest: LatestConclusion | undefined }) {
  if (!latest?.evaluation) return <Secondary>Not evaluated</Secondary>;
  return (
    <>
      <Link href={`/evaluations/${latest.evaluation.publicId}`}>{`Evaluation #${latest.evaluation.number}`}</Link>
      <Secondary>
        <Status state={conclusionState(latest.conclusion)} size="sm" />
      </Secondary>
    </>
  );
}
