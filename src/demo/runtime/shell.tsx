"use client";

import { GENERATED_SHELLS } from "./generated";
import { PortalRoot } from "./portal-root";
import { useRuntime } from "./runtime-context";

/**
 * The portal shell for the application's brand: the default microfrontend of
 * every group (design.md, decision 20). Payments, Global Banking, and Other
 * render in the J.P. Morgan Access shell, Markets in the J.P. Morgan Markets shell,
 * unless the Portal the application is opened for chose a theme with the
 * other (add-portal-experience-editor, design decision 8). Both are committed
 * Salt source, inside the portal's root element, which identifies the
 * application to the toolbar (update-templates-salt-quality, design decision 8).
 */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const Shell = GENERATED_SHELLS[useRuntime().descriptor.shell];
  return (
    <PortalRoot>
      <Shell>{children}</Shell>
    </PortalRoot>
  );
}
