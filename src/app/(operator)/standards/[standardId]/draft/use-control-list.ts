import { useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import type { EditorVocabulary } from "../../vocabulary";
import type { DraftIssue, DraftSaveState } from "../../form-state";
import { type Json, type Node, defaultPredicate, record } from "./expression-editor";

/*
 * The Standard editor's Controls in client state: their edits, which ones are
 * open, the issues of the latest save that still apply, and the document the
 * next save submits.
 */

export interface ControlDraft {
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

/** `uid` identifies a Control in the editor; it must match between the server and client renders. */
function toDraft(control: Json, vocabulary: EditorVocabulary, uid: number): ControlDraft {
  const value = record(control);
  const text = (field: string) => (typeof value[field] === "string" ? (value[field] as string) : "");
  const subject = value.subject === "relationship_map" ? "relationship_map" : "repository";
  return {
    uid,
    key: text("key"),
    title: text("title"),
    rationale: text("rationale"),
    severity: vocabulary.severities.includes(text("severity")) ? text("severity") : "medium",
    subject,
    applicability: value.applicability ? record(value.applicability) : { op: "always" },
    condition: value.condition ? record(value.condition) : defaultPredicate(vocabulary, subject),
    guidance: text("guidance"),
  };
}

export function useControlList(document: { [key: string]: Json }, vocabulary: EditorVocabulary, state: DraftSaveState) {
  // Initial Controls are numbered by position, so both renders agree; added ones continue from there.
  const [controls, setControls] = useState<ControlDraft[]>(() => (Array.isArray(document.controls) ? document.controls.map((control, index) => toDraft(control, vocabulary, index)) : []));
  const nextUid = useRef(controls.length);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const { toast } = useToast();
  // The submission count when the draft was last edited, and last structurally edited. An edit is saved once a later submission succeeded.
  const [lastEdit, setLastEdit] = useState<number | null>(null);
  const [lastStructuralEdit, setLastStructuralEdit] = useState<number | null>(null);
  const saved = (edit: number | null) => edit === null || (edit < state.submission && state.status === "saved");
  // Validation addresses Controls by position; after one moves, is added, or is removed, the result is stale until the next save.
  const issues: DraftIssue[] = saved(lastStructuralEdit) ? state.issues : [];
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
  const setExpanded = (uid: number, expanded: boolean) =>
    setOpen((current) => {
      const next = new Set(current);
      if (expanded) next.add(uid);
      else next.delete(uid);
      return next;
    });

  return {
    controls,
    open,
    dirty: !saved(lastEdit),
    issues,
    errorsFor,
    issueCount,
    setExpanded,
    update: (uid: number, patch: Partial<ControlDraft>) => change(controls.map((control) => (control.uid === uid ? { ...control, ...patch } : control))),
    move: (index: number, offset: number) => {
      const next = [...controls];
      const [control] = next.splice(index, 1);
      next.splice(index + offset, 0, control!);
      change(next, true);
    },
    add: () => {
      const control = toDraft({ key: `control-${controls.length + 1}`, severity: "medium", subject: "repository", applicability: { op: "always" } }, vocabulary, nextUid.current++);
      change([...controls, control], true);
      setExpanded(control.uid, true);
    },
    remove: (index: number) => {
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
    },
    /** Opens the Control an issue is in and focuses the closest field to its path. */
    showIssue: (field: string) => {
      const index = /^controls\[(\d+)\]/.exec(field)?.[1];
      if (index !== undefined && controls[Number(index)]) setExpanded(controls[Number(index)]!.uid, true);
      requestAnimationFrame(() => {
        // One editor is on the page, so its fields are the page's.
        const candidates = [...window.document.querySelectorAll<HTMLElement>("[data-issue-path]")].filter((element) => {
          const path = element.dataset.issuePath!;
          return field === path || field.startsWith(`${path}.`) || field.startsWith(`${path}[`);
        });
        const target = candidates.sort((a, b) => b.dataset.issuePath!.length - a.dataset.issuePath!.length)[0];
        const focusable = target?.matches("input, select, textarea") ? target : target?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button");
        focusable?.focus();
      });
    },
    /** The structured document the next save submits. */
    serialized: JSON.stringify({
      schema: document.schema,
      schema_version: document.schema_version,
      input_schemas: document.input_schemas,
      controls: controls.map(({ uid: _uid, guidance, ...control }) => ({ ...control, guidance: guidance.trim() ? guidance : null })),
    }),
  };
}
