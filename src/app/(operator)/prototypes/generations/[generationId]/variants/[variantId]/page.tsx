import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CodeView, codeFiles } from "@/app/(operator)/prototypes/[prototypeId]/code-view";
import { ProvenanceView } from "@/app/(operator)/prototypes/[prototypeId]/provenance-view";
import { ChecksPanel } from "@/components/ui/checks-panel";
import { AiNotice } from "@/components/prototypes/ai-notice";
import { PreviewControls } from "@/components/prototypes/preview-controls";
import { VersionPreview } from "@/components/prototypes/version-preview";
import { ShellHeader } from "@/components/shell/shell-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { TextInput } from "@/components/ui/form";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page } from "@/components/ui/page";
import { Status } from "@/components/ui/status";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { NotFoundError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { parseFramePreview, previewQuery } from "@/lib/prototypes/preview-state";
import { prototypesRequest } from "@/lib/prototypes/request";
import { checkSummary } from "@/lib/prototypes/summary";
import { getGeneration, variantSentence, variantTitle } from "@/lib/prototypes/variants";
import { decideVariantAction } from "../../actions";
import { variantsOutcome } from "../../outcomes";
import styles from "./variant.module.css";

type Query = Record<string, string | string[] | undefined>;
type Params = Promise<{ generationId: string; variantId: string }>;

async function load(generationId: string, variantId: string) {
  if (!isPublicId(generationId, "gen") || !isPublicId(variantId, "var")) notFound();
  const { db, workspace } = await prototypesRequest();
  let view;
  try {
    view = await getGeneration(db, workspace.id, generationId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const index = view.variants.findIndex(({ variant }) => variant.id === variantId);
  const entry = view.variants[index];
  if (!entry?.version || entry.version.status !== "ready") notFound();
  return { view, index, entry: { ...entry, version: entry.version } };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { generationId, variantId } = await params;
  const { view, entry, index } = await load(generationId, variantId);
  return { title: `${variantTitle(view.generation, entry.variant, index)} · Variants` };
}

/**
 * One variant on its own, as template preview mode shows a template: a
 * focused page with its preview at a phone's, tablet's, or desktop's size,
 * turned to landscape, in either mode and any density, or opened full
 * screen; its code, checks, and provenance; and Keep or Discard. Previous and Next step through the
 * generation's other ready variants. Every choice lives in the address.
 */
export default async function VariantPage({ params, searchParams }: { params: Params; searchParams: Promise<Query> }) {
  const [{ generationId, variantId }, query] = await Promise.all([params, searchParams]);
  const { view, index, entry } = await load(generationId, variantId);
  const { generation } = view;
  const { variant, version, prototypeId } = entry;
  const preview = parseFramePreview(query);
  const VIEWS = { preview: "Preview", code: "Code", checks: "Checks", provenance: "Provenance" } as const;
  const requested = param(query, "tab");
  const tab: keyof typeof VIEWS = requested && requested in VIEWS ? (requested as keyof typeof VIEWS) : "preview";
  const base = `/prototypes/generations/${generation.id}`;
  const action = `${base}/variants/${variant.id}`;
  const title = variantTitle(generation, variant, index);
  const sentence = variantSentence(generation, variant);
  const ready = view.variants.filter(({ version: other }) => other?.status === "ready");
  const position = ready.findIndex((other) => other.variant.id === variant.id);
  const previous = ready[position - 1];
  const next = ready[position + 1];
  const keep = previewQuery(preview);
  const at = (id: string, extra: Record<string, string> = {}) => {
    const query: Record<string, string> = { ...keep, ...(tab === "preview" ? {} : { tab }), ...extra };
    const entries = Object.entries(query).filter(([, value]) => value !== "");
    const search = new URLSearchParams(entries).toString();
    return `${base}/variants/${id}${search ? `?${search}` : ""}`;
  };
  const files = codeFiles(version.code, version.sampleData?.source ?? "", version.scope, version.styles);
  const summary = checkSummary(version);
  const kept = prototypeId ? { id: prototypeId, name: title } : undefined;

  return (
    <Page>
      <ShellHeader title={title} back={{ href: base, label: "Back to all variants" }} />
      <OutcomeToast outcome={variantsOutcome(param(query, "notice"), kept, param(query, "reason"))} strip={["notice", "prototype", "variant", "reason"]} />
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <p className={styles.title}>{title}</p>
          {variant.decision ? <Status state={variant.decision} /> : <Status state="ready" />}
          <p className={styles.muted}>{`Variant ${position + 1} of ${ready.length} ready`}</p>
          <div className={styles.stepper}>
            {previous ? (
              <ButtonLink href={at(previous.variant.id)} size="sm" icon="arrowLeft">
                Previous
              </ButtonLink>
            ) : null}
            {next ? (
              <ButtonLink href={at(next.variant.id)} size="sm">
                Next
              </ButtonLink>
            ) : null}
          </div>
        </div>
        {sentence && <p className={styles.muted}>{sentence}</p>}
        {version.provenance?.dataNote && (
          <p className={styles.muted} data-data-note="">
            {version.provenance.dataNote}
          </p>
        )}
        <p className={styles.muted} data-check-summary="">
          {summary.text.charAt(0).toUpperCase() + summary.text.slice(1)}
        </p>
        <AiNotice />
      </div>
      <div className={styles.decision}>
        {variant.decision === "kept" && prototypeId ? (
          <p className={styles.muted}>
            Kept as <Link href={`/prototypes/${prototypeId}`}>{title}</Link>
            {variant.decisionReason && ` · ${variant.decisionReason}`}
          </p>
        ) : variant.decision === "discarded" ? (
          <p className={styles.muted}>{variant.decisionReason ? `Discarded: ${variant.decisionReason}` : "Discarded"}</p>
        ) : (
          generation.kind === "generate" && (
            <form action={decideVariantAction} className={styles.decide}>
              <input type="hidden" name="generation" value={generation.id} />
              <input type="hidden" name="variant" value={variant.id} />
              <input type="hidden" name="back" value={action} />
              <TextInput id={`${variant.id}-reason`} name="reason" label="Reason" optional size="sm" maxLength={2000} description="Why you keep or discard it. Reasons teach later generations." />
              <div className={styles.buttons}>
                <Button type="submit" name="decision" value="kept" variant="primary" size="sm" icon="check">
                  Keep
                </Button>
                <Button type="submit" name="decision" value="discarded" size="sm" icon="x">
                  Discard
                </Button>
              </div>
            </form>
          )
        )}
      </div>
      <Tabs label="Variant views">
        {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((id) => (
          <TabLink key={id} href={at(variant.id, { tab: id === "preview" ? "" : id })} active={tab === id}>
            {VIEWS[id]}
          </TabLink>
        ))}
      </Tabs>
      {tab === "preview" && (
        <div className={styles.preview}>
          <PreviewControls action={action} state={preview} frameBase={`/prototypes/render/${version.id}`} />
          <VersionPreview versionId={version.id} title={title} state={preview} needsAudit={!version.audit} renderErrorRecorded={Boolean(version.renderError)} />
        </div>
      )}
      {tab === "code" && <CodeView files={files} selected={param(query, "file") ?? "Prototype.tsx"} hrefFor={(path) => `${action}?${new URLSearchParams({ ...keep, tab: "code", ...(path === "Prototype.tsx" ? {} : { file: path }) })}`} />}
      {tab === "checks" && <ChecksPanel gates={version.attempts.at(-1)?.gates ?? []} attempts={version.attempts} firstPass={version.firstPass} audit={version.audit} renderError={version.renderError} fit={version.fit} />}
      {tab === "provenance" && version.provenance && <ProvenanceView provenance={version.provenance} attempts={version.attempts} parentHref={null} parentNumber={null} />}
    </Page>
  );
}
