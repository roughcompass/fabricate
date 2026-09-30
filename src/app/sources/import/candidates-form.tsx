"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { Checkbox, FormFooter, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { Status } from "@/components/ui/status";
import { SubmitButton } from "@/components/ui/submit-button";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";

export interface Candidate {
  name: string;
  path: string;
  cloneUrl: string | null;
  status: "importable" | "registered" | "rejected";
  reason: string | null;
}

interface CandidatesFormProps {
  action: (formData: FormData) => void | Promise<void>;
  directory: string;
  root: string;
  candidates: readonly Candidate[];
  /** The last submission selected nothing. */
  noneSelected: boolean;
}

const subscribeNever = () => () => {};

/**
 * The import candidates with check boxes. Importable candidates start
 * selected; with JavaScript, a header check box selects or clears them all and
 * the button counts the selection. Without JavaScript the form still submits,
 * and the server asks for a selection when none was made.
 */
export function CandidatesForm({ action, directory, root, candidates, noneSelected }: CandidatesFormProps) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const importable = candidates.filter((candidate) => candidate.status === "importable").map((candidate) => candidate.path);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(importable));
  const all = useRef<HTMLInputElement>(null);
  const count = selected.size;
  // A partial selection shows as indeterminate, which only script can set.
  useEffect(() => {
    if (all.current) all.current.indeterminate = count > 0 && count < importable.length;
  }, [count, importable.length]);

  const toggle = (path: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });

  return (
    <form action={action}>
      <input type="hidden" name="directory" value={directory} />
      <Panel
        title="Candidates"
        description={`${countLabel(importable.length, "importable repository", "importable repositories")} in ${root}`}
        flush
        footer={
          <div className={formStyles.form}>
            {noneSelected && (
              <p className={formStyles.error} role="alert">
                Select at least one repository to add.
              </p>
            )}
            <FormFooter>
              <ButtonLink href="/sources">Cancel</ButtonLink>
              {importable.length > 0 && (
                <SubmitButton pendingLabel="Adding" disabled={hydrated && count === 0}>
                  {hydrated ? `Add ${countLabel(count, "Source")}` : "Add selected Sources"}
                </SubmitButton>
              )}
            </FormFooter>
          </div>
        }
      >
        <Table
          label="Import candidates"
          head={
            <>
              <Th>
                {hydrated && importable.length > 0 ? (
                  <input
                    ref={all}
                    type="checkbox"
                    className={formStyles.checkbox}
                    aria-label="Select every importable repository"
                    checked={count === importable.length}
                    onChange={(event) => setSelected(new Set(event.target.checked ? importable : []))}
                  />
                ) : (
                  <span className="visually-hidden">Select</span>
                )}
              </Th>
              <Th>Repository</Th>
              <Th>Status</Th>
            </>
          }
        >
          {candidates.map((candidate) => {
            const id = `candidate-${candidate.name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
            const selectable = candidate.status === "importable";
            return (
              <tr key={candidate.path}>
                <Td label="Select">
                  <Checkbox
                    id={id}
                    name="paths"
                    value={candidate.path}
                    label={`Import ${candidate.name}`}
                    hideLabel
                    disabled={!selectable}
                    // Controlled from the first render: the server renders the same checked state, which works without JavaScript too.
                    checked={selected.has(candidate.path)}
                    onChange={(event) => toggle(candidate.path, event.target.checked)}
                  />
                </Td>
                <Td label="Repository">
                  <Primary>
                    <label htmlFor={id}>{candidate.name}</label>
                  </Primary>
                  <Secondary>
                    <Tag>{candidate.cloneUrl ?? candidate.path}</Tag>
                  </Secondary>
                </Td>
                <Td label="Status">
                  <Status state={candidate.status} />
                  {candidate.reason && <Secondary>{candidate.reason}</Secondary>}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </form>
  );
}
