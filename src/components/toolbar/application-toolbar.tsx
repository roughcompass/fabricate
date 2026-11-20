"use client";

import { Alert } from "@/components/ui/alert";
import type { HintState } from "@/lib/workspaces/hints";
import { AccessibilityPanel } from "./accessibility/accessibility-panel";
import { AuditOverlay } from "./accessibility/audit-overlay";
import { AuditProvider } from "./accessibility/audit-state";
import { CommentLayer } from "./comments/comment-layer";
import { CommentsPanel } from "./comments/comments-panel";
import { CommentsProvider, useComments } from "./comments/comments-state";
import type { ThreadStore } from "./comments/thread-store";
import { GuidedHints, HintsContext, RUNTIME_HINTS, useHintControls } from "./guided-hints";
import { MicrofrontendsPanel } from "./microfrontends/microfrontends-panel";
import { MicrofrontendsProvider } from "./microfrontends/microfrontends-state";
import { RegionsOverlay } from "./microfrontends/regions-overlay";
import { SessionPanel } from "./session/session-panel";
import { type SessionStart, SessionProvider } from "./session/session-state";
import { SettingsPanel } from "./settings/settings-panel";
import { SettingsProvider } from "./settings/settings-state";
import { SharePanel } from "./share-panel";
import { useTargetDocument } from "./target-document";
import { HotSpotsOverlay } from "./timing/hot-spots-overlay";
import { TimingPanel } from "./timing/timing-panel";
import { TimingProvider } from "./timing/timing-state";
import { Toolbar } from "./toolbar";
import type { MenuContext } from "./toolbar-menu";
import { type ToolbarView, ToolbarViewContext } from "./view-context";
import styles from "./running-application.module.css";

/**
 * The toolbar over a running application in a frame (add-applications,
 * design decisions 5 and 6), with the tools that inspect the frame's own
 * page: Comment and Comments, Accessibility, and Timing; Share, for the
 * application +slug+, or its saved preview +preview+ (+trackedBranch+ names
 * the tracked branch's threads seen from one), in the view the share link
 * +share+ opened, if any; and the guided hints that point to them, from the
 * workspace's +hints+ state. Microfrontends
 * (restore-toolbar-tools-and-branch-previews) lists what the +view+ is
 * composed of and routes its microfrontends, Session starts it with one of
 * its +session+ presets, and Settings switches its theme and logs the page's
 * event bus. It needs to read the page, so when the frame isn't same-origin
 * it says so and doesn't start.
 */
export function ApplicationToolbar({ slug, preview, trackedBranch, share, context, store, hints, view, session }: { slug: string; preview: string | null; trackedBranch: string; share: string | null; context: MenuContext; store: ThreadStore; hints: HintState; view: ToolbarView; session: SessionStart }) {
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
    <ToolbarViewContext value={view}>
      <CommentsProvider store={store} scope={{ slug, preview, tracked: trackedBranch, share }}>
        <AuditProvider>
          <TimingProvider>
            <SettingsProvider>
              <MicrofrontendsProvider>
                <SessionProvider start={session}>
                  <Tools context={context} hints={hints} share={<SharePanel slug={slug} preview={preview} name={preview ? `${context.name} (${context.branch})` : context.name} share={share} />} />
                </SessionProvider>
              </MicrofrontendsProvider>
            </SettingsProvider>
          </TimingProvider>
        </AuditProvider>
      </CommentsProvider>
    </ToolbarViewContext>
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
        panels={{ comments: <CommentsPanel />, share, microfrontends: <MicrofrontendsPanel />, accessibility: <AccessibilityPanel />, timing: <TimingPanel />, session: <SessionPanel />, settings: <SettingsPanel /> }}
        overlays={
          <>
            <AuditOverlay />
            <HotSpotsOverlay />
            <RegionsOverlay />
            <CommentLayer />
            <GuidedHints sequence="runtime" hints={RUNTIME_HINTS} controls={hints} />
          </>
        }
      />
    </HintsContext>
  );
}
