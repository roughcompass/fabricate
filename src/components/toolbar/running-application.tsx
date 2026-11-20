"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { HintState } from "@/lib/demo/hints";
import { routes } from "@/lib/web/routes";
import { ApplicationToolbar } from "./application-toolbar";
import { workspaceThreadStore } from "./comments/thread-store";
import { TargetFrame, useTargetDocument } from "./target-document";
import type { MenuContext } from "./toolbar-menu";
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
 * state.
 */
export function RunningApplication(props: { slug: string; src: string; base: string; commit: string; title: string; context: MenuContext; share: string | null; notice: string | null; hints: HintState }) {
  const { slug, src, base, commit, title, context, share, notice, hints } = props;
  const [store] = useState(() => workspaceThreadStore(slug, share));
  return (
    <TargetFrame src={src} base={base} commit={commit} title={title} className={styles.frame}>
      <FollowRoute slug={slug} />
      {notice && <Notice text={notice} />}
      <ApplicationToolbar slug={slug} share={share} context={context} store={store} hints={hints} />
    </TargetFrame>
  );
}

/**
 * Keeps the page's address in step with the route the frame shows, replacing
 * the history entry rather than adding one: the frame's own history already
 * has an entry for each of its navigations. The query, such as a share
 * link's token, stays.
 */
function FollowRoute({ slug }: { slug: string }) {
  const { route, state } = useTargetDocument();
  useEffect(() => {
    if (state !== "ready") return;
    const address = `${routes.runningApplication(slug, route)}${window.location.search}`;
    if (`${window.location.pathname}${window.location.search}` !== address) window.history.replaceState(null, "", address);
  }, [slug, route, state]);
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
