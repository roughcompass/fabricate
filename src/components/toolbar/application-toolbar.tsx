"use client";

import { Alert } from "@/components/ui/alert";
import { AccessibilityPanel } from "./accessibility/accessibility-panel";
import { AuditOverlay } from "./accessibility/audit-overlay";
import { AuditProvider } from "./accessibility/audit-state";
import { CommentLayer } from "./comments/comment-layer";
import { CommentsPanel } from "./comments/comments-panel";
import { CommentsProvider, useComments } from "./comments/comments-state";
import type { ThreadStore } from "./comments/thread-store";
import { DemoToolbar } from "./demo-toolbar";
import { useTargetDocument } from "./target-document";
import { TimingPanel } from "./timing/timing-panel";
import { TimingProvider } from "./timing/timing-state";
import type { MenuContext } from "./toolbar-menu";
import styles from "./running-application.module.css";

/**
 * The toolbar over a running application in a frame (add-applications,
 * design decisions 5 and 6), with the tools that inspect the frame's own
 * page: Comment and Comments, Accessibility, and Timing. It needs to read the
 * page, so when the frame isn't same-origin it says so and doesn't start.
 */
export function ApplicationToolbar({ context, store }: { context: MenuContext; store: ThreadStore }) {
  const target = useTargetDocument();
  if (target.state === "unreadable")
    return (
      <div className={styles.unreadable}>
        <Alert tone="error" title="The toolbar can't inspect this application" live>
          Its page isn&apos;t served from the Frontend Registry&apos;s own origin, so the toolbar&apos;s tools can&apos;t read it.
        </Alert>
      </div>
    );
  return (
    <CommentsProvider store={store}>
      <AuditProvider>
        <TimingProvider>
          <Toolbar context={context} />
        </TimingProvider>
      </AuditProvider>
    </CommentsProvider>
  );
}

function Toolbar({ context }: { context: MenuContext }) {
  const comments = useComments();
  return (
    <DemoToolbar
      context={context}
      commentCount={comments.threads.filter((thread) => thread.status === "open").length}
      panels={{ comments: <CommentsPanel />, accessibility: <AccessibilityPanel />, timing: <TimingPanel /> }}
      overlays={
        <>
          <AuditOverlay />
          <CommentLayer />
        </>
      }
    />
  );
}
