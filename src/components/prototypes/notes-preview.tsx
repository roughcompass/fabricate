"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert, TextArea } from "@/components/ui/form";
import type { FramePreview } from "@/lib/prototypes/preview-state";
import type { NotedElement } from "@/lib/prototypes/types";
import { VersionPreview } from "./version-preview";
import styles from "./notes-preview.module.css";

export interface OpenNote {
  readonly id: string;
  readonly number: number;
  readonly locator: string;
  readonly text: string;
  readonly component: string;
}

interface NotesPreviewProps {
  readonly versionId: string;
  readonly title: string;
  readonly state: FramePreview;
  readonly renderErrorRecorded: boolean;
  readonly highlight?: readonly string[];
  readonly notes: readonly OpenNote[];
  readonly addNote: (input: { text: string; element: NotedElement }) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * A version's preview with element notes (preview spec, "Visitors can select
 * an element in the preview"): in comment mode, pointing at the preview
 * highlights the nearest Salt component, and selecting it opens a note on it.
 * Each open note has a numbered pin, which the frame keeps on its element
 * when the preview's width changes.
 */
export function NotesPreview({ versionId, title, state, renderErrorRecorded, highlight, notes, addNote }: NotesPreviewProps) {
  const router = useRouter();
  const [commentMode, setCommentMode] = useState(false);
  const [element, setElement] = useState<NotedElement | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pins = notes.map((note) => ({ id: note.id, locator: note.locator, label: String(note.number) }));

  return (
    <div className={styles.notes}>
      <div className={styles.toolbar}>
        <Button icon="message" size="sm" aria-pressed={commentMode} onClick={() => setCommentMode((on) => !on)} data-comment-toggle="">
          {commentMode ? "Commenting: select an element" : "Comment"}
        </Button>
      </div>
      <VersionPreview
        versionId={versionId}
        title={title}
        state={state}
        renderErrorRecorded={renderErrorRecorded}
        highlight={highlight}
        commentMode={commentMode}
        pins={pins}
        onElementSelected={(selected) => {
          setElement(selected);
          setCommentMode(false);
          setError(null);
        }}
      />
      {element && (
        <form
          className={styles.compose}
          aria-label="New note"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            const result = await addNote({ text, element });
            setSaving(false);
            if (!result.ok) return setError(result.error);
            setElement(null);
            setText("");
            router.refresh();
          }}
        >
          <p className={styles.target} data-note-target="">
            {`Note on the ${element.component}${element.text ? ` “${element.text}”` : ""}`}
          </p>
          {/* A PNG data URL the frame captured, which next/image can't optimize. */}
          {element.image && <img src={element.image} alt={`The ${element.component} the note is about`} className={styles.image} />}{/* eslint-disable-line @next/next/no-img-element */}
          {error && <FormAlert id="note-alert">{error}</FormAlert>}
          <TextArea id="note-text" name="note" label="Note" rows={2} value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} required />
          <div className={styles.buttons}>
            <Button type="submit" variant="primary" size="sm" disabled={saving}>
              Save note
            </Button>
            <Button size="sm" onClick={() => setElement(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {notes.length > 0 && (
        <ol className={styles.list} aria-label="Open notes">
          {notes.map((note) => (
            <li key={note.id} data-open-note={note.id}>
              <span className={styles.pin}>{note.number}</span> {`${note.text} (${note.component})`}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
