"use client";

import { SaltProviderNext } from "@salt-ds/core";
import { useEmbedded, useRuntime, useViewState } from "./runtime-context";

export const ENVIRONMENT_LABELS = {
  production: "Production",
  sandbox: "Sandbox",
  dev: "Dev",
} as const;

/**
 * The portal's root element. It identifies the application to the toolbar
 * (the audit root, the view key, the theme). Salt's theme applies to it and
 * everything inside, in the view's mode, so every shell and microfrontend
 * renders as Salt, and nothing outside the portal changes
 * (converge-templates-and-prototypes, design decision 11).
 */
export function PortalRoot({ children }: { children: React.ReactNode }) {
  const { descriptor, template } = useRuntime();
  const { theme } = useViewState();
  const embedded = useEmbedded();
  return (
    <SaltProviderNext applyClassesTo="child" mode={theme} density="medium" accent="teal" corner="rounded">
      <div data-demo-portal="" data-brand={template.brand} data-shell={descriptor.shell} data-theme={theme} data-demo-app-root="" data-demo-view-key={descriptor.viewKey} data-demo-embedded={embedded || undefined}>
        {children}
      </div>
    </SaltProviderNext>
  );
}
