import { notFound } from "next/navigation";
import { getConfig } from "@/lib/config";

/**
 * The demo switch (template-demo/demo-mode spec). Every demo page, Server
 * Action, and route handler checks it itself rather than relying on the proxy,
 * so a disabled demo answers not found everywhere.
 */

export function demoEnabled(): boolean {
  return getConfig().demoEnabled;
}

/** For pages and Server Actions: renders the not-found page when the demo is off. */
export function requireDemo(): void {
  if (!demoEnabled()) notFound();
}
