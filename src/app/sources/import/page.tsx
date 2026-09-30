import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { countLabel } from "@/components/ui/format";
import { FormActions, TextInput, formStyles } from "@/components/ui/form";
import { Card, ChipList, EmptyState, Page, PageHeader } from "@/components/ui/layout";
import { Mono, Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { SubmitButton } from "@/components/ui/submit-button";
import { type ImportPreview, previewImport } from "@/lib/catalog/directory-import";
import { BoundaryViolation } from "@/lib/catalog/source-boundary";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { importSources } from "./actions";
import styles from "./import.module.css";

export const metadata: Metadata = { title: "Import directory" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const directory = typeof params.directory === "string" ? params.directory.trim() : "";
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
  const importable = preview?.candidates.filter((candidate) => candidate.status === "importable").length ?? 0;

  return (
    <Page>
      <PageHeader
        title="Import directory"
        back={{ href: "/sources", label: "Sources" }}
        description="Preview the immediate child Git working trees of a local directory. Nothing is added until you confirm a selection."
      />

      <Card title="Directory">
        <form method="get" action="/sources/import" className={formStyles.form}>
          <TextInput
            id="import-directory"
            name="directory"
            label="Absolute path"
            mono
            defaultValue={directory}
            errors={error ? [error] : undefined}
            hint={
              <>
                Allowed roots: {allowedRoots.length ? <ChipList values={allowedRoots} /> : "none configured"}
              </>
            }
          />
          <FormActions>
            <button type="submit" className={buttonClass()}>
              Preview
            </button>
          </FormActions>
        </form>
      </Card>

      {preview &&
        (preview.candidates.length > 0 ? (
          <form action={importSources} className={formStyles.form}>
            <input type="hidden" name="directory" value={directory} />
            <Card title="Candidates" description={`${countLabel(importable, "importable repository", "importable repositories")} in ${preview.root}`} flush>
              <Table
                label="Import candidates"
                head={
                  <>
                    <Th hidden>Select</Th>
                    <Th>Name</Th>
                    <Th>Clone URL</Th>
                    <Th>Status</Th>
                  </>
                }
              >
                {preview.candidates.map((candidate) => {
                  const inputId = `candidate-${candidate.name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
                  return (
                    <tr key={candidate.path}>
                      <Td label="Select">
                        <span className={styles.hit}>
                          <input
                          id={inputId}
                          className={styles.checkbox}
                          type="checkbox"
                          name="paths"
                          value={candidate.path}
                          defaultChecked={candidate.status === "importable"}
                          disabled={candidate.status !== "importable"}
                          aria-label={`Import ${candidate.name}`}
                          />
                        </span>
                      </Td>
                      <Td label="Name">
                        <label htmlFor={inputId}>
                          <Primary>{candidate.name}</Primary>
                        </label>
                      </Td>
                      <Td label="Clone URL">
                        <Mono>{candidate.cloneUrl ?? candidate.path}</Mono>
                      </Td>
                      <Td label="Status">
                        {candidate.status === "importable" && (
                          <Badge tone="info" icon="plus">
                            Ready
                          </Badge>
                        )}
                        {candidate.status === "registered" && <Badge icon="check">{candidate.reason}</Badge>}
                        {candidate.status === "rejected" && (
                          <>
                            <Badge tone="error" icon="xCircle">
                              Rejected
                            </Badge>
                            <Secondary>{candidate.reason}</Secondary>
                          </>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
            <FormActions>
              {importable > 0 && <SubmitButton pendingLabel="Adding…">Add selected sources</SubmitButton>}
              <ButtonLink href="/sources" variant="ghost">
                Cancel
              </ButtonLink>
            </FormActions>
          </form>
        ) : (
          <EmptyState title="No Git working trees found">{`${preview.root} has no immediate child directories that are Git working trees.`}</EmptyState>
        ))}
    </Page>
  );
}
