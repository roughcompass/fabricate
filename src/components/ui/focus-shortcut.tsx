"use client";

import { useEffect } from "react";

/**
 * Moves focus to the element with +targetId+ when +shortcut+ is pressed
 * outside a text field, as `/` focuses a page's search. It renders nothing;
 * without JavaScript there's no shortcut, and the field is reached as usual.
 */
export function FocusShortcut({ targetId, shortcut = "/" }: { targetId: string; shortcut?: string }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== shortcut || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.isContentEditable || active.closest("input, textarea, select, [contenteditable='true']"))) return;
      const target = document.getElementById(targetId);
      if (!(target instanceof HTMLInputElement)) return;
      event.preventDefault();
      target.focus();
      target.select();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [targetId, shortcut]);
  return null;
}
