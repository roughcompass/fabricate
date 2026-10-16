"use client";

import { Switcher } from "@/components/ui/switcher";

export interface SwitcherApplication {
  publicId: string;
  name: string;
  slug: string;
  sealId: string;
}

/**
 * The header's application switcher (application-catalog spec, "The header
 * switcher jumps between applications"; design decision 10): All
 * Applications, then the Applications in the current Portal scope, most
 * recently changed first, the current one checked, filtered by name, slug,
 * or SEAL ID, and Create Application last. Every entry is a link, so it
 * works without JavaScript; the filter and arrow keys need it.
 */
export function ApplicationSwitcher({ applications, current }: { applications: readonly SwitcherApplication[]; current: string | null }) {
  return (
    <Switcher
      label="Switch Application"
      pinned={{ value: "", label: "All Applications", icon: "layers", href: "/applications" }}
      options={applications.map((application) => ({ value: application.publicId, label: application.name, terms: [application.slug, application.sealId], href: `/applications/${application.publicId}` }))}
      current={current ?? ""}
      searchLabel="Find Application…"
      empty="Applications you add appear here for quick switching."
      noMatch="No Application matches"
      footer={{ label: "Create Application", description: "Start from a starter or a repository", icon: "plus", href: "/applications/new" }}
    />
  );
}
