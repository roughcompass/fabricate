"use client";

import { Alert } from "@/components/ui/alert";
import type { HintState } from "@/lib/workspaces/hints";
import { AccessibilityPanel } from "./accessibility/accessibility-panel";
import { AuditOverlay } from "./accessibility/audit-overlay";
import { AuditProvider } from "./accessibility/audit-state";
import { CommentLayer } from "./comments/comment-layer";
import { CommentsPanel } from "./comments/comments-panel";
import { CommentsProvider, useComments } from "./comments/comments-state";
import { DataPanel } from "./data/data-panel";
import { type MocksStart, DataProvider, useData } from "./data/data-state";
import type { ThreadStore } from "./comments/thread-store";
import { GuidedHints, HintsContext, RUNTIME_HINTS, useHintControls } from "./guided-hints";
import { MicrofrontendsPanel } from "./microfrontends/microfrontends-panel";
import { MicrofrontendsProvider } from "./microfrontends/microfrontends-state";
import { RegionsOverlay } from "./microfrontends/regions-overlay";
import { ViewWorkerProvider } from "./routing/view-worker-state";
import { SessionPanel } from "./session/session-panel";
import { type SessionStart, SessionProvider } from "./session/session-state";
import { SettingsPanel } from "./settings/settings-panel";
import { SettingsProvider } from "./settings/settings-state";
import { SharePanel } from "./share-panel";
import { useTargetDocument } from "./target-document";
import { HotSpotsOverlay } from "./timing/hot-spots-overlay";
import { TimingPanel } from "./timing/timing-panel";
import { TimingProvider } from "./timing/timing-state";
import { type RestingItem, Toolbar } from "./toolbar";
import { itemById } from "./toolbar-context";
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
 * composed of and routes its microfrontends, through the view's worker
 * (add-mock-sets, design decision 2), Session starts it with one of its
 * +session+ presets, and Settings switches its theme and logs the page's
 * event bus. It needs to read the page, so when the frame isn't same-origin
 * it says so and doesn't start.
 */
export function ApplicationToolbar({ slug, preview, trackedBranch, share, context, store, hints, view, session, mocks }: { slug: string; preview: string | null; trackedBranch: string; share: string | null; context: MenuContext; store: ThreadStore; hints: HintState; view: ToolbarView; session: SessionStart; mocks: MocksStart }) {
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
              <ViewWorkerProvider share={share}>
                <MicrofrontendsProvider>
                  <DataProvider start={mocks}>
                    <SessionProvider start={session}>
                      <Tools context={context} hints={hints} share={<SharePanel slug={slug} preview={preview} name={preview ? `${context.name} (${context.branch})` : context.name} share={share} />} />
                    </SessionProvider>
                  </DataProvider>
                </MicrofrontendsProvider>
              </ViewWorkerProvider>
            </SettingsProvider>
          </TimingProvider>
        </AuditProvider>
      </CommentsProvider>
    </ToolbarViewContext>
  );
}

/** The pill's Data button at rest, while a mock set applies to the view. */
function useMocksResting(): RestingItem | null {
  const data = useData();
  return data.applies && data.active.set ? { item: itemById("data")!, name: `Data · Mock set: ${data.active.set.name}` } : null;
}

function Tools({ context, hints: initial, share }: { context: MenuContext; hints: HintState; share: React.ReactNode }) {
  const comments = useComments();
  const hints = useHintControls(initial);
  const resting = useMocksResting();
  return (
    <HintsContext value={hints}>
      <Toolbar
        context={context}
        commentCount={comments.threads.filter((thread) => thread.status === "open").length}
        resting={resting}
        panels={{ comments: <CommentsPanel />, share, microfrontends: <MicrofrontendsPanel />, accessibility: <AccessibilityPanel />, timing: <TimingPanel />, session: <SessionPanel />, data: <DataPanel />, settings: <SettingsPanel /> }}
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
