"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ToolPanel } from "@/components/toolbar/tool-panel";
import { useToolbar } from "@/components/toolbar/toolbar-context";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { memberById, routeByPath } from "@/lib/demo/catalog";
import type { ThreadRecord } from "@/lib/demo/comments";
import { defaultRouting } from "@/lib/demo/routing";
import { routeHref, useCurrentRoute, useRuntime, useViewState } from "../../runtime/runtime-context";
import { findAnchorElement } from "./anchors";
import { useShell } from "./comment-layer";
import { useComments } from "./comments-state";
import styles from "./comments.module.css";

/**
 * The comments list: open and resolved threads with their author, time,
 * excerpt, and location. A thread whose element is not in the current view
 * offers Go to comment, which navigates to its route and applies its version.
 */
export function CommentsPanel() {
  const comments = useComments();
  const { setMode, closeTool } = useToolbar();
  const { app, descriptor, store } = useRuntime();
  const { overrides } = useViewState();
  const route = useCurrentRoute();
  const shell = useShell();
  const router = useRouter();
  const [show, setShow] = useState<"open" | "resolved">("open");
  const numbered = comments.threads.map((thread, index) => ({ thread, number: index + 1 }));
  const listed = numbered.filter(({ thread }) => thread.status === show);
  const openCount = numbered.filter(({ thread }) => thread.status === "open").length;
  const resolvedCount = comments.threads.length - openCount;

  const visibleHere = (thread: ThreadRecord) => thread.route === route.path && findAnchorElement(thread, shell) !== null;

  const reveal = (thread: ThreadRecord) => {
    closeTool();
    window.requestAnimationFrame(() => {
      findAnchorElement(thread, shell)?.scrollIntoView({ block: "center" });
      comments.setOpenThread(thread.id);
    });
  };

  const goTo = (thread: ThreadRecord) => {
    const member = memberById(app, thread.member);
    if (member) {
      const fallback = defaultRouting(member, descriptor.environment);
      const next = { ...overrides };
      if (thread.memberVersion === fallback.version) delete next[thread.member];
      else next[thread.member] = { version: thread.memberVersion, environment: overrides[thread.member]?.environment ?? fallback.environment };
      store.applyOverrides(next);
    }
    const target = routeByPath(app, thread.route);
    if (target && target.path !== route.path) router.push(routeHref(descriptor, target));
    closeTool();
    comments.setOpenThread(thread.id);
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
            const here = visibleHere(thread);
            const location = `${routeByPath(app, thread.route)?.label ?? thread.route} · ${memberById(app, thread.member)?.name ?? thread.member} ${thread.memberVersion}`;
            return (
              <li key={thread.id} className={styles.threadItem} data-thread={thread.id}>
                <p className={styles.commentMeta}>
                  <span className={styles.number}>{number}</span>
                  <strong>{first.authorName}</strong> <RelativeTime value={new Date(first.createdAt)} />
                  {thread.comments.length > 1 && <span>{` · ${thread.comments.length - 1} ${thread.comments.length === 2 ? "reply" : "replies"}`}</span>}
                </p>
                <p className={styles.commentBody}>{first.body}</p>
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
                  ) : (
                    <Button size="sm" onClick={() => goTo(thread)}>
                      Go to comment
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </ToolPanel>
  );
}
