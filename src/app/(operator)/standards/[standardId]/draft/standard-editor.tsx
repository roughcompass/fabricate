"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, TextArea, TextInput } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Menu, MenuButton, MenuSeparator } from "@/components/ui/menu";
import { Severity, Status, severityOptions } from "@/components/ui/status";
import { SubmitButton } from "@/components/ui/submit-button";
import { Tag } from "@/components/ui/tag";
import { useToast } from "@/components/ui/toast";
import { issueLocation } from "@/lib/standards/issue-location";
import type { EditorCatalog } from "../../catalog";
import type { DraftIssue, DraftSaveState } from "../../form-state";
import { ExpressionEditor, type Json, type Node, defaultPredicate, record } from "./expression-editor";
import styles from "./editor.module.css";

/**
 * The structured Standard draft editor. It keeps the draft's Controls in
 * client state, builds every expression from the catalog's choices, and
 * submits the whole structured document to a Server Action, which saves it and
 * returns the complete server-side validation result. The save bar is the one
 * place that reports whether the draft is saved and valid.
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

/** `uid` identifies a Control in the editor; it must match between the server and client renders. */
function toDraft(control: Json, catalog: EditorCatalog, uid: number): ControlDraft {
  const value = record(control);
  const text = (field: string) => (typeof value[field] === "string" ? (value[field] as string) : "");
  const subject = value.subject === "relationship_map" ? "relationship_map" : "repository";
  return {
    uid,
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
  // Initial Controls are numbered by position, so both renders agree; added ones continue from there.
  const [controls, setControls] = useState<ControlDraft[]>(() => (Array.isArray(document.controls) ? document.controls.map((control, index) => toDraft(control, catalog, index)) : []));
  const nextUid = useRef(controls.length);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const { toast } = useToast();
  const form = useRef<HTMLFormElement>(null);
  // The submission count when the draft was last edited, and last structurally edited. An edit is saved once a later submission succeeded.
  const [lastEdit, setLastEdit] = useState<number | null>(null);
  const [lastStructuralEdit, setLastStructuralEdit] = useState<number | null>(null);
  const saved = (edit: number | null) => edit === null || (edit < state.submission && state.status === "saved");
  const dirty = !saved(lastEdit);
  // Validation addresses Controls by position; after one moves, is added, or is removed, the result is stale until the next save.
  const structureChanged = !saved(lastStructuralEdit);

  const issues: DraftIssue[] = structureChanged ? [] : state.issues;
  const errorsFor = (path: string) => issues.filter((issue) => issue.field === path).map((issue) => issue.message);
  const issueCount = (index: number) => issues.filter((issue) => issue.field === `controls[${index}]` || issue.field.startsWith(`controls[${index}].`)).length;

  const markEdited = (structural: boolean) => {
    setLastEdit(state.submission);
    if (structural) setLastStructuralEdit(state.submission);
  };
  const change = (next: ControlDraft[], structural = false) => {
    setControls(next);
    markEdited(structural);
  };
  const update = (uid: number, patch: Partial<ControlDraft>) => change(controls.map((control) => (control.uid === uid ? { ...control, ...patch } : control)));
  const move = (index: number, offset: number) => {
    const next = [...controls];
    const [control] = next.splice(index, 1);
    next.splice(index + offset, 0, control!);
    change(next, true);
  };
  const setExpanded = (uid: number, expanded: boolean) =>
    setOpen((current) => {
      const next = new Set(current);
      if (expanded) next.add(uid);
      else next.delete(uid);
      return next;
    });
  const add = () => {
    const control = toDraft({ key: `control-${controls.length + 1}`, severity: "medium", subject: "repository", applicability: { op: "always" } }, catalog, nextUid.current++);
    change([...controls, control], true);
    setExpanded(control.uid, true);
  };
  const remove = (index: number) => {
    const removed = controls[index]!;
    change(controls.filter((control) => control.uid !== removed.uid), true);
    toast({
      id: `removed:${removed.uid}`,
      tone: "info",
      title: `Control ${index + 1}${removed.title ? `, ${removed.title},` : ""} was removed.`,
      action: {
        label: "Undo",
        onAction: () => {
          setControls((current) => {
            const next = [...current];
            next.splice(Math.min(index, next.length), 0, removed);
            return next;
          });
          markEdited(true);
        },
      },
    });
  };

  /** Opens the Control an issue is in and focuses the closest field to its path. */
  const showIssue = (field: string) => {
    const index = /^controls\[(\d+)\]/.exec(field)?.[1];
    if (index !== undefined && controls[Number(index)]) setExpanded(controls[Number(index)]!.uid, true);
    requestAnimationFrame(() => {
      const candidates = [...(form.current?.querySelectorAll<HTMLElement>("[data-issue-path]") ?? [])].filter((element) => {
        const path = element.dataset.issuePath!;
        return field === path || field.startsWith(`${path}.`) || field.startsWith(`${path}[`);
      });
      const target = candidates.sort((a, b) => b.dataset.issuePath!.length - a.dataset.issuePath!.length)[0];
      const focusable = target?.matches("input, select, textarea") ? target : target?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button");
      focusable?.focus();
    });
  };

  const serialized = JSON.stringify({
    schema: document.schema,
    schema_version: document.schema_version,
    input_schemas: document.input_schemas,
    controls: controls.map(({ uid: _uid, guidance, ...control }) => ({ ...control, guidance: guidance.trim() ? guidance : null })),
  });

  return (
    <form ref={form} action={formAction} className={styles.editor} noValidate>
      <input type="hidden" name="lockVersion" value={state.lockVersion} />
      <input type="hidden" name="document" value={serialized} />

      {issues.length > 0 && (
        <div className={styles.issues} role="region" aria-label="Issues">
          <p className={styles.issuesTitle}>
            <Icon name="alert" />
            {`${countLabel(issues.length, "issue")} to fix before publication`}
          </p>
          <ul className={styles.issueList}>
            {issues.map((issue, position) => (
              <li key={`${issue.field}:${position}`}>
                <button type="button" className={styles.issueLink} onClick={() => showIssue(issue.field)}>
                  {issueLocation(issue.field, controls)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {controls.length === 0 ? (
        <EmptyState
          title="No Controls yet"
          action={
            <Button icon="plus" onClick={add}>
              Add Control
            </Button>
          }
        >
          A Standard needs at least one Control before it can be published.
        </EmptyState>
      ) : (
        <ol className={styles.controls}>
          {controls.map((control, index) => (
            <li key={control.uid}>
              <ControlPanel
                control={control}
                index={index}
                last={index === controls.length - 1}
                expanded={open.has(control.uid)}
                issueCount={issueCount(index)}
                catalog={catalog}
                errorsFor={errorsFor}
                onExpand={(expanded) => setExpanded(control.uid, expanded)}
                onUpdate={(patch) => update(control.uid, patch)}
                onMove={(offset) => move(index, offset)}
                onRemove={() => remove(index)}
              />
            </li>
          ))}
        </ol>
      )}

      {errorsFor("controls").map((message) => (
        <p key={message} className={styles.fieldError}>
          {message}
        </p>
      ))}

      {controls.length > 0 && (
        <div className={styles.toolbar}>
          <Button icon="plus" disabled={controls.length >= catalog.limits.controls} onClick={add}>
            Add Control
          </Button>
        </div>
      )}

      <div className={styles.savebar} data-sticky-footer="">
        <p className={styles.saveStatus} aria-live="polite">
          {state.status === "stale" || state.status === "rejected" ? (
            <span className={styles.saveError}>{`Not saved. ${state.message ?? ""}`}</span>
          ) : dirty ? (
            <Status state="unsaved" />
          ) : issues.length ? (
            <Status state="draft_problems" label={`All changes saved · ${countLabel(issues.length, "issue")} to fix`} />
          ) : (
            <Status state="draft_ready" label="All changes saved · Ready to publish" />
          )}
        </p>
        <div className={styles.saveActions}>
          {!dirty && !issues.length && state.status !== "stale" && state.status !== "rejected" && (
            <ButtonLink href={publishHref} icon="lock">
              Review and publish
            </ButtonLink>
          )}
          <SubmitButton pendingLabel="Saving">Save draft</SubmitButton>
        </div>
      </div>
    </form>
  );
}

interface ControlPanelProps {
  control: ControlDraft;
  index: number;
  last: boolean;
  expanded: boolean;
  issueCount: number;
  catalog: EditorCatalog;
  errorsFor: (path: string) => string[];
  onExpand: (expanded: boolean) => void;
  onUpdate: (patch: Partial<ControlDraft>) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}

/** One Control: a summary row that expands to its fields and conditions. */
function ControlPanel({ control, index, last, expanded, issueCount, catalog, errorsFor, onExpand, onUpdate, onMove, onRemove }: ControlPanelProps) {
  const path = `controls[${index}]`;
  const id = `control-${control.uid}`;
  const name = `Control ${index + 1}`;
  const bodyId = useId();
  return (
    <section className={styles.control} aria-label={`${name}${control.title ? `: ${control.title}` : ""}`} data-issue-path={path} data-invalid={issueCount > 0 || undefined}>
      <div className={styles.controlHeader}>
        <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={bodyId} onClick={() => onExpand(!expanded)}>
          <Icon name="chevronRight" size={14} className={styles.chevron} />
          <span className={styles.controlText}>
            <span className={styles.controlLabel}>
              <span className={styles.controlName}>{name}</span>
              {control.key && <Tag>{control.key}</Tag>}
            </span>
            <span className={control.title ? styles.controlTitle : `${styles.controlTitle} ${styles.untitled}`}>{control.title || "Untitled"}</span>
          </span>
        </button>
        <div className={styles.controlMeta}>
          {issueCount > 0 && <span className={styles.issueCount}>{countLabel(issueCount, "issue")}</span>}
          <Severity value={control.severity} />
          <Menu label={`Actions for ${name}`}>
            <MenuButton icon="arrowUp" disabled={index === 0} onClick={() => onMove(-1)}>
              Move up
            </MenuButton>
            <MenuButton icon="arrowDown" disabled={last} onClick={() => onMove(1)}>
              Move down
            </MenuButton>
            <MenuSeparator />
            <MenuButton icon="trash" tone="danger" onClick={onRemove}>
              Remove
            </MenuButton>
          </Menu>
        </div>
      </div>
      <div id={bodyId} className={styles.controlBody} hidden={!expanded}>
        {errorsFor(path).map((message) => (
          <p key={message} className={styles.fieldError}>
            {message}
          </p>
        ))}
        <div className={styles.row}>
          <TextInput id={`${id}-key`} label="Key" description="Stable within the Standard, such as has-ci" mono value={control.key} errors={errorsFor(`${path}.key`)} data-issue-path={`${path}.key`} onChange={(event) => onUpdate({ key: event.target.value })} />
          <TextInput id={`${id}-title`} label="Title" value={control.title} errors={errorsFor(`${path}.title`)} data-issue-path={`${path}.title`} onChange={(event) => onUpdate({ title: event.target.value })} />
        </div>
        <TextArea id={`${id}-rationale`} label="Rationale" rows={2} value={control.rationale} errors={errorsFor(`${path}.rationale`)} data-issue-path={`${path}.rationale`} onChange={(event) => onUpdate({ rationale: event.target.value })} />
        <div className={styles.row}>
          <Select id={`${id}-severity`} label="Severity" value={control.severity} options={severityOptions(catalog.severities)} errors={errorsFor(`${path}.severity`)} data-issue-path={`${path}.severity`} onChange={(event) => onUpdate({ severity: event.target.value })} />
          <Select
            id={`${id}-subject`}
            label="Subject"
            value={control.subject}
            options={SUBJECT_OPTIONS}
            errors={errorsFor(`${path}.subject`)}
            data-issue-path={`${path}.subject`}
            onChange={(event) => onUpdate({ subject: event.target.value, applicability: { op: "always" }, condition: defaultPredicate(catalog, event.target.value) })}
          />
        </div>
        <ExpressionEditor node={control.applicability} scope={control.subject} path={`${path}.applicability`} depth={1} label="Applies when" catalog={catalog} idPrefix={`${id}-applicability`} errorsFor={errorsFor} onChange={(applicability) => onUpdate({ applicability })} />
        <ExpressionEditor node={control.condition} scope={control.subject} path={`${path}.condition`} depth={1} label="Expected condition" catalog={catalog} idPrefix={`${id}-condition`} errorsFor={errorsFor} onChange={(condition) => onUpdate({ condition })} />
        <TextArea id={`${id}-guidance`} label="Guidance" optional description="Shown with Findings as advice; never run." rows={2} value={control.guidance} errors={errorsFor(`${path}.guidance`)} data-issue-path={`${path}.guidance`} onChange={(event) => onUpdate({ guidance: event.target.value })} />
      </div>
    </section>
  );
}
