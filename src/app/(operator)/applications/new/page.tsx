import type { Metadata } from "next";
import { ShellHeader } from "@/components/shell/shell-header";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterMenu } from "@/components/ui/filter-rail";
import { MediaCard } from "@/components/ui/media-card";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Tag } from "@/components/ui/tag";
import { parseKinds } from "@/lib/applications/starter-catalog";
import { FEATURED_STARTERS, starters } from "@/lib/applications/starters";
import { STARTER_KINDS, STARTER_KIND_LABELS } from "@/lib/applications/vocabulary";
import { demoEnabled } from "@/lib/demo/guard";
import { currentWorkspace } from "@/lib/demo/request";
import { resetDemo } from "../../templates/actions";
import { demoOutcome } from "../../templates/outcomes";
import { submitBuildPrompt } from "./actions";
import { CreateHints } from "./create-hints";
import { PromptBar } from "./prompt-bar";
import styles from "./new.module.css";

export const metadata: Metadata = { title: "Let's build something new" };

/**
 * Add application (application-creation spec): a focused page that leads
 * with "Let's build something new", then the prompt bar, then Build your
 * solution's four starters, filtered by kind in the address, and Browse all.
 * A broken starters file leaves the prompt bar and Browse all working.
 * While the demo is enabled, it's also where a presenter resets the demo
 * (demo-mode spec, "Visitors can reset their workspace").
 */
export default async function AddApplicationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const kinds = parseKinds(params.kind);
  const list = starters();
  const featured = (list ?? []).slice(0, FEATURED_STARTERS);
  const shown = featured.filter((starter) => kinds.length === 0 || kinds.includes(starter.kind));
  const workspace = demoEnabled() ? await currentWorkspace() : null;

  return (
    <Page>
      <ShellHeader back={{ href: "/applications", label: "Back to Applications" }} />
      <OutcomeToast outcome={demoOutcome(param(params, "notice"))} strip={["notice"]} />
      <section className={styles.hero} aria-labelledby="build-title" data-hint-target="prompt">
        <h1 id="build-title" className={styles.title}>
          Let&apos;s build something new
        </h1>
        <p className={styles.lede}>Paste the URL of a Bitbucket or GitHub repository to register it, describe what you want to build, or start from a starter.</p>
        <PromptBar action={submitBuildPrompt} />
      </section>

      <section className={styles.solutions} aria-labelledby="build-solutions" data-hint-target="solutions">
        <div className={styles.solutionsHead}>
          <h2 id="build-solutions" className={styles.solutionsTitle}>
            Build your solution
          </h2>
          <div className={styles.solutionsActions}>
            {list && (
              <FilterMenu
                key={kinds.join(",")}
                action="/applications/new"
                label="Filter starters"
                groups={[{ name: "kind", legend: "Kind", options: STARTER_KINDS.map((kind) => ({ value: kind, label: STARTER_KIND_LABELS[kind], count: featured.filter((starter) => starter.kind === kind).length })) }]}
                selected={{ kind: kinds }}
                activeCount={kinds.length}
                filtered={kinds.length > 0}
                clearHref="/applications/new"
              />
            )}
            <ButtonLink href="/applications/new/templates" variant="secondary" icon="arrowRight">
              Browse all
            </ButtonLink>
            {demoEnabled() && (
              <ConfirmDialog action={resetDemo} trigger={{ label: "Reset demo", icon: "undo" }} menu={{ label: "More actions", variant: "secondary", size: "md" }} title="Reset the demo?" confirmLabel="Reset demo" tone="danger">
                <p>Your demo deployments, comments, share links, and session profiles are removed. The templates, registered Applications, and other visitors&apos; work are not affected.</p>
              </ConfirmDialog>
            )}
          </div>
        </div>

        {!list ? (
          <Panel flush>
            <EmptyState title="Starters are unavailable" icon="alert">
              The starters couldn&apos;t be read. Browse all still lists every template, and the prompt bar still takes a repository URL.
            </EmptyState>
          </Panel>
        ) : shown.length === 0 ? (
          <Panel flush>
            <EmptyState
              title="No starters match"
              icon="search"
              action={
                <ButtonLink href="/applications/new" variant="secondary">
                  Clear filter
                </ButtonLink>
              }
            >
              {`No starter is a ${kinds.map((kind) => STARTER_KIND_LABELS[kind]).join(" or ")}.`}
            </EmptyState>
          </Panel>
        ) : (
          <ul className={styles.starters} aria-label="Starters">
            {shown.map((starter) => (
              <li key={starter.slug}>
                <MediaCard
                  title={starter.title}
                  description={starter.description}
                  image={{ src: starter.preview, alt: `Preview of the ${starter.title} starter` }}
                  href={`/applications/new/create?${new URLSearchParams({ starter: starter.slug, from: "new" })}`}
                  footer={<Tag sans>{STARTER_KIND_LABELS[starter.kind]}</Tag>}
                  headingLevel={3}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {/* A first-time visitor has no workspace yet, and sees the hints from the start. */}
      {demoEnabled() && <CreateHints key={JSON.stringify(workspace?.hints ?? {})} initial={workspace?.hints ?? {}} />}
    </Page>
  );
}
