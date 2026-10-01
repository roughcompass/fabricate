import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { getDb } from "@/lib/db/client";
import { draftDocument, draftOf, findStandard } from "@/lib/standards/standard-records";
import { validateStandard } from "@/lib/standards/validate";
import { saveDraft } from "../../actions";
import { editorCatalog } from "../../catalog";
import { draftOutcome } from "../../outcomes";
import type { Json } from "./expression-editor";
import { StandardEditor } from "./standard-editor";

const loadStandard = cache((publicId: string) => findStandard(getDb(), publicId));

export async function generateMetadata({ params }: { params: Promise<{ standardId: string }> }): Promise<Metadata> {
  const standard = loadStandard((await params).standardId);
  return { title: standard ? `${standard.name} draft` : "Standard not found" };
}

export default async function DraftPage({ params, searchParams }: { params: Promise<{ standardId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ standardId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const standard = loadStandard(standardId);
  if (!standard) notFound();
  const draft = draftOf(db, standard.id);
  if (!draft) redirect(`/standards/${standard.publicId}?notice=no_draft`);
  const document = draftDocument(draft);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[
          { href: "/standards", label: "Standards" },
          { href: `/standards/${standard.publicId}`, label: standard.name },
        ]}
        title="Edit draft"
        description="Build each Control from fields and operators; Controls are data, and nothing here runs as code."
        alerts={<OutcomeToast outcome={draftOutcome(param(query, "notice"), standard)} />}
      />
      <StandardEditor
        action={saveDraft.bind(null, standard.publicId)}
        initial={{ lockVersion: draft.lockVersion, issues: validateStandard(document, { metadata: standard }), status: "unsaved", message: null, submission: 0 }}
        // A plain copy: the parsed draft has null-prototype objects, which cannot cross to a client component.
        document={JSON.parse(JSON.stringify(document)) as { [key: string]: Json }}
        catalog={editorCatalog()}
        publishHref={`/standards/${standard.publicId}/publish`}
      />
    </Page>
  );
}
