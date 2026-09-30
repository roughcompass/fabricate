"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const subscribeNever = () => () => {};

/**
 * Renders an alert raised by a client component, such as a failed launch, into
 * the page-alert slot below the header, so it never lands inside the header's
 * actions or a table cell.
 */
export function PageAlertPortal({ children }: { children: React.ReactNode }) {
  const slot = useSyncExternalStore(
    subscribeNever,
    () => document.getElementById("page-alerts"),
    () => null,
  );
  return slot ? createPortal(children, slot) : null;
}
