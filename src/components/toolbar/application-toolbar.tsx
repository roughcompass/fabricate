"use client";

import { Alert } from "@/components/ui/alert";
import type { HintState } from "@/lib/demo/hints";
import { AccessibilityPanel } from "./accessibility/accessibility-panel";
import { AuditOverlay } from "./accessibility/audit-overlay";
import { AuditProvider } from "./accessibility/audit-state";
import { CommentLayer } from "./comments/comment-layer";
import { CommentsPanel } from "./comments/comments-panel";
import { CommentsProvider, useComments } from "./comments/comments-state";
import type { ThreadStore } from "./comments/thread-store";
import { GuidedHints, HintsContext, RUNTIME_HINTS, useHintControls } from "./guided-hints";
import { SharePanel } from "./share-panel";
import { useTargetDocument } from "./target-document";
import { TimingPanel } from "./timing/timing-panel";
import { TimingProvider } from "./timing/timing-state";
import { Toolbar } from "./toolbar";
import type { MenuContext } from "./toolbar-menu";
import styles from "./running-application.module.css";

/**
 * The toolbar over a running application in a frame (add-applications,
 * design decisions 5 and 6), with the tools that inspect the frame's own
 * page: Comment and Comments, Accessibility, and Timing; Share, for the
 * application +slug+ in the view the share link +share+ opened, if any; and
 * the guided hints that point to them, from the workspace's +hints+ state. It
 * needs to read the page, so when the frame isn't same-origin it says so and
 * doesn't start.
 */
export function ApplicationToolbar({ slug, share, context, store, hints }: { slug: string; share: string | null; context: MenuContext; store: ThreadStore; hints: HintState }) {
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
          <Tools context={context} hints={hints} share={<SharePanel slug={slug} name={context.name} share={share} />} />
        </TimingProvider>
      </AuditProvider>
    </CommentsProvider>
  );
}

function Tools({ context, hints: initial, share }: { context: MenuContext; hints: HintState; share: React.ReactNode }) {
  const comments = useComments();
  const hints = useHintControls(initial);
  return (
    <HintsContext value={hints}>
      <Toolbar
        context={context}
        commentCount={comments.threads.filter((thread) => thread.status === "open").length}
        panels={{ comments: <CommentsPanel />, share, accessibility: <AccessibilityPanel />, timing: <TimingPanel /> }}
        overlays={
          <>
            <AuditOverlay />
            <CommentLayer />
            <GuidedHints sequence="runtime" hints={RUNTIME_HINTS} controls={hints} />
          </>
        }
      />
    </HintsContext>
  );
}
