"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSummary, Select, TextArea, TextInput } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { SubmitButton } from "@/components/ui/submit-button";
import type { EditorCatalog } from "../../catalog";
import type { DraftIssue, DraftSaveState } from "../../form-state";
import { ExpressionEditor, type Json, type Node, defaultPredicate, record } from "./expression-editor";
import styles from "../../standards.module.css";

/**
 * The structured Standard draft editor. It keeps the draft's Controls in
 * client state, builds every expression from the catalog's choices, and
 * submits the whole structured document to a Server Action, which saves it and
 * returns the complete server-side validation result.
 */

interface ControlDraft {
  uid: number;
  key: string;
  title: string;
  rationale: string;
  severity: string;
  subject: string;
  applicability: Node;
  condition: Node;
  guidance: string;
}

interface StandardEditorProps {
  action: (previous: DraftSaveState, formData: FormData) => Promise<DraftSaveState>;
  initial: DraftSaveState;
  document: { [key: string]: Json };
  catalog: EditorCatalog;
  publishHref: string;
}

const SUBJECT_OPTIONS = [
  { value: "repository", label: "Each assessed repository" },
  { value: "relationship_map", label: "The Relationship Map" },
];

let nextUid = 1;

function toDraft(control: Json, catalog: EditorCatalog): ControlDraft {
  const value = record(control);
  const text = (field: string) => (typeof value[field] === "string" ? (value[field] as string) : "");
  const subject = value.subject === "relationship_map" ? "relationship_map" : "repository";
  return {
    uid: nextUid++,
    key: text("key"),
    title: text("title"),
    rationale: text("rationale"),
    severity: catalog.severities.includes(text("severity")) ? text("severity") : "medium",
    subject,
    applicability: value.applicability ? record(value.applicability) : { op: "always" },
    condition: value.condition ? record(value.condition) : defaultPredicate(catalog, subject),
    guidance: text("guidance"),
  };
}

