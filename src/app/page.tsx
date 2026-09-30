import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/format";
import { Card, ChipList, Cluster, EmptyState, Page, PageHeader, ui } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Mono, Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { listAssessments } from "@/lib/assessments/assessment-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { listInitiatives, scopeLabel, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { releaseLabel } from "@/lib/standards/standard-records";

// The layout's title template applies to child segments only, so the root page sets its full title.
export const metadata: Metadata = { title: { absolute: "Initiatives · Fabricate" } };

export default async function InitiativesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const db = getDb();
  const enabledCount = listSources(db, { enabled: true }).length;
  const rows = listInitiatives(db).map((initiative) => ({
    initiative,
    sourceCount: selectedSources(db, initiative.id).length,
    releases: selectedReleases(db, initiative.id).map(({ release, standard }) => releaseLabel(standard, release)),
    latest: listAssessments(db, initiative.id)[0],
  }));

  return (
    <Page>
      <PageHeader
        title="Initiatives"
        description="Long-lived objectives. Each one scopes repositories for current-state Assessments and selects Standard Releases for diagnostic Evaluations."
        actions={
          <ButtonLink href="/initiatives/new" variant="primary" icon="plus">
            New initiative
          </ButtonLink>
        }
      />

      {params.notice === "deleted" && (
        <Notice tone="success" live>
          The initiative was deleted.
        </Notice>
      )}

      {rows.length > 0 ? (
        <Card flush>
          <Table
            label="Initiatives"
            head={
              <>
                <Th>Initiative</Th>
                <Th>Scope</Th>
                <Th>Standard Releases</Th>
                <Th>Latest assessment</Th>
              </>
            }
          >
            {rows.map(({ initiative, sourceCount, releases, latest }) => (
              <tr key={initiative.publicId}>
                <Td label="Initiative">
                  <Primary>
                    <Link href={`/initiatives/${initiative.publicId}`}>{initiative.name}</Link>
                  </Primary>
                  {initiative.objective && <Secondary>{initiative.objective.length > 140 ? `${initiative.objective.slice(0, 140)}…` : initiative.objective}</Secondary>}
                </Td>
                <Td label="Scope">{initiative.selectionMode === "all_enabled" ? `All enabled (${enabledCount})` : scopeLabel(initiative, sourceCount)}</Td>
                <Td label="Standard Releases">{releases.length ? <ChipList values={releases} /> : <span className={ui.muted}>None</span>}</Td>
                <Td label="Latest assessment">
                  {latest ? (
                    <>
                      <Cluster>
                        <Link href={`/assessments/${latest.publicId}`}>
                          <Mono>{latest.publicId}</Mono>
                        </Link>
                        <StatusBadge state={latest.state} />
                      </Cluster>
                      <Secondary>
                        <Timestamp value={latest.createdAt} />
                      </Secondary>
                    </>
                  ) : (
                    <span className={ui.muted}>Not assessed</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : (
        <EmptyState
          title="No initiatives yet"
          actions={
            <ButtonLink href="/initiatives/new" variant="primary" icon="plus">
              New initiative
            </ButtonLink>
          }
        >
          Create an initiative to assess all enabled sources or an explicit subset. Standard Releases are optional.
        </EmptyState>
      )}
    </Page>
  );
}
