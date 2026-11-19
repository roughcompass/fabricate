import type { Metadata } from "next";
import { EditorTemplate } from "@/components/templates/editor-template";
import { notFound, redirect } from "next/navigation";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
import { getDb } from "@/lib/db/client";
import { draftDocument, draftOf, releasesOf } from "@/lib/standards/standard-records";
import { validateStandard } from "@/lib/standards/validate";
import { saveDraft } from "../../actions";
import { editorVocabulary } from "../../vocabulary";
import { draftOutcome } from "../../outcomes";
import type { Json } from "./expression-editor";
import { DraftStatus } from "./draft-status";
import { StandardEditor } from "./standard-editor";
import { routes } from "@/lib/web/routes";
import { loadStandard } from "../load";

export async function generateMetadata({ params }: PageProps<"/standards/[standardId]/draft">): Promise<Metadata> {
  const standard = loadStandard((await params).standardId);
  return { title: standard ? `${standard.name} draft` : "Standard not found" };
}

export default async function DraftPage({ params, searchParams }: PageProps<"/standards/[standardId]/draft">) {
  const [{ standardId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const standard = loadStandard(standardId);
  if (!standard) notFound();
  const draft = draftOf(db, standard.id);
  if (!draft) redirect(routes.standard(standard.publicId, { notice: "no_draft" }));
  const document = draftDocument(draft);
  const issues = validateStandard(document, { metadata: standard });
  const published = releasesOf(db, standard.id)[0];

  return (
    <EditorTemplate
      header={{
        breadcrumbs: [
          { href: "/standards", label: "Standards" },
          { href: routes.standard(standard.publicId), label: standard.name },
        ],
        title: `${standard.name} draft`,
        status: <DraftStatus standard={standard.publicId} issues={issues.length} />,
        secondaryActions: published ? [{ href: routes.release(standard.publicId, published.publicId), label: `View v${published.version}`, icon: "eye" }] : [],
        description: "Build each Control from fields and operators; Controls are data, and nothing here runs as code.",
      }}
      alerts={<OutcomeToast outcome={draftOutcome(param(query, "notice"), standard)} />}
    >
      <StandardEditor
        standard={standard.publicId}
        action={saveDraft.bind(null, standard.publicId)}
        initial={{ lockVersion: draft.lockVersion, issues, status: "unsaved", message: null, submission: 0 }}
        // A plain copy: the parsed draft has null-prototype objects, which cannot cross to a client component.
        document={JSON.parse(JSON.stringify(document)) as { [key: string]: Json }}
        vocabulary={editorVocabulary()}
        publishHref={routes.standardPublish(standard.publicId)}
      />
    </EditorTemplate>
  );
}
