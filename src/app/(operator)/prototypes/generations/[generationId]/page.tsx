import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgressPoller } from "@/components/progress-poller";
import { AiNotice } from "@/components/prototypes/ai-notice";
import { PreviewControls } from "@/components/prototypes/preview-controls";
import { VersionPreview } from "@/components/prototypes/version-preview";
import { ShellHeader } from "@/components/shell/shell-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextInput } from "@/components/ui/form";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page } from "@/components/ui/page";
import { Status } from "@/components/ui/status";
import { NotFoundError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { parseFramePreview } from "@/lib/prototypes/preview-state";
import { prototypesRequest } from "@/lib/prototypes/request";
import { checkSummary } from "@/lib/prototypes/summary";
import { type GenerationView, getGeneration, progressVersion, variantSentence, variantTitle } from "@/lib/prototypes/variants";
import { decideVariantAction, deleteGenerationAction, retryVariantAction } from "./actions";
import { variantsOutcome } from "./outcomes";
import styles from "./variants.module.css";

type Query = Record<string, string | string[] | undefined>;

async function load(generationId: string): Promise<GenerationView> {
  if (!isPublicId(generationId, "gen")) notFound();
  const { db, workspace } = await prototypesRequest();
  try {
    return await getGeneration(db, workspace.id, generationId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export const metadata: Metadata = { title: "Variants · Prototypes" };

const AXIS_LABELS = { "information hierarchy": "Information hierarchy", density: "Density", layout: "Layout", "interaction model": "Interaction model" } as const;

/**
 * A generation's variants (versions spec, "Keeping a variant creates a
 * prototype"; generation spec, "Variants generate in parallel and show
 * progress"): a focused page with one frame per variant at one shared width.
 * Each variant shows its direction and stage, appears as soon as it is
 * ready, and offers Keep or Discard, each with an optional reason, or Retry
 * when it failed. Generation continues if the visitor leaves.
 */
export default async function VariantsPage({ params, searchParams }: { params: Promise<{ generationId: string }>; searchParams: Promise<Query> }) {
  const [{ generationId }, query] = await Promise.all([params, searchParams]);
  const view = await load(generationId);
  const { generation } = view;
  const preview = parseFramePreview(query);
  const action = `/prototypes/generations/${generation.id}`;
  const running = view.variants.some(({ variant }) => variant.status === "running");
  const kept = view.variants.find(({ prototypeId }) => prototypeId === param(query, "prototype"));

  return (
    <Page>
      <ShellHeader title={`Variants for ${generation.intent}`} back={{ href: "/prototypes", label: "Back to Prototypes" }} />
      {running && <ProgressPoller url={`/api/prototypes/generations/${generation.id}/status`} version={progressVersion(view)} />}
      <OutcomeToast outcome={variantsOutcome(param(query, "notice"), kept?.prototypeId ? { id: kept.prototypeId, name: variantTitle(view.generation, kept.variant) } : undefined, param(query, "reason"))} strip={["notice", "prototype", "variant", "reason"]} />
      <div className={styles.head}>
        <p className={styles.intent}>{generation.intent}</p>
        <p className={styles.meta}>
          {[generation.scope === "page" ? "Page" : "Component", generation.personas.length ? `for ${generation.personas.map((persona) => persona.name).join(", ")}` : "no persona", `${generation.variantCount} ${generation.variantCount === 1 ? "variant" : "variants"}`].join(" · ")}
        </p>
        {view.variants.some(({ variant }) => !variant.decision) && (
          <p className={styles.meta} data-keep-hint="">
            <strong>Keep a variant to save it as a prototype.</strong> Until then, this generation waits on All Prototypes.
          </p>
        )}
        <AiNotice />
        {generation.kind === "generate" && !running && (
          <div className={styles.headActions}>
            <ConfirmDialog action={deleteGenerationAction} fields={{ generation: generation.id }} trigger={{ label: "Delete generation", icon: "trash", variant: "tertiary", size: "sm" }} title="Delete this generation?" confirmLabel="Delete generation" tone="danger">
              Its variants that weren&apos;t kept are deleted. Prototypes kept from it stay, and so do the reasons you gave and the lessons they taught.
            </ConfirmDialog>
          </div>
        )}
      </div>
      <PreviewControls action={action} state={preview} />
      <div className={styles.grid} data-variants="">
        {view.variants.map(({ variant, version, prototypeId }, index) => {
          const ready = version?.status === "ready";
          const summary = version && ready ? checkSummary(version) : null;
          const title = variantTitle(view.generation, variant, index);
          const sentence = variantSentence(view.generation, variant);
          return (
            <article key={variant.id} className={styles.variant} data-prototype-variant={variant.id} data-status={variant.status} data-decision={variant.decision ?? undefined} aria-labelledby={`${variant.id}-title`}>
              <div className={styles.titleRow}>
                <h2 id={`${variant.id}-title`} className={styles.title}>
                  {title}
                </h2>
                {variant.status === "running" ? <Status state={ready ? "reviewing" : variant.stage} /> : variant.status === "failed" ? <Status state="failed" /> : variant.decision ? <Status state={variant.decision} /> : <Status state="ready" />}
              </div>
              {sentence && <p className={styles.sentence}>{variant.direction ? `${sentence} Varies the ${AXIS_LABELS[variant.direction.axis].toLowerCase()}.` : sentence}</p>}
              {version?.provenance?.dataNote && (
                <p className={styles.sentence} data-data-note="">
                  {version.provenance.dataNote}
                </p>
              )}
              {ready && version && variant.decision !== "discarded" ? (
                <VersionPreview versionId={version.id} title={title} state={preview} needsAudit={!version.audit} renderErrorRecorded={Boolean(version.renderError)} />
              ) : variant.status === "running" ? (
                <div className={styles.placeholder}>{variant.stage === "planning" ? "Choosing a direction" : "Writing the prototype"}</div>
              ) : null}
              {ready && (
                <ButtonLink href={`${action}/variants/${variant.id}`} size="sm" icon="eye">
                  View on its own
                </ButtonLink>
              )}
              {summary && (
                <p className={styles.summary} data-check-summary="">
                  {summary.text.charAt(0).toUpperCase() + summary.text.slice(1)}
                </p>
              )}
              {variant.status === "failed" && variant.failure && (
                <div className={styles.failure} role="status">
                  <p className={styles.summary}>{variant.failure.message}</p>
                  {variant.failure.issues && variant.failure.issues.length > 0 && (
                    <ul className={styles.issues} aria-label="Remaining errors">
                      {variant.failure.issues.slice(0, 6).map((issue, position) => (
                        <li key={position}>{`${issue.line ? `Line ${issue.line}: ` : ""}${issue.message}`}</li>
                      ))}
                    </ul>
                  )}
                  <form action={retryVariantAction}>
                    <input type="hidden" name="generation" value={generation.id} />
                    <input type="hidden" name="variant" value={variant.id} />
                    <Button type="submit" icon="refresh" size="sm">
                      Retry
                    </Button>
                  </form>
                </div>
              )}
              {variant.decision === "kept" && prototypeId ? (
                <p className={styles.summary}>
                  Kept as <Link href={`/prototypes/${prototypeId}`}>{title}</Link>
                  {variant.decisionReason && ` · ${variant.decisionReason}`}
                </p>
              ) : variant.decision === "discarded" ? (
                <p className={styles.summary}>{variant.decisionReason ? `Discarded: ${variant.decisionReason}` : "Discarded"}</p>
              ) : (
                ready &&
                generation.kind === "generate" && (
                  <form action={decideVariantAction} className={styles.decide}>
                    <input type="hidden" name="generation" value={generation.id} />
                    <input type="hidden" name="variant" value={variant.id} />
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
            </article>
          );
        })}
      </div>
    </Page>
  );
}
