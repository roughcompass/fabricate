"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formStyles } from "@/components/ui/form";
import { RelativeTime } from "@/components/ui/relative-time";
import { CommentBody } from "@/components/toolbar/comments/comment-body";
import styles from "@/components/toolbar/comments/comments.module.css";
import { useTargetDocument } from "../target-document";
import { ToolPanel } from "../tool-panel";
import { useToolbar } from "../toolbar-context";
import { describeAnchor, findAnchored } from "./element-anchor";
import { routes } from "@/lib/web/routes";
import { onThisPreview, useComments } from "./comments-state";
import type { PlacedThread } from "./thread-store";

/** A commit as the interface shows it. */
const short = (commit: string) => commit.slice(0, 12);

/**
 * The comments list: open and resolved threads with their author, time,
 * excerpt, and location, which is the route and the commit each was placed
 * on. A thread whose element isn't in the current view is listed as not
 * visible in this view; when it belongs to another route, Go to comment opens
 * that route, where its pin shows if the element is there. A thread placed on
 * another preview, the tracked branch or a saved preview, names its branch or
 * tag, and Go to comment opens that preview at the thread's route; a thread
 * whose saved preview was removed says so.
 */
export function CommentsPanel() {
  const comments = useComments();
  const target = useTargetDocument();
  const { setMode, closeTool } = useToolbar();
  const [show, setShow] = useState<"open" | "resolved">("open");
  // Why the thread last reopened couldn't be, such as the workspace's open-thread limit.
  const [refused, setRefused] = useState<{ id: string; message: string } | null>(null);

  const reopen = (thread: PlacedThread) =>
    void comments.setStatus(thread.id, "open").then((outcome) => setRefused(outcome.ok ? null : { id: thread.id, message: Object.values(outcome.errors).flat().join(" ") || "The thread could not be reopened. Try again." }));
  const numbered = comments.threads.map((thread, index) => ({ thread, number: index + 1 }));
  const listed = numbered.filter(({ thread }) => thread.status === show);
  const openCount = numbered.filter(({ thread }) => thread.status === "open").length;
  const resolvedCount = comments.threads.length - openCount;

  const { scope } = comments;
  const elementOf = (thread: PlacedThread) => (onThisPreview(thread, scope) && thread.route === target.route && target.document ? findAnchored(target.document, thread.anchor) : null);
  /** Where a thread on another preview was placed, as the list names it; null for one on the preview shown. */
  const elsewhere = (thread: PlacedThread) => {
    if (onThisPreview(thread, scope)) return null;
    if (!thread.preview) return `On ${scope.tracked}`;
    const label = thread.preview.ref.replace(/^refs\/(heads|tags)\//, "");
    return thread.preview.key === null ? `On ${label}, a saved preview since removed` : `On ${label}`;
  };

  const reveal = (thread: PlacedThread) => {
    closeTool();
    window.requestAnimationFrame(() => {
      elementOf(thread)?.scrollIntoView({ block: "center" });
      comments.setOpenThread(thread.id);
    });
  };

  const goTo = (thread: PlacedThread) => {
    closeTool();
    // Another preview runs at its own address: the tracked branch's, or the saved preview's.
    if (!onThisPreview(thread, scope)) {
      window.location.assign(routes.runningApplication(scope.slug, thread.route, { share: scope.share }, thread.preview?.key ?? null));
      return;
    }
    comments.setOpenThread(thread.id);
    target.navigate(thread.route);
  };

  return (
    <ToolPanel
      title="Comments"
      description={`${openCount} open · ${resolvedCount} resolved`}
      actions={
        <Button
          size="sm"
          variant="primary"
          icon="plus"
          onClick={() => {
            closeTool();
            setMode("comment");
          }}
        >
          Add comment
        </Button>
      }
    >
      <div className={styles.tabs} role="group" aria-label="Show threads">
        <Button size="sm" variant={show === "open" ? "secondary" : "tertiary"} aria-pressed={show === "open"} onClick={() => setShow("open")}>
          {`Open (${openCount})`}
        </Button>
        <Button size="sm" variant={show === "resolved" ? "secondary" : "tertiary"} aria-pressed={show === "resolved"} onClick={() => setShow("resolved")}>
          {`Resolved (${resolvedCount})`}
        </Button>
      </div>
      {!comments.loaded ? (
        <p className={styles.muted}>Loading comments…</p>
      ) : listed.length === 0 ? (
        <p className={styles.muted}>{show === "open" ? "No open comments. Choose Add comment, then any element on the page." : "No resolved comments."}</p>
      ) : (
        <ol className={styles.threadList} aria-label={show === "open" ? "Open comments" : "Resolved comments"}>
          {listed.map(({ thread, number }) => {
            const first = thread.comments[0]!;
            const here = elementOf(thread) !== null;
            const placed = elsewhere(thread);
            const removed = thread.preview !== null && thread.preview.key === null;
            const location = `${placed ? `${placed} · ` : ""}${thread.route} · ${describeAnchor(thread.anchor)} · Commit ${short(thread.commit)}`;
            return (
              <li key={thread.id} className={styles.threadItem} data-thread={thread.id} data-visible={here || undefined}>
                <p className={styles.commentMeta}>
                  <span className={styles.number}>{number}</span>
                  <strong>{first.authorName}</strong> <RelativeTime value={new Date(first.createdAt)} />
                  {thread.comments.length > 1 && <span>{` · ${thread.comments.length - 1} ${thread.comments.length === 2 ? "reply" : "replies"}`}</span>}
                </p>
                <p className={styles.commentBody}>
                  <CommentBody body={first.body} />
                </p>
                <p className={styles.location}>{here || thread.status === "resolved" ? location : `Not visible in this view · ${location}`}</p>
                <div className={styles.popoverActions}>
                  {thread.status === "resolved" ? (
                    <Button size="sm" onClick={() => reopen(thread)}>
                      Reopen thread
                    </Button>
                  ) : here ? (
                    <Button size="sm" onClick={() => reveal(thread)}>
                      Show comment
                    </Button>
                  ) : !removed && (placed || thread.route !== target.route) ? (
                    <Button size="sm" onClick={() => goTo(thread)}>
                      Go to comment
                    </Button>
                  ) : null}
                </div>
                {refused?.id === thread.id && (
                  <p className={formStyles.error} role="alert">
                    {refused.message}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </ToolPanel>
  );
}
