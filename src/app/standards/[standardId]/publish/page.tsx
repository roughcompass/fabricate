import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { countLabel } from "@/components/ui/format";
import { Card, DetailsList, Page, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { getDb } from "@/lib/db/client";
import { previewPublication } from "@/lib/standards/publish";
import { draftDocument, findStandard, releasesOf } from "@/lib/standards/standard-records";
import { publishStandard } from "../../actions";
import { ControlList } from "../../control-view";

export const metadata: Metadata = { title: "Publish Standard" };

const NOTICES: Record<string, string> = {
  stale: "The draft changed after you opened this review. Check the draft version and Controls below again before publishing.",
  invalid: "The draft has problems, so it was not published.",
};

export default async function PublishPage({ params, searchParams }: { params: Promise<{ standardId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ standardId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const standard = findStandard(db, standardId);
  if (!standard) notFound();
  const preview = previewPublication(db, standard.publicId);
  if (!preview) redirect(`/standards/${standard.publicId}?notice=no_draft`);
  const document = draftDocument(preview.draft);
  const nextVersion = (releasesOf(db, standard.id)[0]?.version ?? 0) + 1;
  const notice = typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const schemas = document.input_schemas as { repository_profile?: number[]; relationship_map?: number[] } | undefined;

  return (
    <Page>
      <PageHeader title={`Publish ${standard.name} v${nextVersion}`} back={{ href: `/standards/${standard.publicId}`, label: standard.name }} description="Review exactly what will be published. A published Release can never be edited or deleted." />
      {notice && (
        <Notice tone="warning" live>
          {notice}
        </Notice>
      )}

      <Card title="Publication">
        <DetailsList
          items={[
            ["Release", `v${nextVersion}`],
            ["From draft version", preview.draft.lockVersion],
            ["Name and purpose", `${standard.name}: ${standard.purpose}`],
            ["Controls", preview.controls],
            ["Reads", `Repository Profile v${schemas?.repository_profile?.join(", v") || "none"}; Relationship Map v${schemas?.relationship_map?.join(", v") || "none"}`],
            ["Content digest", <code key="digest">{preview.digest}</code>],
          ]}
        />
        {preview.issues.length ? (
          <>
            <Notice tone="warning" title={`The draft has ${countLabel(preview.issues.length, "problem")}, so it cannot be published`}>
              <ul>
                {preview.issues.map((issue) => (
                  <li key={`${issue.field}:${issue.message}`}>{`${issue.field}: ${issue.message}`}</li>
                ))}
              </ul>
            </Notice>
            <ButtonLink href={`/standards/${standard.publicId}/draft`} icon="edit">
              Fix the draft
            </ButtonLink>
          </>
        ) : (
          <>
            <Notice tone="warning" title="Publishing is irreversible">
              {`Release v${nextVersion} will record draft version ${preview.draft.lockVersion} with the digest above. It cannot be edited or deleted afterward; later changes go into a new draft. The draft is consumed.`}
            </Notice>
            <ConfirmButton
              action={publishStandard.bind(null, standard.publicId)}
              fields={{ lockVersion: String(preview.draft.lockVersion) }}
              confirmation={`Publish ${standard.name} v${nextVersion} from draft version ${preview.draft.lockVersion}? A published Release can never be edited or deleted.`}
              variant="primary"
              icon="lock"
            >
              {`Publish v${nextVersion}`}
            </ConfirmButton>
          </>
        )}
      </Card>

      <Card title="Controls">
        <ControlList controls={document.controls ?? []} />
      </Card>
    </Page>
  );
}
