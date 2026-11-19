"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TextArea, TextInput } from "@/components/ui/form";
import { RelativeTime } from "@/components/ui/relative-time";
import { CommentBody } from "@/components/toolbar/comments/comment-body";
import styles from "@/components/toolbar/comments/comments.module.css";
import { Placed, type Preferred, bottomCenter } from "@/components/toolbar/placed";
import type { Rect } from "@/components/toolbar/placement";
import { FORMAT_MARKERS, commentText, toggleMarker } from "@/lib/demo/comment-format";
import { markToolbarEvent } from "../inspector/protocol";
import { useTargetDocument, useTargetRects } from "../target-document";
import { useToolbar } from "../toolbar-context";
import { type ElementAnchor, anchorFor, commentTarget, describeAnchor, findAnchored } from "./element-anchor";
import { useComments } from "./comments-state";
import type { FieldErrors, PlacedThread } from "./thread-store";

/** Matches --space-3: the gap between a point and the popover beside it. */
const MARGIN = 12;

/**
 * Where a popover beside a point prefers to go: to its right, or to its left
 * when the right has no room. <Placed> then keeps it clear of the toolbar.
 */
function beside(point: { x: number; y: number }): Preferred {
  return (box, viewport) => ({ left: point.x + MARGIN + box.width <= viewport.width - MARGIN ? point.x + MARGIN : point.x - MARGIN - box.width, top: point.y - MARGIN });
}

function excerpt(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));

/** The pin position of a thread: its element's rect at the saved fractional offset. */
function pinPoint(rect: Rect, place: { offsetX: number; offsetY: number }) {
  return { x: rect.left + place.offsetX * rect.width, y: rect.top + place.offsetY * rect.height };
}

function inside(point: { x: number; y: number }, rect: Rect): boolean {
  return point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;
}

interface Draft {
  readonly anchor: ElementAnchor;
  readonly offsetX: number;
  readonly offsetY: number;
  /** Where it was chosen, until its element is measured. */
  readonly x: number;
  readonly y: number;
}

/**
 * Comments on the running application's own page: comment mode (outline the
 * element under the pointer or focus in the frame, choose one to comment on
 * it), the composer, a numbered pin for each open thread whose element is in
 * this view, and the open thread. Pins and outlines are drawn over the frame,
 * at the frame's elements' positions.
 */
