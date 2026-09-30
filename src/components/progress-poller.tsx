"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Polls a status endpoint while work is running and refreshes the page when
 * the status version changes. Render it only for nonterminal work; it renders
 * nothing itself.
 */
export function ProgressPoller({ url, version, intervalMs = 1_500 }: { url: string; version: string; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) return;
        const status = (await response.json()) as { version?: string };
        if (active && status.version !== version) router.refresh();
      } catch {
        // A missed poll is retried on the next tick.
      }
    }, intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [url, version, intervalMs, router]);
  return null;
}
