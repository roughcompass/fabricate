import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { getDb } from "@/lib/db/client";
import { draftDocument, draftOf, listStandards, releasesOf } from "@/lib/standards/standard-records";
import { validateStandard } from "@/lib/standards/validate";
import { routes } from "@/lib/web/routes";

export const metadata: Metadata = { title: "Standards" };

export default function StandardsPage() {
  const db = getDb();
  const rows = listStandards(db).map((standard) => {
    const draft = draftOf(db, standard.id);
    return { standard, draft, problems: draft ? validateStandard(draftDocument(draft), { metadata: standard }).length : 0, releases: releasesOf(db, standard.id) };
  });
  const create = (
    <ButtonLink href="/standards/new" variant="primary" icon="plus">
      New Standard
    </ButtonLink>
  );

  return (
    <Page>
      <PageHeader title="Standards" description="Desired engineering state, written as Controls that Evaluations check. Drafts are editable; publishing a draft creates a Release." primaryAction={create} />

      <Panel flush>
        {rows.length ? (
          <Table
            label="Standard Library"
            head={
              <>
                <Th>Standard</Th>
                <Th>Draft</Th>
                <Th>Latest Release</Th>
                <Th align="numeric">Releases</Th>
              </>
            }
          >
            {rows.map(({ standard, draft, problems, releases }) => (
              <tr key={standard.publicId}>
                <Td label="Standard">
                  <Primary>
                    <Link href={routes.standard(standard.publicId)}>{standard.name}</Link>
                  </Primary>
                  <Secondary>{standard.purpose}</Secondary>
                </Td>
                <Td label="Draft">
                  {!draft ? <Status state="no_draft" /> : problems ? <Status state="draft_problems" label={countLabel(problems, "problem")} /> : <Status state="draft_ready" />}
                </Td>
                <Td label="Latest Release">
                  {releases[0] ? (
                    <>
                      {`v${releases[0].version}`}
                      <Secondary>
                        Published <RelativeTime value={releases[0].publishedAt} />
                      </Secondary>
                    </>
                  ) : (
                    <Secondary>Not published</Secondary>
                  )}
                </Td>
                <Td label="Releases" align="numeric">
                  {releases.length}
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title="No Standards yet" icon="file" action={create}>
            A Standard describes the desired state that Evaluations compare Assessments with.
          </EmptyState>
        )}
      </Panel>
    </Page>
  );
}