export function CommentLayer() {
  const { mode, setMode } = useToolbar();
  const comments = useComments();
  const target = useTargetDocument();
  const active = mode === "comment";
  const [hovered, setHovered] = useState<Element | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const { document } = target;

  // Open threads placed on this route, numbered by age across every route.
  const numbered = comments.threads.map((thread, index) => ({ thread, number: index + 1 }));
  const shown = numbered.filter(({ thread }) => thread.status === "open" && thread.route === target.route);
  const rects = useTargetRects(
    (frameDocument) => {
      const elements = new Map<string, Element>();
      for (const { thread } of shown) {
        const element = findAnchored(frameDocument, thread.anchor);
        if (element) elements.set(thread.id, element);
      }
      if (hovered) elements.set("__hovered", hovered);
      const drafted = draft && findAnchored(frameDocument, draft.anchor);
      if (drafted) elements.set("__draft", drafted);
      return elements;
    },
    // Only while there's something to place, so a page that changes constantly costs nothing otherwise.
    shown.length > 0 || hovered !== null || draft !== null,
    `${shown.map(({ thread }) => thread.id).join(",")}|${hovered ? "h" : ""}|${draft?.anchor.path ?? ""}|${target.route}|${target.changes}`,
  );

  const choose = useEffectEvent((element: Element, point: { x: number; y: number } | null) => {
    if (!document) return;
    const chosen = commentTarget(element);
    const box = chosen.getBoundingClientRect();
    const offsetX = point ? clamp((point.x - box.left) / box.width) : 0.5;
    const offsetY = point ? clamp((point.y - box.top) / box.height) : 0.5;
    const rect = target.toParent({ top: box.top, left: box.left, width: box.width, height: box.height });
    setMode("none");
    setHovered(null);
    comments.setOpenThread(null);
    setDraft({ anchor: anchorFor(chosen, document), offsetX, offsetY, ...pinPoint(rect, { offsetX, offsetY }) });
  });
  const track = useEffectEvent((eventTarget: EventTarget | null) => {
    const element = eventTarget && (eventTarget as Element).nodeType === 1 ? commentTarget(eventTarget as Element) : null;
    setHovered(element);
  });

  useEffect(() => {
    if (!active || !document) return;
    const element = (event: Event) => (event.target && (event.target as Node).nodeType === 1 ? (event.target as Element) : null);
    const onMove = (event: PointerEvent) => track(event.target);
    const onFocus = (event: FocusEvent) => track(event.target);
    const onClick = (event: MouseEvent) => {
      const chosen = element(event);
      if (!chosen) return;
      // The application never sees the click, and Timing doesn't record it.
      event.preventDefault();
      event.stopPropagation();
      markToolbarEvent(event);
      choose(chosen, { x: event.clientX, y: event.clientY });
    };
    const onKey = (event: KeyboardEvent) => {
      const focused = document.activeElement;
      if (event.key !== "Enter" || !focused || focused === document.body) return;
      event.preventDefault();
      event.stopPropagation();
      markToolbarEvent(event);
      choose(focused, null);
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [active, document]);

  // A draft belongs to the page it was chosen on.
  const page = `${target.changes}`;
  const [draftPage, setDraftPage] = useState(page);
  if (draftPage !== page) {
    setDraftPage(page);
    if (draft) setDraft(null);
  }

  const viewport = target.viewport();
  const hoveredRect = active ? rects.get("__hovered") : undefined;
  const open = comments.openThread ? numbered.find(({ thread }) => thread.id === comments.openThread) : undefined;
  const openRect = open ? rects.get(open.thread.id) : undefined;
  // The draft's point follows its element, as a posted pin does; until it is measured, the point that was chosen.
  const draftRect = draft ? rects.get("__draft") : undefined;
  const draftPoint = draft ? (draftRect ? pinPoint(draftRect, draft) : { x: draft.x, y: draft.y }) : null;

  return (
    <>
      {active && (
        <div className={styles.layer} data-overlay="">
          <Placed preferred={bottomCenter} className={styles.banner} role="status">
            Choose any element to comment on it. Press Esc to cancel.
          </Placed>
          {hoveredRect && <div className={styles.outline} style={{ top: hoveredRect.top, left: hoveredRect.left, width: hoveredRect.width, height: hoveredRect.height }} data-comment-outline="" />}
        </div>
      )}

      <div className={styles.pins}>
        {shown.map(({ thread, number }) => {
          const rect = rects.get(thread.id);
          if (!rect) return null;
          const point = pinPoint(rect, thread);
          // A pin whose element is scrolled out of the frame isn't drawn over the page around it.
          if (!inside(point, viewport)) return null;
          const first = thread.comments[0];
          return (
            <button
              key={thread.id}
              type="button"
              className={styles.pin}
              style={{ top: point.y, left: point.x }}
              aria-label={`Comment ${number} by ${first?.authorName ?? "unknown"}: ${excerpt(commentText(first?.body ?? ""))}`}
              aria-expanded={comments.openThread === thread.id}
              data-comment-pin={number}
              onClick={() => comments.setOpenThread(comments.openThread === thread.id ? null : thread.id)}
            >
              {number}
            </button>
          );
        })}
        {draftPoint && (
          <span className={styles.draftPin} style={{ top: draftPoint.y, left: draftPoint.x }} aria-hidden="true" data-comment-draft-pin="">
            <Icon name="plus" size={14} />
          </span>
        )}
      </div>

      {draft && draftPoint && <Composer draft={draft} at={draftPoint} onClose={() => setDraft(null)} />}
      {open && openRect && open.thread.status === "open" && <ThreadPopover thread={open.thread} number={open.number} at={pinPoint(openRect, open.thread)} />}
    </>
  );
}

/**
 * The composer, beside the "+" marker on the chosen element: a field with
 * the small formatting subset, an Aa control that shows the formatting bar,
 * and a send button. Cmd+Enter or Ctrl+Enter posts.
 */
function Composer({ draft, at, onClose }: { draft: Draft; at: { x: number; y: number }; onClose: () => void }) {
  const comments = useComments();
  const target = useTargetDocument();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [body, setBody] = useState("");
  const [formatting, setFormatting] = useState(false);
  // The selection to restore after a formatting button changes the text.
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const barId = useId();
  const field = () => form.current?.querySelector<HTMLTextAreaElement>("#comment-body") ?? null;

  useEffect(() => {
    form.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  }, []);

  useEffect(() => {
    const textarea = field();
    if (!selection || !textarea) return;
    textarea.focus();
    textarea.setSelectionRange(selection.start, selection.end);
  }, [selection]);

  const format = (marker: string) => {
    const textarea = field();
    if (!textarea) return;
    const next = toggleMarker({ value: body, start: textarea.selectionStart, end: textarea.selectionEnd }, marker);
    setBody(next.value);
    setSelection({ start: next.start, end: next.end });
  };

  return (
    <Placed preferred={beside(at)} className={styles.popoverFrame}>
      <form
        ref={form}
        className={styles.popover}
        role="dialog"
        aria-label="New comment"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            form.current?.requestSubmit();
          }
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!body.trim() || pending) return;
          const data = new FormData(event.currentTarget);
          setPending(true);
          const { x: _x, y: _y, ...place } = draft;
          const outcome = await comments.create({ route: target.route, commit: target.commit, ...place, body, ...(data.has("authorName") ? { authorName: String(data.get("authorName")) } : {}) });
          setPending(false);
          if (outcome.ok) {
            onClose();
            if (outcome.id) comments.setOpenThread(outcome.id);
          } else setErrors(outcome.errors);
        }}
      >
        <p className={styles.popoverMeta}>{`On ${describeAnchor(draft.anchor)} at ${target.route}`}</p>
        {!comments.displayName && <TextInput id="comment-author" name="authorName" label="Your name" description="Shown with your comments." errors={errors.authorName} maxLength={60} required />}
        <TextArea
          id="comment-body"
          name="body"
          label="Comment"
          hideLabel
          placeholder="Start a new thread…"
          description="Use **bold**, *italic*, ~~strikethrough~~, or `code`."
          rows={3}
          errors={errors.body}
          maxLength={2000}
          required
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
        />
        {formatting && (
          <div id={barId} role="group" aria-label="Formatting" className={styles.formatBar}>
            {(
              [
                ["bold", "Bold", FORMAT_MARKERS.bold],
                ["italic", "Italic", FORMAT_MARKERS.italic],
                ["strikethrough", "Strikethrough", FORMAT_MARKERS.strikethrough],
                ["code", "Code", FORMAT_MARKERS.code],
              ] as const
            ).map(([icon, label, marker]) => (
              // Pressing a button keeps the field's focus and selection, so the format applies where the visitor was.
              <Button key={icon} size="sm" variant="tertiary" icon={icon} label={label} onMouseDown={(event) => event.preventDefault()} onClick={() => format(marker)} />
            ))}
          </div>
        )}
        <div className={styles.composerActions}>
          <button type="button" className={styles.formatToggle} aria-expanded={formatting} aria-controls={formatting ? barId : undefined} aria-label="Formatting" title="Formatting" onClick={() => setFormatting((current) => !current)}>
            <Icon name="textSize" size={16} />
          </button>
          <span className={styles.spacer} />
          <Button size="sm" variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" variant="primary" icon="arrowUp" label="Post comment" disabled={!body.trim() || pending} />
        </div>
      </form>
    </Placed>
  );
}

