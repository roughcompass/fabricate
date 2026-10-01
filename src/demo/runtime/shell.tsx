"use client";

import { BRANDS } from "@/lib/demo/catalog";
import { AccessShell } from "./access-shell";
import { MarketsShell } from "./markets-shell";
import { useRuntime } from "./runtime-context";

/**
 * The portal shell for the application's brand: the default microfrontend of
 * every group (design.md, decision 20). Payments, Global Banking, and Other
 * render in the J.P. Morgan Access shell, Markets in the J.P. Morgan Markets shell.
 */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const { template } = useRuntime();
  return BRANDS[template.brand].shell === "markets" ? <MarketsShell>{children}</MarketsShell> : <AccessShell>{children}</AccessShell>;
}
