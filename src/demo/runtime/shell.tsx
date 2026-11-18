"use client";

import { AccessShell } from "./access-shell";
import { GENERATED_SHELLS } from "./generated";
import { MarketsShell } from "./markets-shell";
import { useRuntime } from "./runtime-context";
import { PortalRoot } from "./shell-parts";

/**
 * The portal shell for the application's brand: the default microfrontend of
 * every group (design.md, decision 20). Payments, Global Banking, and Other
 * render in the J.P. Morgan Access shell, Markets in the J.P. Morgan Markets shell.
 * A shell the hero script generated in Salt takes the place of the
 * hand-written one, inside the portal's root element, which identifies the
 * application to the toolbar (converge-templates-and-prototypes, design decision 6).
 */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const kind = useRuntime().descriptor.shell;
  const Generated = GENERATED_SHELLS[kind];
  if (Generated) {
    return (
      <PortalRoot>
        <Generated>{children}</Generated>
      </PortalRoot>
    );
  }
  return kind === "markets" ? <MarketsShell>{children}</MarketsShell> : <AccessShell>{children}</AccessShell>;
}
