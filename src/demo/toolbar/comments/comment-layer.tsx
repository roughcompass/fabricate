"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { useToolbar } from "@/components/toolbar/toolbar-context";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TextArea, TextInput } from "@/components/ui/form";
import { RelativeTime } from "@/components/ui/relative-time";
import { memberById, shellOf } from "@/lib/demo/catalog";
import { FORMAT_MARKERS, commentText, toggleMarker } from "@/lib/demo/comment-format";
import type { ThreadRecord } from "@/lib/demo/comments";
import { useCurrentRoute, useRouting, useRuntime } from "../../runtime/runtime-context";
import { type Rect, useTrackedRects } from "../geometry";
import { Placed, type Preferred, bottomCenter } from "../placed";
import { type Placement, type Shell, anchorElementFor, findAnchorElement, placementFor } from "./anchors";
import { CommentBody } from "./comment-body";
import { type FieldErrors, useComments } from "./comments-state";
import styles from "./comments.module.css";

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

export function useShell(): Shell {
  const { app } = useRuntime();
  const routing = useRouting();
  const shell = shellOf(app);
  return { id: shell.id, version: routing[shell.id]!.version };
}

/** The pin position of a thread: its anchor's rect at the saved fractional offset. */
function pinPoint(rect: Rect, thread: Pick<ThreadRecord, "offsetX" | "offsetY">) {
  return { x: rect.left + thread.offsetX * rect.width, y: rect.top + thread.offsetY * rect.height };
}

/**
 * Comments on the running application: comment mode (outline the element
 * under the pointer or focus, choose one to comment on), the composer, a
 * numbered pin for each open thread shown in this view, and the open thread.
 */
export function CommentLayer() {
  const { mode, setMode } = useToolbar();
  const comments = useComments();
  const route = useCurrentRoute();
  const shell = useShell();
  const active = mode === "comment";
  const [hovered, setHovered] = useState<Element | null>(null);
  const [draft, setDraft] = useState<{ placement: Placement; x: number; y: number } | null>(null);

  // Open threads attached to elements in this view, numbered by age across the whole view.
  const numbered = comments.threads.map((thread, index) => ({ thread, number: index + 1 }));
  const shown = numbered.filter(({ thread }) => thread.status === "open" && thread.route === route.path);
  const rects = useTrackedRects(
    () => {
      const elements = new Map<string, Element>();
      for (const { thread } of shown) {
        const element = findAnchorElement(thread, shell);
        if (element) elements.set(thread.id, element);
      }
      if (hovered) elements.set("__hovered", hovered);
      const drafted = draft && findAnchorElement(draft.placement, shell);
      if (drafted) elements.set("__draft", drafted);
      return elements;
    },
    true,
    `${shown.map(({ thread }) => thread.id).join(",")}|${hovered ? "h" : ""}|${draft ? `${draft.placement.member}:${draft.placement.anchor}` : ""}|${route.path}|${shell.version}`,
  );

  const choose = useEffectEvent((element: Element, point: { x: number; y: number } | null) => {
    const placement = placementFor(element, point, shell);
    if (!placement) return;
    const rect = anchorElementFor(element)!.getBoundingClientRect();
    const at = point ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setMode("none");
    setHovered(null);
    comments.setOpenThread(null);
    setDraft({ placement, ...at });
  });
  const track = useEffectEvent((target: EventTarget | null) => {
    const element = target instanceof Element ? anchorElementFor(target) : null;
    setHovered(element);
  });

  useEffect(() => {
    if (!active) return;
    const onMove = (event: PointerEvent) => track(event.target);
    const onFocus = (event: FocusEvent) => track(event.target);
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!anchorElementFor(target)) return;
      event.preventDefault();
      event.stopPropagation();
      choose(target, { x: event.clientX, y: event.clientY });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !document.activeElement || !anchorElementFor(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      choose(document.activeElement, null);
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
  }, [active]);

  const hoveredRect = active ? rects.get("__hovered") : undefined;
  const open = comments.openThread ? numbered.find(({ thread }) => thread.id === comments.openThread) : undefined;
  const openRect = open ? rects.get(open.thread.id) : undefined;
  // The draft's point follows its element, as a posted pin does; until it is measured, the point that was chosen.
  const draftRect = draft ? rects.get("__draft") : undefined;
  const draftPoint = draft ? (draftRect ? pinPoint(draftRect, draft.placement) : { x: draft.x, y: draft.y }) : null;

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
function Composer({ draft, at, onClose }: { draft: { placement: Placement }; at: { x: number; y: number }; onClose: () => void }) {
  const comments = useComments();
  const route = useCurrentRoute();
  const { app } = useRuntime();
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
          const outcome = await comments.create({ route: route.path, ...draft.placement, body, ...(data.has("authorName") ? { authorName: String(data.get("authorName")) } : {}) });
          setPending(false);
          if (outcome.ok) {
            onClose();
            if (outcome.id) comments.setOpenThread(outcome.id);
          } else setErrors(outcome.errors);
        }}
      >
        <p className={styles.popoverMeta}>{`On ${memberById(app, draft.placement.member)?.name ?? draft.placement.member} ${draft.placement.memberVersion}`}</p>
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

function ThreadPopover({ thread, number, at }: { thread: ThreadRecord; number: number; at: { x: number; y: number } }) {
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

