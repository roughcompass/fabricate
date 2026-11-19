import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FormTemplate } from "@/components/templates/form-template";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { countLabel } from "@/components/ui/count";
import { DescriptionList } from "@/components/ui/description-list";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Tag } from "@/components/ui/tag";
import { getDb } from "@/lib/db/client";
import { issueLocation } from "@/lib/standards/issue-location";
import { previewPublication } from "@/lib/standards/publish";
import { draftDocument, releasesOf } from "@/lib/standards/standard-records";
import { publishStandard } from "../../actions";
import { ControlList } from "../../control-view";
import { publishOutcome } from "../../outcomes";
import { routes } from "@/lib/web/routes";
import { loadStandard } from "../load";

export async function generateMetadata({ params }: PageProps<"/standards/[standardId]/publish">): Promise<Metadata> {
  const standard = loadStandard((await params).standardId);
  if (!standard) return { title: "Standard not found" };
  // The browser title begins with the page's, which names the Release it publishes.
  return { title: `Publish ${standard.name} v${(releasesOf(getDb(), standard.id)[0]?.version ?? 0) + 1}` };
}

export default async function PublishPage({ params, searchParams }: PageProps<"/standards/[standardId]/publish">) {
  const [{ standardId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const standard = loadStandard(standardId);
  if (!standard) notFound();
  const preview = previewPublication(db, standard.publicId);
  if (!preview) redirect(routes.standard(standard.publicId, { notice: "no_draft" }));
  const document = draftDocument(preview.draft);
  const controls = Array.isArray(document.controls) ? (document.controls as { key?: unknown }[]) : [];
  const nextVersion = (releasesOf(db, standard.id)[0]?.version ?? 0) + 1;
  const schemas = document.input_schemas as { repository_profile?: number[]; relationship_map?: number[] } | undefined;
  const versions = (list: number[] | undefined) => list?.map((version) => `v${version}`).join(", ") || "none";

  const publish = preview.issues.length ? undefined : (
    <ConfirmDialog
      action={publishStandard.bind(null, standard.publicId)}
      fields={{ lockVersion: String(preview.draft.lockVersion) }}
      trigger={{ label: `Publish v${nextVersion}`, icon: "lock", variant: "primary" }}
      title={`Publish ${standard.name} v${nextVersion}?`}
      confirmLabel={`Publish v${nextVersion}`}
    >
      <p>{`Release v${nextVersion} will be published from draft version ${preview.draft.lockVersion}.`}</p>
      <p>A published Release can never be edited or deleted. Later changes go into a new draft.</p>
    </ConfirmDialog>
  );

  return (
    <FormTemplate
      header={{
        breadcrumbs: [
          { href: "/standards", label: "Standards" },
          { href: routes.standard(standard.publicId), label: standard.name },
        ],
        title: `Publish ${standard.name} v${nextVersion}`,
        description: "Review exactly what will be published.",
      }}
      width="content"
      footer={
        <>
          <ButtonLink href={routes.standard(standard.publicId)}>Cancel</ButtonLink>
          {publish}
        </>
      }
      alerts={
        <>
          <OutcomeToast outcome={publishOutcome(param(query, "notice"), standard)} />
          {preview.issues.length > 0 && (
            <Alert
              tone="warning"
              title={`The draft has ${countLabel(preview.issues.length, "problem")}, so it cannot be published`}
              actions={
                <ButtonLink href={routes.standardDraft(standard.publicId)} icon="edit" size="sm">
                  Fix the draft
                </ButtonLink>
              }
            >
              <ul>
                {preview.issues.map((issue) => (
                  <li key={`${issue.field}:${issue.message}`}>
                    <strong>{issueLocation(issue.field, controls)}</strong>
                    {`: ${issue.message}`}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </>
      }
    >
      <Section title="Publication">
        <DescriptionList surface
          items={[
            ["Release", `v${nextVersion}`],
            ["From draft version", preview.draft.lockVersion],
            ["Name", standard.name],
            ["Purpose", standard.purpose],
            ["Controls", preview.controls],
            ["Reads", `Repository Profile ${versions(schemas?.repository_profile)} · Relationship Map ${versions(schemas?.relationship_map)}`],
            ["Content digest", <Tag key="digest" copy label="digest">{preview.digest}</Tag>],
          ]}
        />
      </Section>

      <Section title="Controls" description="Every Control exactly as it will be published.">
        <Panel flush>
          <ControlList controls={document.controls ?? []} />
        </Panel>
      </Section>
    </FormTemplate>
  );
}
