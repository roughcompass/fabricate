"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Shown {
  readonly id: string;
  readonly name: string;
  /** The status as text, such as "Ready" or "Build failed". */
  readonly label: string;
  readonly settling: boolean;
}

/** How often a page with a build under way asks for its applications' status (design decision 9). */
const INTERVAL_MS = 3_000;

/**
 * Keeps the applications a page shows up to date while a build or a
 * screenshot is under way (applications/catalog spec, "Applications update
 * while builds run"): it polls the status endpoint every 3 seconds, refreshes
 * the page when the status changes, so cards and images update in place
 * without a reload, and stops when nothing is under way. Each application
 * that finishes is announced once, politely, by its name and status.
 */
export function ApplicationsPoller({ url, version, shown }: { url: string; version: string; shown: readonly Shown[] }) {
  const router = useRouter();
  const active = shown.some((application) => application.settling);
  // The applications as the page last showed them; a refresh brings new ones, and those that finished since are announced.
  const [seen, setSeen] = useState(shown);
  const [announcement, setAnnouncement] = useState("");
  if (seen !== shown) {
    const before = new Map(seen.map((application) => [application.id, application]));
    const finished = shown.filter((application) => !application.settling && before.get(application.id)?.settling);
    setSeen(shown);
    if (finished.length) setAnnouncement(finished.map((application) => `${application.name}: ${application.label}.`).join(" "));
  }

  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) return;
        const status = (await response.json()) as { version?: string };
        if (current && status.version !== version) router.refresh();
      } catch {
        // A missed poll is retried on the next tick.
      }
    }, INTERVAL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [active, url, version, router]);

  return (
    <p className="visually-hidden" role="status" aria-live="polite" data-build-announcements="">
      {announcement}
    </p>
  );
}
