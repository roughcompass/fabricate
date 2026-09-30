"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { Icon, type IconName } from "./icon";
import { type ToastAction, type ToastTone, useToast } from "./toast";
import styles from "./flash-toast.module.css";

export interface Outcome {
  /** Identifies the event, such as "added:src_abc". */
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: Pick<ToastAction, "label" | "href">;
}

const subscribeNever = () => () => {};
const ICONS: Record<ToastTone, IconName> = { success: "checkCircle", info: "info", warning: "alert", error: "xCircle" };

/**
 * Shows an action's outcome once. The server renders it as a toast in the
 * toast position, so it is visible on first paint and without JavaScript; once
 * hydrated it hands over to the live toast and removes the outcome parameters
 * from the address, so a reload, Back, a background refresh, or a copied link
 * never shows it again.
 */
export function FlashToast({ outcome, strip }: { outcome: Outcome; strip: readonly string[] }) {
  const { toast } = useToast();
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);

  useLayoutEffect(() => {
    toast(outcome);
    const url = new URL(window.location.href);
    for (const name of strip) url.searchParams.delete(name);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    // Runs once per outcome; the provider ignores a toast whose id is already showing.
  }, [outcome.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (hydrated) return null;
  return (
    <div className={styles.viewport}>
      <div className={styles.static} data-tone={outcome.tone} role="status">
        <Icon name={ICONS[outcome.tone]} className={styles.icon} />
        <div className={styles.body}>
          <p className={styles.title}>{outcome.title}</p>
          {outcome.description && <p className={styles.description}>{outcome.description}</p>}
        </div>
      </div>
    </div>
  );
}
