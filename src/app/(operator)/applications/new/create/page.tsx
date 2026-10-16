import type { Metadata } from "next";
import Link from "next/link";
import { ShellHeader } from "@/components/shell/shell-header";
import { CopyButton } from "@/components/ui/copy-button";
import { param } from "@/components/ui/outcome-toast";
import { Page } from "@/components/ui/page";
import { type CatalogEntry, catalogEntries } from "@/lib/applications/starter-catalog";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { referenceId } from "@/lib/demo/catalog";
import { portalSwitcherList } from "@/lib/onboarding/catalog";
import { PORTAL_LIFECYCLE_LABELS } from "@/lib/onboarding/vocabulary";
import { rememberedPortal } from "@/lib/web/portal-cookie";
import { createApplicationAction } from "./actions";
import { CreateApplicationForm } from "./create-form";
import styles from "./create.module.css";

export const metadata: Metadata = { title: "Create Application" };

/** Where Create Application's back button and Cancel go: the page it was opened from. */
const BACK = {
  new: { href: "/applications/new", label: "Back to Let's build something new" },
  templates: { href: "/applications/new/templates", label: "Back to Choose a starter or template" },
  applications: { href: "/applications", label: "Back to Applications" },
} as const;

/** The panel beside the form for the chosen starter, the chosen template, or no starter. */
function StarterPanel({ entry, repo }: { entry: CatalogEntry | null; repo: string | null }) {
  const change = `/applications/new/templates`;
  const remove = `/applications/new/create?${new URLSearchParams({ ...(repo ? { repo } : {}), from: "applications" })}`;
  if (!entry) {
    return (
      <div className={styles.starter}>
        <p>DE FabLab reads the repository at its default branch, profiles it without running its code, and determines whether DE Web will render it as an ES module, with Module Federation, or in an iframe.</p>
        <p className={styles.muted}>Starting a new application instead? Choose a starter, and create its repository from it first.</p>
        <p className={styles.starterActions}>
          <Link href={change}>Choose a starter</Link>
        </p>
      </div>
    );
  }
  if (!entry.starter) {
    return (
      <div className={styles.starter}>
        <p className={styles.starterTitle}>{entry.title}</p>
        <p className={styles.muted}>{entry.description}</p>
        {entry.origin === "built-in" ? (
          <p>
            <a href={`/run/${referenceId(entry.slug)}`} target="_blank" rel="noopener">
              Open its reference deployment<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          </p>
        ) : (
          <p>
            <Link href={`/templates/${entry.slug}`}>Open the template</Link>
          </p>
        )}
        <p className={styles.muted}>DE FabLab doesn&apos;t create repositories. Create one from the template, then enter its URL in Repository URL.</p>
        <p className={styles.starterActions}>
          <Link href={change}>Change starter</Link>
          <Link href={remove}>Remove starter</Link>
        </p>
      </div>
    );
  }
  const { starter } = entry;
  return (
    <div className={styles.starter}>
      <p className={styles.starterTitle}>{starter.title}</p>
      <p className={styles.muted}>{starter.description}</p>
      <p>
        <a href={starter.sourceUrl} target="_blank" rel="noreferrer">
          The starter&apos;s repository<span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </p>
      <ol className={styles.steps} aria-label="Scaffold steps">
        {starter.steps.map((step, index) => (
          <li key={index}>
            <span>{step.text}</span>
            {step.command && (
              <span className={styles.command}>
                <code className={styles.commandText}>{step.command}</code>
                <CopyButton value={step.command} label={`Copy step ${index + 1}'s command`} />
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className={styles.muted}>DE FabLab doesn&apos;t create repositories. Enter the URL of the repository you create from the starter.</p>
      <p className={styles.starterActions}>
        <Link href={change}>Change starter</Link>
        <Link href={remove}>Remove starter</Link>
      </p>
    </div>
  );
}

/**
 * Create Application (application-creation spec): a focused page with the
 * form, and beside it the chosen starter's scaffold steps, a template's
 * reference deployment, or how the repository will be assessed. The Portal
 * starts as the switcher's; a URL from the prompt bar starts filled in.
 */
export default async function CreateApplicationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const db = getDb();
  const from = param(params, "from");
  const back = BACK[from === "new" || from === "templates" ? from : "applications"];
  const repo = param(params, "repo")?.slice(0, 2000) ?? null;
  const slug = param(params, "starter") ?? null;
  const entry = slug ? ((await catalogEntries()).entries.find((candidate) => candidate.slug === slug) ?? null) : null;
  const portals = portalSwitcherList(db).map((portal) => ({ publicId: portal.publicId, label: portal.label, lifecycle: PORTAL_LIFECYCLE_LABELS[portal.lifecycle] }));
  const current = await rememberedPortal(db);

  return (
    <Page>
      <ShellHeader back={back} />
      <CreateApplicationForm
        action={createApplicationAction}
        initial={{ values: { repositoryUrl: repo ?? "", portal: current?.publicId ?? "" }, errors: {} }}
        portals={portals}
        bitbucketHosts={getConfig().applications.bitbucketHosts}
        starter={entry?.slug ?? null}
        cancelHref={back.href}
        aside={<StarterPanel entry={entry} repo={repo} />}
        asideTitle={entry ? (entry.starter ? `Start from ${entry.title}` : `Start from the ${entry.title} template`) : "How the repository is assessed"}
      />
    </Page>
  );
}