export function StandardEditor({ action, initial, document, catalog, publishHref }: StandardEditorProps) {
  const [state, formAction] = useActionState(action, initial);
  const [controls, setControls] = useState<ControlDraft[]>(() => (Array.isArray(document.controls) ? document.controls.map((control) => toDraft(control, catalog)) : []));
  // The submission count when the draft was last edited, and last structurally edited. An edit is saved once a later submission succeeded.
  const [lastEdit, setLastEdit] = useState<number | null>(null);
  const [lastStructuralEdit, setLastStructuralEdit] = useState<number | null>(null);
  const saved = (edit: number | null) => edit === null || (edit < state.submission && state.status === "saved");
  const dirty = !saved(lastEdit);
  // Validation addresses Controls by position; after one moves, is added, or is removed, the result is stale until the next save.
  const structureChanged = !saved(lastStructuralEdit);
  const lastSubmission = useRef(state.submission);
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.submission === lastSubmission.current) return;
    lastSubmission.current = state.submission;
    summary.current?.focus();
  }, [state]);

  const issues: DraftIssue[] = structureChanged ? [] : state.issues;
  const errorsFor = (path: string) => issues.filter((issue) => issue.field === path).map((issue) => issue.message);
  const change = (next: ControlDraft[], structural = false) => {
    setControls(next);
    setLastEdit(state.submission);
    if (structural) setLastStructuralEdit(state.submission);
  };
  const update = (uid: number, patch: Partial<ControlDraft>) => change(controls.map((control) => (control.uid === uid ? { ...control, ...patch } : control)));
  const move = (index: number, offset: number) => {
    const next = [...controls];
    const [control] = next.splice(index, 1);
    next.splice(index + offset, 0, control!);
    change(next, true);
  };

  const serialized = JSON.stringify({
    schema: document.schema,
    schema_version: document.schema_version,
    input_schemas: document.input_schemas,
    controls: controls.map(({ uid: _uid, guidance, ...control }) => ({ ...control, guidance: guidance.trim() ? guidance : null })),
  });

  return (
    <form action={formAction} className={styles.editor} noValidate>
      <input type="hidden" name="lockVersion" value={state.lockVersion} />
      <input type="hidden" name="document" value={serialized} />

      <div ref={summary} tabIndex={-1}>
        {state.status === "stale" || state.status === "rejected" ? (
          <Notice tone="warning" title="The draft was not saved" live>
            {state.message}
          </Notice>
        ) : issues.length ? (
          <ErrorSummary id="draft-errors" title={`This draft has ${issues.length === 1 ? "1 problem" : `${issues.length} problems`} to fix before publication:`} messages={issues.map((issue) => describeIssue(issue, controls))} />
        ) : structureChanged ? (
          <Notice tone="info" live>
            Save the draft to validate it again.
          </Notice>
        ) : state.status === "saved" && !dirty ? (
          <Notice tone="success" title="Draft saved" live>
            The draft is valid. <Link href={publishHref}>Review it for publication</Link>.
          </Notice>
        ) : null}
      </div>

      {controls.length === 0 && <p className={styles.muted}>This draft has no Controls yet. A Standard needs at least one before it can be published.</p>}

      {controls.map((control, index) => {
        const path = `controls[${index}]`;
        const id = `control-${control.uid}`;
        const name = `Control ${index + 1}`;
        return (
          <section key={control.uid} className={styles.editorControl} aria-labelledby={`${id}-heading`}>
            <div className={styles.editorControlHeader}>
              <h2 id={`${id}-heading`}>
                {name}
                {control.title ? `: ${control.title}` : ""}
              </h2>
              <div className={styles.toolbar}>
                <Button variant="ghost" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${name} up`}>
                  Move up
                </Button>
                <Button variant="ghost" disabled={index === controls.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${name} down`}>
                  Move down
                </Button>
                <Button variant="destructive" icon="trash" onClick={() => change(controls.filter((item) => item.uid !== control.uid), true)} aria-label={`Remove ${name}`}>
                  Remove
                </Button>
              </div>
            </div>
            {errorsFor(path).map((message) => (
              <p key={message} className={styles.fieldError}>
                {message}
              </p>
            ))}
            <div className={styles.row}>
              <TextInput id={`${id}-key`} label="Key" hint="Stable within the Standard, such as has-ci" mono value={control.key} errors={errorsFor(`${path}.key`)} onChange={(event) => update(control.uid, { key: event.target.value })} />
              <TextInput id={`${id}-title`} label="Title" value={control.title} errors={errorsFor(`${path}.title`)} onChange={(event) => update(control.uid, { title: event.target.value })} />
            </div>
            <TextArea id={`${id}-rationale`} label="Rationale" rows={2} value={control.rationale} errors={errorsFor(`${path}.rationale`)} onChange={(event) => update(control.uid, { rationale: event.target.value })} />
            <div className={styles.row}>
              <Select id={`${id}-severity`} label="Severity" value={control.severity} options={catalog.severities.map((value) => ({ value, label: value }))} errors={errorsFor(`${path}.severity`)} onChange={(event) => update(control.uid, { severity: event.target.value })} />
              <Select
                id={`${id}-subject`}
                label="Subject"
                value={control.subject}
                options={SUBJECT_OPTIONS}
                errors={errorsFor(`${path}.subject`)}
                onChange={(event) => update(control.uid, { subject: event.target.value, applicability: { op: "always" }, condition: defaultPredicate(catalog, event.target.value) })}
              />
            </div>
            <ExpressionEditor node={control.applicability} scope={control.subject} path={`${path}.applicability`} depth={1} label="Applies when" catalog={catalog} idPrefix={`${id}-applicability`} errorsFor={errorsFor} onChange={(applicability) => update(control.uid, { applicability })} />
            <ExpressionEditor node={control.condition} scope={control.subject} path={`${path}.condition`} depth={1} label="Expected condition" catalog={catalog} idPrefix={`${id}-condition`} errorsFor={errorsFor} onChange={(condition) => update(control.uid, { condition })} />
            <TextArea id={`${id}-guidance`} label="Guidance" optional hint="Shown with Findings as advice; never run." rows={2} value={control.guidance} errors={errorsFor(`${path}.guidance`)} onChange={(event) => update(control.uid, { guidance: event.target.value })} />
          </section>
        );
      })}

      {errorsFor("controls").map((message) => (
        <p key={message} className={styles.fieldError}>
          {message}
        </p>
      ))}

      <div className={styles.toolbar}>
        <Button
          icon="plus"
          disabled={controls.length >= catalog.limits.controls}
          onClick={() => change([...controls, toDraft({ key: `control-${controls.length + 1}`, severity: "medium", subject: "repository", applicability: { op: "always" } }, catalog)], true)}
        >
          Add Control
        </Button>
      </div>

      <div className={styles.savebar}>
        <span className={styles.muted} aria-live="polite">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <SubmitButton pendingLabel="Saving…">Save draft</SubmitButton>
      </div>
    </form>
  );
}

const PART_LABELS: Record<string, string> = { applicability: "Applies when", condition: "Expected condition", key: "Key", title: "Title", rationale: "Rationale", severity: "Severity", subject: "Subject", guidance: "Guidance" };

/** A validation issue in words: which Control, which part, and what is wrong. */
function describeIssue(issue: DraftIssue, controls: readonly ControlDraft[]): string {
  const match = /^controls\[(\d+)\](?:\.(\w+))?/.exec(issue.field);
  if (!match) return issue.message;
  const index = Number(match[1]);
  const key = controls[index]?.key;
  const part = match[2] ? (PART_LABELS[match[2]] ?? match[2]) : null;
  return `Control ${index + 1}${key ? ` (${key})` : ""}${part ? `, ${part}` : ""}: ${issue.message}`;
}
