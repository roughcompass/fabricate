"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { CommentBody } from "@/demo/toolbar/comments/comment-body";
import styles from "@/demo/toolbar/comments/comments.module.css";
import { useTargetDocument } from "../target-document";
import { ToolPanel } from "../tool-panel";
import { useToolbar } from "../toolbar-context";
import { describeAnchor, findAnchored } from "./element-anchor";
import { useComments } from "./comments-state";
import type { PlacedThread } from "./thread-store";

/** A commit as the interface shows it. */
const short = (commit: string) => commit.slice(0, 12);

/**
 * The comments list: open and resolved threads with their author, time,
 * excerpt, and location, which is the route and the commit each was placed
 * on. A thread whose element isn't in the current view is listed as not
 * visible in this view; when it belongs to another route, Go to comment opens
 * that route, where its pin shows if the element is there.
 */
export function CommentsPanel() {
  const comments = useComments();
  const target = useTargetDocument();
  const { setMode, closeTool } = useToolbar();
  const [show, setShow] = useState<"open" | "resolved">("open");
  const numbered = comments.threads.map((thread, index) => ({ thread, number: index + 1 }));
  const listed = numbered.filter(({ thread }) => thread.status === show);
  const openCount = numbered.filter(({ thread }) => thread.status === "open").length;
  const resolvedCount = comments.threads.length - openCount;

  const elementOf = (thread: PlacedThread) => (thread.route === target.route && target.document ? findAnchored(target.document, thread.anchor) : null);

  const reveal = (thread: PlacedThread) => {
    closeTool();
    window.requestAnimationFrame(() => {
      elementOf(thread)?.scrollIntoView({ block: "center" });
      comments.setOpenThread(thread.id);
    });
  };

  const goTo = (thread: PlacedThread) => {
    closeTool();
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
            const location = `${thread.route} · ${describeAnchor(thread.anchor)} · Commit ${short(thread.commit)}`;
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
                    <Button size="sm" onClick={() => void comments.setStatus(thread.id, "open")}>
                      Reopen thread
                    </Button>
                  ) : here ? (
                    <Button size="sm" onClick={() => reveal(thread)}>
                      Show comment
                    </Button>
                  ) : thread.route !== target.route ? (
                    <Button size="sm" onClick={() => goTo(thread)}>
                      Go to comment
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </ToolPanel>
  );
}
