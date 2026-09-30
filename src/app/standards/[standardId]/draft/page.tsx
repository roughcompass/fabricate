import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { getDb } from "@/lib/db/client";
import { draftDocument, draftOf, findStandard } from "@/lib/standards/standard-records";
import { validateStandard } from "@/lib/standards/validate";
import { saveDraft } from "../../actions";
import { editorCatalog } from "../../catalog";
import type { Json } from "./expression-editor";
import { StandardEditor } from "./standard-editor";

export const metadata: Metadata = { title: "Edit draft" };

const NOTICES: Record<string, string> = {
  created: "The Standard was created with an empty draft. Add Controls, then save.",
  revision: "A new draft was started from the Release. The Release itself does not change.",
};

export default async function DraftPage({ params, searchParams }: { params: Promise<{ standardId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ standardId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const standard = findStandard(db, standardId);
  if (!standard) notFound();
  const draft = draftOf(db, standard.id);
  if (!draft) redirect(`/standards/${standard.publicId}?notice=no_draft`);
  const document = draftDocument(draft);
  const notice = typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  return (
    <Page>
      <PageHeader
        title={`${standard.name} draft`}
        back={{ href: `/standards/${standard.publicId}`, label: standard.name }}
        description="Build each Control from fields and operators. Controls are data: nothing here is run as code. Saving validates the whole draft."
      />
      {notice && (
        <Notice tone="success" live>
          {notice}
        </Notice>
      )}
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
