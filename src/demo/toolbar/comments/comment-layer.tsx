"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useToolbar } from "@/components/toolbar/toolbar-context";
import { Button } from "@/components/ui/button";
import { TextArea, TextInput } from "@/components/ui/form";
import { RelativeTime } from "@/components/ui/relative-time";
import { memberById, shellOf } from "@/lib/demo/catalog";
import type { ThreadRecord } from "@/lib/demo/comments";
import { useCurrentRoute, useRouting, useRuntime } from "../../runtime/runtime-context";
import { type Rect, useTrackedRects } from "../geometry";
import { type Placement, type Shell, anchorElementFor, findAnchorElement, placementFor } from "./anchors";
import { type FieldErrors, useComments } from "./comments-state";
import styles from "./comments.module.css";

/** Matches --size-toast, the popover width. */
const POPOVER_WIDTH = 380;
const MARGIN = 12;

/** A popover position beside a point, kept inside the viewport. */
function popoverPosition(x: number, y: number): { top: number; left: number } {
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * MARGIN);
  const left = x + MARGIN + width < window.innerWidth ? x + MARGIN : Math.max(MARGIN, x - MARGIN - width);
  const top = Math.min(Math.max(MARGIN, y - MARGIN), Math.max(MARGIN, window.innerHeight - 320));
  return { top, left };
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
      return elements;
    },
    true,
    `${shown.map(({ thread }) => thread.id).join(",")}|${hovered ? "h" : ""}|${route.path}|${shell.version}`,
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

  return (
    <>
      {active && (
        <div className={styles.layer} data-overlay="">
          <p className={styles.banner} role="status">
            Choose any element to comment on it. Press Esc to cancel.
          </p>
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
              aria-label={`Comment ${number} by ${first?.authorName ?? "unknown"}: ${excerpt(first?.body ?? "")}`}
              aria-expanded={comments.openThread === thread.id}
              data-comment-pin={number}
              onClick={() => comments.setOpenThread(comments.openThread === thread.id ? null : thread.id)}
            >
              {number}
            </button>
          );
        })}
      </div>

      {draft && <Composer draft={draft} onClose={() => setDraft(null)} />}
      {open && openRect && open.thread.status === "open" && <ThreadPopover thread={open.thread} number={open.number} at={pinPoint(openRect, open.thread)} />}
    </>
  );
}

function Composer({ draft, onClose }: { draft: { placement: Placement; x: number; y: number }; onClose: () => void }) {
  const comments = useComments();
  const route = useCurrentRoute();
  const { app } = useRuntime();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const position = popoverPosition(draft.x, draft.y);

  useEffect(() => {
    form.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  }, []);

  return (
    <form
      ref={form}
      className={styles.popover}
      style={position}
      role="dialog"
      aria-label="New comment"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setPending(true);
        const outcome = await comments.create({ route: route.path, ...draft.placement, body: String(data.get("body") ?? ""), ...(data.has("authorName") ? { authorName: String(data.get("authorName")) } : {}) });
        setPending(false);
        if (outcome.ok) {
          onClose();
          if (outcome.id) comments.setOpenThread(outcome.id);
        } else setErrors(outcome.errors);
      }}
    >
      <p className={styles.popoverMeta}>{`On ${memberById(app, draft.placement.member)?.name ?? draft.placement.member} ${draft.placement.memberVersion}`}</p>
      {!comments.displayName && <TextInput id="comment-author" name="authorName" label="Your name" description="Shown with your comments." errors={errors.authorName} maxLength={60} required />}
      <TextArea id="comment-body" name="body" label="Comment" rows={3} errors={errors.body} maxLength={2000} required />
      <div className={styles.popoverActions}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={pending}>
          Post comment
        </Button>
      </div>
    </form>
  );
}

function ThreadPopover({ thread, number, at }: { thread: ThreadRecord; number: number; at: { x: number; y: number } }) {
  const comments = useComments();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const position = popoverPosition(at.x, at.y);

  return (
    <div
      className={styles.popover}
      style={position}
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
            <p className={styles.commentBody}>{comment.body}</p>
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
  );
}

