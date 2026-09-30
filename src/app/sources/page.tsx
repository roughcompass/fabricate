import type { Metadata } from "next";
import { StatusBadge } from "@/components/ui/badge";
import { ActionButton, ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/format";
import { Card, Cluster, EmptyState, Page, PageHeader, TabLink, Tabs, ui } from "@/components/ui/layout";
import { Mono, Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { assessmentCounts } from "@/lib/catalog/catalog";
import { listSources, sourceReferenceLabel } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { setSourceEnabled } from "./actions";
import { ImportNotice, SourceNotice } from "./notices";

export const metadata: Metadata = { title: "Sources" };

const FILTERS = { enabled: true, disabled: false } as const;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function SourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const status = typeof params.status === "string" && params.status in FILTERS ? (params.status as keyof typeof FILTERS) : null;
  const db = getDb();
  const all = listSources(db);
  const sources = status ? all.filter((source) => source.enabled === FILTERS[status]) : all;
  const counts = assessmentCounts(db);
  const enabledCount = all.filter((source) => source.enabled).length;

  return (
    <Page>
      <PageHeader
        title="Sources"
        description="Clonable Git repositories available to initiatives. Edits and disabling apply only to assessments started afterward."
        actions={
          <>
            <ButtonLink href="/sources/import" icon="folder">
              Import directory
            </ButtonLink>
            <ButtonLink href="/sources/new" variant="primary" icon="plus">
              Add source
            </ButtonLink>
          </>
        }
      />

      <SourceNotice db={db} code={single(params.notice)} sourcePublicId={single(params.source)} />
      <ImportNotice code={single(params.notice)} count={single(params.count)} failed={single(params.failed)} />

      <Tabs label="Filter sources">
        <TabLink href="/sources" active={status === null}>
          All {all.length}
        </TabLink>
        <TabLink href="/sources?status=enabled" active={status === "enabled"}>
          Enabled {enabledCount}
        </TabLink>
        <TabLink href="/sources?status=disabled" active={status === "disabled"}>
          Disabled {all.length - enabledCount}
        </TabLink>
      </Tabs>

      {sources.length > 0 ? (
        <Card flush>
          <Table
            label="Repository sources"
            head={
              <>
                <Th>Name</Th>
                <Th>Clone URL</Th>
                <Th>Reference</Th>
                <Th>Status</Th>
                <Th align="numeric">Assessments</Th>
                <Th align="actions" hidden>
                  Actions
                </Th>
              </>
            }
          >
            {sources.map((source) => (
              <tr key={source.publicId} id={source.publicId}>
                <Td label="Name">
                  <Primary>{source.name}</Primary>
                  <Secondary mono>{source.publicId}</Secondary>
                </Td>
                <Td label="Clone URL">
                  <Mono>{source.cloneUrl}</Mono>
                </Td>
                <Td label="Reference">
                  {source.gitRef ? <Mono>{source.gitRef}</Mono> : <span className={ui.muted}>{sourceReferenceLabel(source)}</span>}
                </Td>
                <Td label="Status">
                  <StatusBadge state={source.enabled ? "enabled" : "disabled"} />
                </Td>
                <Td label="Assessments" align="numeric">
                  {countLabel(counts.get(source.id) ?? 0, "assessment")}
                </Td>
                <Td align="actions">
                  <Cluster>
                    <ButtonLink href={`/sources/${source.publicId}/edit`} variant="ghost" aria-label={`Edit ${source.name}`}>
                      Edit
                    </ButtonLink>
                    <ActionButton
                      action={setSourceEnabled}
                      fields={{ publicId: source.publicId, enabled: String(!source.enabled) }}
                      variant="ghost"
                      aria-label={`${source.enabled ? "Disable" : "Enable"} ${source.name}`}
                    >
                      {source.enabled ? "Disable" : "Enable"}
                    </ActionButton>
                  </Cluster>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : (
        <EmptyState
          title={status ? `No ${status} sources` : "No sources yet"}
          actions={
            <>
              <ButtonLink href="/sources/import" icon="folder">
                Import directory
              </ButtonLink>
              <ButtonLink href="/sources/new" variant="primary" icon="plus">
                Add source
              </ButtonLink>
            </>
          }
        >
          Register file://, https://, or ssh:// Git repositories, or import the Git working trees inside an allowed local directory.
        </EmptyState>
      )}
    </Page>
  );
}
