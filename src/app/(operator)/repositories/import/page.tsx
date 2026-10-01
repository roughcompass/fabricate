import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { TextInput, formStyles } from "@/components/ui/form";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { TagList } from "@/components/ui/tag";
import { type ImportPreview, previewImport } from "@/lib/catalog/directory-import";
import { BoundaryViolation } from "@/lib/catalog/source-boundary";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { importSources } from "./actions";
import { CandidatesForm } from "./candidates-form";

export const metadata: Metadata = { title: "Import Repositories" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const directory = (param(query, "directory") ?? "").trim();
  let preview: ImportPreview | null = null;
  let error: string | null = null;
  if (directory) {
    try {
      preview = previewImport(getDb(), directory);
    } catch (caught) {
      if (!(caught instanceof BoundaryViolation)) throw caught;
      error = caught.message;
    }
  }
  const allowedRoots = getConfig().allowedRoots;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ href: "/repositories", label: "Repositories" }]}
        title="Import Repositories"
        description="Preview the Git working trees directly inside a local directory; nothing is added until you confirm a selection."
      />

      <form method="get" action="/repositories/import">
        <Panel
          title="Directory"
          footer={
            <SubmitButton variant={preview ? "secondary" : "primary"} icon="search">
              Preview
            </SubmitButton>
          }
        >
          <div className={formStyles.form}>
            <TextInput
              id="import-directory"
              name="directory"
              label="Absolute path"
              mono
              defaultValue={directory}
              errors={error ? [error] : undefined}
              description={
                <>
                  Allowed roots: <TagList values={allowedRoots} empty="none configured" />
                </>
              }
            />
          </div>
        </Panel>
      </form>

      {preview &&
        (preview.candidates.length > 0 ? (
          <CandidatesForm action={importSources} directory={directory} root={preview.root} candidates={preview.candidates} noneSelected={param(query, "notice") === "none-selected"} />
        ) : (
          <Panel flush>
            <EmptyState title="No Git working trees found" icon="folder">{`${preview.root} has no directories directly inside it that are Git working trees.`}</EmptyState>
          </Panel>
        ))}
    </Page>
  );
}
