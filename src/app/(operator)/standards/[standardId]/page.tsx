import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ActionButton, ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import { getDb } from "@/lib/db/client";
import { draftDocument, draftOf, findStandard, releaseDocument, releasesOf } from "@/lib/standards/standard-records";
import { validateStandard } from "@/lib/standards/validate";
import { reviseStandard } from "../actions";
import { standardOutcome } from "../outcomes";

const loadStandard = cache((publicId: string) => findStandard(getDb(), publicId));

export async function generateMetadata({ params }: { params: Promise<{ standardId: string }> }): Promise<Metadata> {
  const standard = loadStandard((await params).standardId);
  return { title: standard?.name ?? "Standard not found" };
}

/** "Profile v1 · Map v1": the result schemas a Release reads. */
function reads(profiles: string, maps: string): string {
  const versions = (json: string) => (JSON.parse(json) as number[]).map((version) => `v${version}`).join(", ") || "none";
  return `Profile ${versions(profiles)} · Relationship Map ${versions(maps)}`;
}

export default async function StandardPage({ params, searchParams }: { params: Promise<{ standardId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ standardId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const standard = loadStandard(standardId);
  if (!standard) notFound();
  const draft = draftOf(db, standard.id);
  const issues = draft ? validateStandard(draftDocument(draft), { metadata: standard }) : [];
  const controls = draft ? draftDocument(draft).controls : null;
  const releases = releasesOf(db, standard.id);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ href: "/standards", label: "Standards" }]}
        title={standard.name}
        description={standard.purpose}
        secondaryActions={[{ href: `/standards/${standard.publicId}/edit`, label: "Edit name and purpose", icon: "edit" }]}
        alerts={<OutcomeToast outcome={standardOutcome(param(query, "notice"), standard)} />}
      />

      <Section
        title="Draft"
        description="The editable version of this Standard; publishing it creates a new Release."
        actions={
          draft ? (
            <>
              <ButtonLink href={`/standards/${standard.publicId}/draft`} icon="edit">
                Edit draft
              </ButtonLink>
              <ButtonLink href={`/standards/${standard.publicId}/publish`} variant="primary" icon="lock">
                Review and publish
              </ButtonLink>
            </>
          ) : undefined
        }
      >
        {draft ? (
          <DescriptionList
            layout="columns"
            items={[
              ["Status", issues.length ? <Status key="status" state="draft_problems" label={`${countLabel(issues.length, "problem")} to fix`} /> : <Status key="status" state="draft_ready" />],
              ["Controls", Array.isArray(controls) ? controls.length : 0],
              ["Last saved", <RelativeTime key="saved" value={draft.updatedAt} />],
            ]}
          />
        ) : (
          <Panel flush>
            <EmptyState
              title="There is no draft"
              action={
                releases[0] && (
                  <ActionButton action={reviseStandard.bind(null, standard.publicId, releases[0].publicId)} variant="primary" icon="edit">
                    {`Start a draft from v${releases[0].version}`}
                  </ActionButton>
                )
              }
            >
              To change this Standard, start a draft from a Release. The Release itself stays as it was published.
            </EmptyState>
          </Panel>
        )}
      </Section>

      <Section title="Release history" description="Every published Release, newest first; Assessments select Releases to evaluate against.">
        <Panel flush>
          {releases.length ? (
            <Table
              label="Releases"
              head={
                <>
                  <Th>Release</Th>
                  <Th>Published</Th>
                  <Th align="numeric">Controls</Th>
                  <Th>Digest</Th>
                </>
              }
            >
              {releases.map((release) => {
                const document = releaseDocument(release);
                return (
                  <tr key={release.publicId}>
                    <Td label="Release">
                      <Primary>
                        <Link href={`/standards/${standard.publicId}/releases/${release.publicId}`}>{`v${release.version}`}</Link>
                      </Primary>
                      <Secondary>{`Reads ${reads(release.profileSchemaVersions, release.relationshipSchemaVersions)}`}</Secondary>
                    </Td>
                    <Td label="Published">
                      <RelativeTime value={release.publishedAt} />
                    </Td>
                    <Td label="Controls" align="numeric">
                      {Array.isArray(document.controls) ? document.controls.length : 0}
                    </Td>
                    <Td label="Digest">
                      <ShortValue value={release.digest} label="digest" />
                    </Td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <EmptyState title="Not published yet">Publish the draft to create the first Release.</EmptyState>
          )}
        </Panel>
      </Section>

      <Disclosure summary="Details" variant="plain">
        <DescriptionList surface
          items={[
            ["ID", <Tag key="id" copy label="ID">{standard.publicId}</Tag>],
            ["Created", <RelativeTime key="created" value={standard.createdAt} />],
            ...(draft ? ([["Draft version", draft.lockVersion]] as [string, React.ReactNode][]) : []),
          ]}
        />
      </Disclosure>
    </Page>
  );
}