function ThreadPopover({ thread, number, at }: { thread: PlacedThread; number: number; at: { x: number; y: number } }) {
  const comments = useComments();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  return (
    <Placed preferred={beside(at)} className={styles.popoverFrame}>
      <div
        className={styles.popover}
        role="dialog"
        aria-label={`Comment ${number}`}
        data-thread-popover={thread.id}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            comments.setOpenThread(null);
          }
        }}
      >
        <div className={styles.threadHeader}>
          <h2 className={styles.threadTitle}>{`Comment ${number}`}</h2>
          <Button size="sm" onClick={() => void comments.setStatus(thread.id, "resolved").then(() => comments.setOpenThread(null))}>
            Resolve thread
          </Button>
          <Button size="sm" variant="tertiary" icon="x" label="Close comment" onClick={() => comments.setOpenThread(null)} />
        </div>
        <ol className={styles.threadComments}>
          {thread.comments.map((comment) => (
            <li key={comment.id} className={styles.comment}>
              <p className={styles.commentMeta}>
                <strong>{comment.authorName}</strong> <RelativeTime value={new Date(comment.createdAt)} />
              </p>
              <p className={styles.commentBody}>
                <CommentBody body={comment.body} />
              </p>
            </li>
          ))}
        </ol>
        <form
          className={styles.reply}
          onSubmit={async (event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const data = new FormData(formElement);
            setPending(true);
            const outcome = await comments.reply(thread.id, String(data.get("body") ?? ""), data.has("authorName") ? String(data.get("authorName")) : undefined);
            setPending(false);
            if (outcome.ok) {
              formElement.reset();
              setErrors({});
            } else setErrors(outcome.errors);
          }}
        >
          {!comments.displayName && <TextInput id={`reply-author-${thread.id}`} name="authorName" label="Your name" errors={errors.authorName} maxLength={60} required />}
          <TextArea id={`reply-${thread.id}`} name="body" label="Reply" rows={2} errors={errors.body} maxLength={2000} required />
          <div className={styles.popoverActions}>
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              Post reply
            </Button>
          </div>
        </form>
      </div>
    </Placed>
  );
}
