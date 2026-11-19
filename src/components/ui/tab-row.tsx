"use client";

import { useEffect, useRef } from "react";

/**
 * The row of tabs, which scrolls sideways when the tabs don't fit; on load
 * and after each change of view it scrolls the current tab into view, so a
 * narrow page never hides the view it shows.
 */
export function TabRow({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = row.current;
    const current = element?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!element || !current) return;
    const bounds = element.getBoundingClientRect();
    const tab = current.getBoundingClientRect();
    if (tab.left >= bounds.left && tab.right <= bounds.right) return;
    // Center it, scrolling the row alone, never the page.
    element.scrollLeft += tab.left - bounds.left - (bounds.width - tab.width) / 2;
  });
  return (
    <nav ref={row} className={className} aria-label={label} data-scroll-x="">
      {children}
    </nav>
  );
}
