"use client";

import { useEffect, useState } from "react";
import type { BuildComposition } from "@/lib/applications/composition";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { HintState } from "@/lib/workspaces/hints";
import { routes } from "@/lib/web/routes";
import { ApplicationToolbar } from "./application-toolbar";
import type { SessionStart } from "./session/session-state";
import { workspaceThreadStore } from "./comments/thread-store";
import { TargetFrame, useTargetDocument } from "./target-document";
import type { MenuContext } from "./toolbar-menu";
import { type SharedStart, viewKey } from "./view-context";
import styles from "./running-application.module.css";

/**
 * A running application: its build's page in a full-viewport, same-origin
 * frame, with the toolbar above it (add-applications, design decision 5).
 * +src+ is the address the frame opens first, under +base+, where the build
 * is served. The page's own address follows the frame's route, so reloading
 * opens the same route and sharing captures it.
 *
 * Comment threads are the visitor's workspace's, or, when +share+ is the
 * token of the share link that opened this view, the sharer's. A +notice+,
 * such as that the shared commit's build is gone, shows above the
 * application until it's dismissed. +hints+ is the workspace's guided-hint
 * state. +preview+ is the key of the saved preview shown, which the address
 * keeps as `/run/<slug>@<key>`, or null for the tracked branch, which
 * +trackedBranch+ names. +composition+ is what the Profile of the build's
 * commit says it's composed of, and +session+ the application's session
 * presets with the one the visitor starts it with.
 */
export function RunningApplication(props: { slug: string; preview: string | null; trackedBranch: string; src: string; base: string; commit: string; title: string; context: MenuContext; share: string | null; notice: string | null; hints: HintState; composition: BuildComposition; session: SessionStart; shared: SharedStart | null }) {
  const { slug, preview, trackedBranch, src, base, commit, title, context, share, notice, hints, composition, session, shared } = props;
  const [store] = useState(() => workspaceThreadStore(slug, share, preview));
  const [view] = useState(() => ({ slug, name: context.name, preview, key: viewKey(slug, preview), composition, shared }));
  return (
    <TargetFrame src={src} base={base} commit={commit} title={title} className={styles.frame}>
      <FollowRoute slug={slug} preview={preview} />
      {notice && <Notice text={notice} />}
      <ApplicationToolbar slug={slug} preview={preview} trackedBranch={trackedBranch} share={share} context={context} store={store} hints={hints} view={view} session={session} />
    </TargetFrame>
  );
}

/**
 * Keeps the page's address in step with the route and query the frame shows,
 * replacing the history entry rather than adding one: the frame's own
 * history already has an entry for each of its navigations. A share link's
 * token stays, and so does a saved preview's `@<key>`.
 */
function FollowRoute({ slug, preview }: { slug: string; preview: string | null }) {
  const { route, search, state } = useTargetDocument();
  useEffect(() => {
    if (state !== "ready") return;
    const share = new URLSearchParams(window.location.search).get("share");
    const address = routes.runningApplication(slug, `${route}${search}`, { share }, preview);
    if (`${window.location.pathname}${window.location.search}` !== address) window.history.replaceState(null, "", address);
  }, [slug, preview, route, search, state]);
  return null;
}

/** A notice about the build shown, above the application's top left, clear of the toolbar, until it's dismissed. */
function Notice({ text }: { text: string }) {
  const [shown, setShown] = useState(true);
  if (!shown) return null;
  return (
    <div className={styles.notice} data-run-notice="">
      <Alert
        tone="warning"
        title={text}
        live
        actions={
          <Button size="sm" variant="tertiary" onClick={() => setShown(false)}>
            Dismiss
          </Button>
        }
      />
    </div>
  );
}
