import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AiNotice } from "@/components/prototypes/ai-notice";
import { PreviewControls } from "@/components/prototypes/preview-controls";
import { VersionPreview } from "@/components/prototypes/version-preview";
import { navFlags } from "@/components/shell/nav-flags";
import { homeLink, visibleSections } from "@/components/shell/navigation";
import { ShellHeader } from "@/components/shell/shell-header";
import { ChecksPanel } from "@/components/ui/checks-panel";
import { Page } from "@/components/ui/page";
import { getPrototypesDb } from "@/lib/prototypes/db/client";
import { requirePrototypes } from "@/lib/prototypes/guard";
import { parseFramePreview } from "@/lib/prototypes/preview-state";
import { sharedVersion } from "@/lib/prototypes/shares";
import { checkSummary } from "@/lib/prototypes/summary";
import styles from "./share.module.css";

type Params = Promise<{ token: string }>;

async function load(token: string) {
  requirePrototypes();
  return sharedVersion(await getPrototypesDb(), token);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const shared = await load((await params).token);
  return { title: shared ? `${shared.prototypeName} v${shared.version.number}` : "Page not found", robots: { index: false } };
}

/**
 * A shared version (sharing-and-export spec, "A version can be shared
 * read-only"): the version in the shell it was shared with, under the
 * preview controls, with its checks and fit scores and the AI-generated
 * notice. It needs no workspace and offers no feedback, refinement, other
 * versions, or anything else from the workspace.
 */
export default async function SharedPrototypePage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const shared = await load(token);
  if (!shared) notFound();
  const { version, prototypeName } = shared;
  const state = parseFramePreview(await searchParams);
  const frameBase = `/p/${token}/render`;
  const title = `${prototypeName} v${version.number}`;
  const home = homeLink(visibleSections(navFlags()));
  return (
    <Page>
      <ShellHeader title={title} back={{ href: home.href, label: `Back to ${home.label}` }} />
      <div className={styles.layout} data-shared-prototype="">
        <div className={styles.head}>
          <p className={styles.lead}>{`A read-only view of ${title}, shared from DE FabLab Prototypes.`}</p>
          <p className={styles.summary} data-check-summary="">
            {checkSummary({ status: version.status, gatesPassed: version.gatesPassed, gates: version.attempts.at(-1)?.gates ?? [], audit: version.audit, fit: version.fit, renderError: version.renderError }).text}
          </p>
        </div>
        <AiNotice />
        <PreviewControls action={`/p/${token}`} state={state} frameBase={frameBase} />
        <VersionPreview versionId={version.id} title={title} state={state} frameBase={frameBase} report={false} />
        <ChecksPanel gates={version.attempts.at(-1)?.gates ?? []} attempts={version.attempts} firstPass={version.firstPass} audit={version.audit} renderError={version.renderError} fit={version.fit} />
      </div>
    </Page>
  );
}
