import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/format";
import { Card, DetailsList, Page, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { getDb } from "@/lib/db/client";
import { draftOf, findRelease, findStandard, releaseDocument } from "@/lib/standards/standard-records";
import { reviseStandard } from "../../../actions";
import { ControlList } from "../../../control-view";

export const metadata: Metadata = { title: "Standard Release" };

export default async function ReleasePage({ params, searchParams }: { params: Promise<{ standardId: string; releaseId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ standardId, releaseId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const standard = findStandard(db, standardId);
  const release = findRelease(db, releaseId);
  if (!standard || !release || release.standardId !== standard.id) notFound();
  const document = releaseDocument(release);
  const published = document.standard as { name?: string; purpose?: string } | undefined;
  const hasDraft = Boolean(draftOf(db, standard.id));

  return (
    <Page>
      <PageHeader
        title={`${published?.name ?? standard.name} v${release.version}`}
        back={{ href: `/standards/${standard.publicId}`, label: standard.name }}
        badge={<StatusBadge state="published" />}
        description={published?.purpose}
        actions={
          hasDraft ? undefined : (
            <ActionButton action={reviseStandard.bind(null, standard.publicId, release.publicId)} icon="edit">
              Start a new draft from this Release
            </ActionButton>
          )
        }
      />
      {query.notice === "published" && (
        <Notice tone="success" live>
          {`Release v${release.version} was published. It is now immutable and can be selected by Initiatives.`}
        </Notice>
      )}

      <Card title="Release">
        <DetailsList
          items={[
            ["Published", <Timestamp key="published" value={release.publishedAt} />],
            ["From draft version", release.draftLockVersion],
            ["Document schema", `fabricate.standard v${release.documentSchemaVersion}`],
            ["Reads", `Repository Profile v${JSON.parse(release.profileSchemaVersions).join(", v") || "none"}; Relationship Map v${JSON.parse(release.relationshipSchemaVersions).join(", v") || "none"}`],
            ["Content digest", <code key="digest">{release.digest}</code>],
          ]}
        />
      </Card>

      <Card title="Controls" description="The complete, immutable definition of every Control in this Release.">
        <ControlList controls={document.controls ?? []} />
      </Card>
    </Page>
  );
}
