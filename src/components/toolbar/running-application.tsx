"use client";

import { useState } from "react";
import { ApplicationToolbar } from "./application-toolbar";
import { sessionThreadStore } from "./comments/thread-store";
import { TargetFrame } from "./target-document";
import type { MenuContext } from "./toolbar-menu";
import styles from "./running-application.module.css";

/**
 * A running application: its build's page in a full-viewport, same-origin
 * frame, with the toolbar above it (add-applications, design decision 5).
 * +src+ is the address the frame opens first, under +base+, where the build
 * is served.
 *
 * Comment threads are kept in the browser tab under +threadsKey+ until the
 * workspace's threads take a commit and an element anchor; that store then
 * replaces sessionThreadStore here.
 */
export function RunningApplication({ src, base, commit, title, context, threadsKey }: { src: string; base: string; commit: string; title: string; context: MenuContext; threadsKey: string }) {
  const [store] = useState(() => sessionThreadStore(threadsKey));
  return (
    <TargetFrame src={src} base={base} commit={commit} title={title} className={styles.frame}>
      <ApplicationToolbar context={context} store={store} />
    </TargetFrame>
  );
}
