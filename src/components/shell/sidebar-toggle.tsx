"use client";

import { useSyncExternalStore } from "react";
import { setSidebarVisibility } from "@/app/sidebar-actions";
import { buttonProps } from "@/components/ui/button-content";
import { Icon } from "@/components/ui/icon";
import { SIDEBAR_HIDDEN, SIDEBAR_HIDDEN_COOKIE } from "@/lib/web/sidebar";

const subscribeNever = () => () => {};
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Applies a visibility at once and remembers it, as the Server Action would. */
function apply(to: "hidden" | "shown"): void {
  document.querySelector("[data-sidebar]")?.setAttribute("data-sidebar", to);
  document.cookie = to === SIDEBAR_HIDDEN ? `${SIDEBAR_HIDDEN_COOKIE}=${SIDEBAR_HIDDEN}; path=/; max-age=${ONE_YEAR}; samesite=lax` : `${SIDEBAR_HIDDEN_COOKIE}=; path=/; max-age=0; samesite=lax`;
  // The control that was used disappears; the opposite one takes focus.
  window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-sidebar-toggle="${to === "hidden" ? "shown" : "hidden"}"]`)?.focus());
}

/**
 * Hide sidebar (in the sidebar) or Show sidebar (in the shell header). Before
 * JavaScript runs it submits the Server Action, which sets the cookie and
 * renders the page again; once hydrated it switches the shell in place and
 * writes the same cookie.
 */
export function SidebarToggle({ to }: { to: "hidden" | "shown" }) {
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const label = to === "hidden" ? "Hide sidebar" : "Show sidebar";
  return (
    <form action={setSidebarVisibility}>
      <input type="hidden" name="sidebar" value={to} />
      <button
        type={hydrated ? "button" : "submit"}
        onClick={hydrated ? () => apply(to) : undefined}
        {...buttonProps("tertiary", "md", true)}
        aria-label={label}
        title={label}
        data-sidebar-toggle={to}
      >
        <Icon name="sidebar" />
      </button>
    </form>
  );
}
