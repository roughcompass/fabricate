import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/badge";
import { ActionButton, ButtonLink } from "@/components/ui/button";
import { Timestamp, countLabel } from "@/components/ui/format";
import { Card, DetailsList, EmptyState, Page, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Mono, Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { getDb } from "@/lib/db/client";
import { draftDocument, draftOf, findStandard, releaseDocument, releasesOf } from "@/lib/standards/standard-records";
import { validateStandard } from "@/lib/standards/validate";
import { reviseStandard } from "../actions";

export const metadata: Metadata = { title: "Standard" };

const NOTICES: Record<string, [tone: "success" | "warning" | "info", message: string]> = {
  updated: ["success", "The Standard's name and purpose were updated. Published Releases keep the name and purpose they were published with."],
  draft_exists: ["warning", "This Standard already has a draft. Edit or publish it before starting another revision."],
  no_draft: ["info", "This Standard has no draft; it may have just been published."],
};

export default async function StandardPage({ params, searchParams }: { params: Promise<{ standardId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ standardId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const standard = findStandard(db, standardId);
  if (!standard) notFound();
  const draft = draftOf(db, standard.id);
  const issues = draft ? validateStandard(draftDocument(draft), { metadata: standard }) : [];
  const controls = draft ? draftDocument(draft).controls : null;
  const releases = releasesOf(db, standard.id);
  const notice = typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  return (
    <Page>
      <PageHeader
        title={standard.name}
        back={{ href: "/standards", label: "Standards" }}
        description={standard.purpose}
        actions={
          <ButtonLink href={`/standards/${standard.publicId}/edit`} icon="edit">
            Edit name and purpose
          </ButtonLink>
        }
      />

      {notice && (
        <Notice tone={notice[0]} live>
          {notice[1]}
        </Notice>
      )}

      <Card
        title="Draft"
        description="The editable version of this Standard. Publishing it creates a new immutable Release."
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
          <DetailsList
            items={[
              ["Status", <StatusBadge key="status" state="draft" />],
              ["Controls", Array.isArray(controls) ? controls.length : 0],
              ["Validation", issues.length ? `${countLabel(issues.length, "problem")} to fix before publication` : "Valid and ready to publish"],
              ["Draft version", draft.lockVersion],
              ["Last saved", <Timestamp key="saved" value={draft.updatedAt} />],
            ]}
          />
        ) : releases[0] ? (
          <p>
            There is no draft. To change this Standard, start a new draft from a Release; the Release itself never changes.{" "}
          </p>
        ) : (
          <p>There is no draft.</p>
        )}
        {!draft && releases[0] && <ActionButton action={reviseStandard.bind(null, standard.publicId, releases[0].publicId)} icon="edit">{`Start a draft from v${releases[0].version}`}</ActionButton>}
      </Card>

      <Card title="Release history" description="Every published Release, newest first. Releases are immutable and can be selected by Initiatives." flush={releases.length > 0}>
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
                    <Secondary>{`Reads Profile v${JSON.parse(release.profileSchemaVersions).join(", v") || "none"} · Map v${JSON.parse(release.relationshipSchemaVersions).join(", v") || "none"}`}</Secondary>
                  </Td>
                  <Td label="Published">
                    <Timestamp value={release.publishedAt} />
                  </Td>
                  <Td label="Controls" align="numeric">
                    {Array.isArray(document.controls) ? document.controls.length : 0}
                  </Td>
                  <Td label="Digest">
                    <Mono>{release.digest.slice(0, 12)}</Mono>
                  </Td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState title="Not published yet">Publish the draft to create the first Release.</EmptyState>
        )}
      </Card>
    </Page>
  );
}
