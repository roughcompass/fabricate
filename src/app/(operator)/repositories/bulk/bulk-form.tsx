"use client";

import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { ActionForm, FormAlert, FormFooter, formStyles, TextArea } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { BULK_LIMIT } from "@/lib/catalog/bulk-lines";
import type { BulkFormState } from "./bulk-state";

/**
 * Add Repositories in bulk. When every line is added, the action opens the
 * Repositories list; otherwise the form stays, says how many were added,
 * lists each refused line with why, and keeps only those lines to fix.
 */
export function BulkForm({ action, initial }: { action: (previous: BulkFormState, formData: FormData) => Promise<BulkFormState>; initial: BulkFormState }) {
  return (
    <ActionForm action={action} initial={initial} alertId="bulk-form-alert">
      {(state) => (
        <Panel
          footer={
            <FormFooter>
              <ButtonLink href="/repositories">Cancel</ButtonLink>
              <SubmitButton pendingLabel="Adding">Add Repositories</SubmitButton>
            </FormFooter>
          }
        >
          <div className={formStyles.form}>
            {state.errors.base && <FormAlert id="bulk-form-alert">{state.errors.base.join(" ")}</FormAlert>}
            {state.failed.length > 0 && (
              <Alert tone={state.added ? "warning" : "error"} title={`Added ${state.added} of ${countLabel(state.added + state.failed.length, "Repository", "Repositories")}`} live>
                {`${countLabel(state.failed.length, "line")} couldn't be added and ${state.failed.length === 1 ? "is" : "are"} left below to fix.`}
              </Alert>
            )}
            {state.failed.length > 0 && (
              <Table
                label="Lines that couldn't be added"
                head={
                  <>
                    <Th>Line</Th>
                    <Th>Clone URL</Th>
                    <Th>Why</Th>
                  </>
                }
              >
                {state.failed.map((failure) => (
                  <tr key={failure.line}>
                    <Td label="Line">{failure.line}</Td>
                    <Td label="Clone URL">
                      <Tag>{failure.text}</Tag>
                    </Td>
                    <Td label="Why">
                      <Secondary>{failure.message}</Secondary>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
            <TextArea
              key={state.submission ?? 0}
              id="bulk-urls"
              name="urls"
              label="Clone URLs"
              rows={12}
              defaultValue={state.values.urls}
              errors={state.errors.urls}
              description={`One per line, up to ${BULK_LIMIT}: a file://, https://, or ssh:// URL, optionally followed by a branch, tag, or commit. Each is named after its owner and repository, such as vickykatoch-helios, and profiled in the background.`}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              placeholder={"https://github.com/vickykatoch/helios.git\nhttps://github.com/openmrs/openmrs-esm-core.git main"}
              required
            />
          </div>
        </Panel>
      )}
    </ActionForm>
  );
}
