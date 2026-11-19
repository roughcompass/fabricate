"use client";

import { useEffect, useState } from "react";
import { routes } from "@/lib/web/routes";
import { ApplicationToolbar } from "./application-toolbar";
import { sessionThreadStore } from "./comments/thread-store";
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
 * Comment threads are kept in the browser tab under +threadsKey+ until the
 * workspace's threads take a commit and an element anchor; that store then
 * replaces sessionThreadStore here.
 */
export function RunningApplication({ slug, src, base, commit, title, context, threadsKey }: { slug: string; src: string; base: string; commit: string; title: string; context: MenuContext; threadsKey: string }) {
  const [store] = useState(() => sessionThreadStore(threadsKey));
  return (
    <TargetFrame src={src} base={base} commit={commit} title={title} className={styles.frame}>
      <FollowRoute slug={slug} />
      <ApplicationToolbar context={context} store={store} />
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
