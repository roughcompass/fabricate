import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Timestamp, countLabel } from "@/components/ui/format";
import { Card, EmptyState, Page, PageHeader } from "@/components/ui/layout";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { getDb } from "@/lib/db/client";
import { draftDocument, draftOf, listStandards, releasesOf } from "@/lib/standards/standard-records";
import { validateStandard } from "@/lib/standards/validate";

export const metadata: Metadata = { title: "Standards" };

export default function StandardsPage() {
  const db = getDb();
  const rows = listStandards(db).map((standard) => {
    const draft = draftOf(db, standard.id);
    return { standard, draft, problems: draft ? validateStandard(draftDocument(draft), { metadata: standard }).length : 0, releases: releasesOf(db, standard.id) };
  });

  return (
    <Page>
      <PageHeader
        title="Standards"
        description="Desired engineering state as machine-evaluable Controls. Drafts are editable; published Releases never change."
        actions={
          <ButtonLink href="/standards/new" variant="primary" icon="plus">
            New Standard
          </ButtonLink>
        }
      />

      {rows.length ? (
        <Card flush>
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
                    <Link href={`/standards/${standard.publicId}`}>{standard.name}</Link>
                  </Primary>
                  <Secondary>{standard.purpose}</Secondary>
                </Td>
                <Td label="Draft">
                  {draft ? (
                    <>
                      <StatusBadge state="draft" />
                      <Secondary>{problems ? countLabel(problems, "problem") : "Ready to publish"}</Secondary>
                    </>
                  ) : (
                    <Secondary>No draft</Secondary>
                  )}
                </Td>
                <Td label="Latest Release">
                  {releases[0] ? (
                    <>
                      <StatusBadge state="published" label={`v${releases[0].version}`} />
                      <Secondary>
                        <Timestamp value={releases[0].publishedAt} />
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
        </Card>
      ) : (
        <EmptyState
          title="No Standards yet"
          actions={
            <ButtonLink href="/standards/new" variant="primary" icon="plus">
              New Standard
            </ButtonLink>
          }
        >
          Create a Standard to describe the desired state you want to compare Assessments with.
        </EmptyState>
      )}
    </Page>
  );
}
