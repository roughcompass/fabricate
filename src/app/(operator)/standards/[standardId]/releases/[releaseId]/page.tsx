import type { Metadata } from "next";
import { DetailsTemplate } from "@/components/templates/details-template";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Tag } from "@/components/ui/tag";
import { getDb } from "@/lib/db/client";
import { DOCUMENT_SCHEMAS } from "@/lib/documents/schemas";
import { draftOf, releaseDocument } from "@/lib/standards/standard-records";
import { reviseStandard } from "../../../actions";
import { ControlList } from "../../../control-view";
import { releaseOutcome } from "../../../outcomes";
import { routes } from "@/lib/web/routes";
import { loadRelease } from "../../load";

export async function generateMetadata({ params }: PageProps<"/standards/[standardId]/releases/[releaseId]">): Promise<Metadata> {
  const { standardId, releaseId } = await params;
  const found = loadRelease(standardId, releaseId);
  return { title: found ? `${found.standard.name} v${found.release.version}` : "Release not found" };
}

export default async function ReleasePage({ params, searchParams }: PageProps<"/standards/[standardId]/releases/[releaseId]">) {
  const [{ standardId, releaseId }, query] = await Promise.all([params, searchParams]);
  const found = loadRelease(standardId, releaseId);
  if (!found) notFound();
  const { standard, release } = found;
  const document = releaseDocument(release);
  const controls = document.controls ?? [];
  const published = document.standard as { name?: string; purpose?: string } | undefined;
  const hasDraft = Boolean(draftOf(getDb(), standard.id));
  const versions = (list: readonly number[]) => list.map((version) => `v${version}`).join(", ") || "none";

  return (
    <DetailsTemplate
      header={{
        breadcrumbs: [
          { href: "/standards", label: "Standards" },
          { href: routes.standard(standard.publicId), label: standard.name },
        ],
        title: `${published?.name ?? standard.name} v${release.version}`,
        status: <Status state="published" />,
        description: published?.purpose,
        extraActions: hasDraft ? undefined : (
          <ActionButton action={reviseStandard.bind(null, standard.publicId, release.publicId)} icon="edit">
            Start a draft from this Release
          </ActionButton>
        ),
      }}
      alerts={<OutcomeToast outcome={releaseOutcome(param(query, "notice"), release)} />}
    >

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
            ["Format", <code key="format">{`${DOCUMENT_SCHEMAS.standard.name} v${release.documentSchemaVersion}`}</code>],
            ["ID", <Tag key="id" copy label="ID">{release.publicId}</Tag>],
          ]}
        />
      </Disclosure>
    </DetailsTemplate>
  );
}
