"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DetailSkeleton, FocusedSkeleton, FormSkeleton, HomeSkeleton, ListSkeleton } from "@/components/ui/skeleton";
import { type SkeletonKind, skeletonFor } from "./skeleton-routes";

const SKELETONS: Record<SkeletonKind, () => React.ReactNode> = { home: HomeSkeleton, list: ListSkeleton, detail: DetailSkeleton, form: FormSkeleton, focused: FocusedSkeleton };
/** Fast navigations finish before this, so they never flash a skeleton. */
const DELAY = 150;
/** A navigation that has not finished by then has failed or been abandoned. */
const GIVE_UP = 15_000;

/**
 * Shows the skeleton of the page being opened while a navigation waits for the
 * server, then the page itself. It watches link clicks rather than wrapping
 * pages in Suspense boundaries: React streams a large boundary behind its
 * fallback, which would leave browsers without JavaScript on the skeleton.
 * Changes within a page (tabs, filters) keep the page in place.
 */
export function NavigationFeedback({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState<SkeletonKind | null>(null);
  // A new path has committed, by a click or by Back: any navigation is over.
  const [shown, setShown] = useState(pathname);
  const [slow, setSlow] = useState(false);
  if (shown !== pathname) {
    setShown(pathname);
    setPending(null);
    setSlow(false);
  }
  const navigating = pending !== null && slow;

  useEffect(() => {
    // Capture phase: Next.js links cancel the default action in their own handler.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      // A link that opens a dialog in place, such as New Portal once hydrated, doesn't navigate.
      if (anchor.getAttribute("aria-haspopup") === "dialog") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      const kind = skeletonFor(url.pathname);
      if (kind) setPending(kind);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const show = setTimeout(() => setSlow(true), DELAY);
    const giveUp = setTimeout(() => {
      setPending(null);
      setSlow(false);
    }, GIVE_UP);
    return () => {
      clearTimeout(show);
      clearTimeout(giveUp);
    };
  }, [pending]);

  const Skeleton = navigating ? SKELETONS[pending] : null;
  return (
    <>
      <div hidden={navigating} style={{ display: "contents" }}>
        {children}
      </div>
      {Skeleton && <Skeleton />}
    </>
  );
}
