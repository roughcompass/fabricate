"use client";

import { useId } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { ActionForm, HiddenFields, Select, TextArea, TextInput } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Menu, MenuButton, MenuSeparator } from "@/components/ui/menu";
import { Severity, Status, severityOptions } from "@/components/ui/status";
import { SubmitButton } from "@/components/ui/submit-button";
import { Tag } from "@/components/ui/tag";
import { issueLocation } from "@/lib/standards/issue-location";
import type { EditorVocabulary } from "../../vocabulary";
import type { DraftSaveState } from "../../form-state";
import { ExpressionEditor, type Json, defaultPredicate } from "./expression-editor";
import { fieldProps } from "./fields";
import { type ControlDraft, useControlList } from "./use-control-list";
import styles from "./editor.module.css";

/**
 * The structured Standard draft editor. It keeps the draft's Controls in
 * client state, builds every expression from the vocabulary's choices, and
 * submits the whole structured document to a Server Action, which saves it and
 * returns the complete server-side validation result. The save bar is the one
 * place that reports whether the draft is saved and valid.
 */

interface StandardEditorProps {
  action: (previous: DraftSaveState, formData: FormData) => Promise<DraftSaveState>;
  initial: DraftSaveState;
  document: { [key: string]: Json };
  vocabulary: EditorVocabulary;
  publishHref: string;
}

const SUBJECT_OPTIONS = [
  { value: "repository", label: "Each assessed repository" },
  { value: "relationship_map", label: "The Relationship Map" },
];

export function StandardEditor({ action, initial, document, vocabulary, publishHref }: StandardEditorProps) {
  // The editor opens the Control an issue is in and focuses the field itself.
  return (
    <ActionForm action={action} initial={initial} focusInvalid={false} className={styles.editor}>
      {(state) => <EditorBody state={state} document={document} vocabulary={vocabulary} publishHref={publishHref} />}
    </ActionForm>
  );
}

/** The editor's Controls and save bar, from the state of its latest save. */
function EditorBody({ state, document, vocabulary, publishHref }: { state: DraftSaveState } & Pick<StandardEditorProps, "document" | "vocabulary" | "publishHref">) {
  const { controls, open, dirty, issues, errorsFor, issueCount, setExpanded, update, move, add, remove, showIssue, serialized } = useControlList(document, vocabulary, state);

  return (
    <>
      <HiddenFields values={{ lockVersion: state.lockVersion, document: serialized }} />

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
        <Panel flush>
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
        </Panel>
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
                vocabulary={vocabulary}
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
          <Button icon="plus" disabled={controls.length >= vocabulary.limits.controls} onClick={add}>
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
    </>
  );
}

interface ControlPanelProps {
  control: ControlDraft;
  index: number;
  last: boolean;
  expanded: boolean;
  issueCount: number;
  vocabulary: EditorVocabulary;
  errorsFor: (path: string) => string[];
  onExpand: (expanded: boolean) => void;
  onUpdate: (patch: Partial<ControlDraft>) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}

/** One Control: a summary row that expands to its fields and conditions. */
function ControlPanel({ control, index, last, expanded, issueCount, vocabulary, errorsFor, onExpand, onUpdate, onMove, onRemove }: ControlPanelProps) {
  const path = `controls[${index}]`;
  const id = `control-${control.uid}`;
  const name = `Control ${index + 1}`;
  const bodyId = useId();
  const field = fieldProps(id, path, errorsFor);
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
          <TextInput {...field("key")} label="Key" description="Stable within the Standard, such as has-ci" mono value={control.key} onChange={(event) => onUpdate({ key: event.target.value })} />
          <TextInput {...field("title")} label="Title" value={control.title} onChange={(event) => onUpdate({ title: event.target.value })} />
        </div>
        <TextArea {...field("rationale")} label="Rationale" rows={2} value={control.rationale} onChange={(event) => onUpdate({ rationale: event.target.value })} />
        <div className={styles.row}>
          <Select {...field("severity")} label="Severity" value={control.severity} options={severityOptions(vocabulary.severities)} onChange={(event) => onUpdate({ severity: event.target.value })} />
          <Select
            {...field("subject")}
            label="Subject"
            value={control.subject}
            options={SUBJECT_OPTIONS}
            onChange={(event) => onUpdate({ subject: event.target.value, applicability: { op: "always" }, condition: defaultPredicate(vocabulary, event.target.value) })}
          />
        </div>
        <ExpressionEditor node={control.applicability} scope={control.subject} path={`${path}.applicability`} depth={1} label="Applies when" vocabulary={vocabulary} idPrefix={`${id}-applicability`} errorsFor={errorsFor} onChange={(applicability) => onUpdate({ applicability })} />
        <ExpressionEditor node={control.condition} scope={control.subject} path={`${path}.condition`} depth={1} label="Expected condition" vocabulary={vocabulary} idPrefix={`${id}-condition`} errorsFor={errorsFor} onChange={(condition) => onUpdate({ condition })} />
        <TextArea {...field("guidance")} label="Guidance" optional description="Shown with Findings as advice; never run." rows={2} value={control.guidance} onChange={(event) => onUpdate({ guidance: event.target.value })} />
      </div>
    </section>
  );
}
