import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ActionButton } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Tag } from "@/components/ui/tag";
import { getDb } from "@/lib/db/client";
import { draftOf, findRelease, findStandard, releaseDocument } from "@/lib/standards/standard-records";
import { reviseStandard } from "../../../actions";
import { ControlList } from "../../../control-view";
import { releaseOutcome } from "../../../outcomes";

const load = cache((standardId: string, releaseId: string) => {
  const db = getDb();
  const standard = findStandard(db, standardId);
  const release = findRelease(db, releaseId);
  return standard && release && release.standardId === standard.id ? { standard, release } : undefined;
});

export async function generateMetadata({ params }: { params: Promise<{ standardId: string; releaseId: string }> }): Promise<Metadata> {
  const { standardId, releaseId } = await params;
  const found = load(standardId, releaseId);
  return { title: found ? `${found.standard.name} v${found.release.version}` : "Release not found" };
}

export default async function ReleasePage({ params, searchParams }: { params: Promise<{ standardId: string; releaseId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ standardId, releaseId }, query] = await Promise.all([params, searchParams]);
  const found = load(standardId, releaseId);
  if (!found) notFound();
  const { standard, release } = found;
  const document = releaseDocument(release);
  const controls = document.controls ?? [];
  const published = document.standard as { name?: string; purpose?: string } | undefined;
  const hasDraft = Boolean(draftOf(getDb(), standard.id));
  const versions = (json: string) => (JSON.parse(json) as number[]).map((version) => `v${version}`).join(", ") || "none";

  return (
    <Page>
      <PageHeader
        breadcrumbs={[
          { href: "/standards", label: "Standards" },
          { href: `/standards/${standard.publicId}`, label: standard.name },
        ]}
        title={`${published?.name ?? standard.name} v${release.version}`}
        status={<Status state="published" />}
        description={published?.purpose}
        extraActions={
          hasDraft ? undefined : (
            <ActionButton action={reviseStandard.bind(null, standard.publicId, release.publicId)} icon="edit">
              Start a draft from this Release
            </ActionButton>
          )
        }
        alerts={<OutcomeToast outcome={releaseOutcome(param(query, "notice"), release)} />}
      />

      <Section title="Release">
        <DescriptionList surface
          items={[
            ["Published", <RelativeTime key="published" value={release.publishedAt} />],
            ["Controls", Array.isArray(controls) ? controls.length : 0],
            ["Reads", `Repository Profile ${versions(release.profileSchemaVersions)} · Relationship Map ${versions(release.relationshipSchemaVersions)}`],
          ]}
        />
      </Section>

      <Section title="Controls" description="The complete definition of every Control in this Release.">
        <Panel flush>
          <ControlList controls={controls} />
        </Panel>
      </Section>

      <Disclosure summary="Details" variant="plain">
        <DescriptionList surface
          items={[
            ["Content digest", <Tag key="digest" copy label="digest">{release.digest}</Tag>],
            ["From draft version", release.draftLockVersion],
            ["Document schema", `fabricate.standard v${release.documentSchemaVersion}`],
            ["ID", <Tag key="id" copy label="ID">{release.publicId}</Tag>],
          ]}
        />
      </Disclosure>
    </Page>
  );
}
