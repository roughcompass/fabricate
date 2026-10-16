import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProgressPoller } from "@/components/progress-poller";
import { AiNotice } from "@/components/prototypes/ai-notice";
import { PreviewControls } from "@/components/prototypes/preview-controls";
import { VersionPreview } from "@/components/prototypes/version-preview";
import { ShellHeader } from "@/components/shell/shell-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CodeDiff } from "@/components/ui/code-diff";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/form";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page } from "@/components/ui/page";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { SubmitButton } from "@/components/ui/submit-button";
import { getConfig } from "@/lib/config";
import { NotFoundError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { type CompareSide, type Comparison, criterionScores, higherScores, loadComparison } from "@/lib/prototypes/compare";
import { generationConfigured } from "@/lib/prototypes/models";
import { parseFramePreview, previewQuery } from "@/lib/prototypes/preview-state";
import { getPrototype } from "@/lib/prototypes/prototypes";
import { prototypesRequest } from "@/lib/prototypes/request";
import { checkSummary, formatFit } from "@/lib/prototypes/summary";
import { CRITERIA } from "@/lib/prototypes/types";
import { remainingToday } from "@/lib/prototypes/workspace";
import { pairwiseAction } from "./actions";
import styles from "./compare.module.css";

type Query = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<{ prototypeId: string }> }): Promise<Metadata> {
  const { prototypeId } = await params;
  if (!isPublicId(prototypeId, "pro")) return { title: "Prototype not found" };
  const { db, workspace } = await prototypesRequest();
  const prototype = await getPrototype(db, workspace.id, prototypeId).catch(() => null);
  return { title: prototype ? `Compare · ${prototype.name}` : "Prototype not found" };
}

/** What produced a side, its lessons, its check summary, and its fit per criterion, the higher of the pair marked. */
function Evidence({ side, higher, which }: { side: CompareSide; higher: ReturnType<typeof higherScores>; which: "a" | "b" }) {
  const { version } = side;
  const provenance = version.provenance;
  const scores = criterionScores(version.fit);
  return (
    <DescriptionList
      items={[
        [provenance?.message ? "Message" : provenance?.forkedFrom ? "Forked from" : "Intent", provenance?.message ?? (provenance?.forkedFrom ? `${provenance.forkedFrom.prototypeName} v${provenance.forkedFrom.number}` : (provenance?.intent ?? "—"))],
        ["Lessons applied", provenance?.lessons.length ? <ol className={styles.plainList}>{provenance.lessons.map((lesson) => <li key={lesson.id}>{lesson.text}</li>)}</ol> : "None"],
        ["Checks", checkSummary(version).text],
        [
          "Fit",
          version.fit?.status === "reviewed" ? (
            <ul className={styles.scores} aria-label={`Fit scores, ${side.label}`}>
              {CRITERIA.map(({ id, label }) => (
                <li key={id} data-criterion={id} data-higher={higher[id] === which ? "" : undefined}>
                  <span>{label}</span>
                  <span className={styles.score}>
                    {scores[id] === null ? "Unknown" : formatFit(scores[id])}
                    {higher[id] === which && <Status state="pass" label="Higher" />}
                  </span>
                </li>
              ))}
            </ul>
          ) : version.fit?.status === "not-applicable" ? (
            "Not reviewed: no personas"
          ) : (
            "Not reviewed"
          ),
        ],
      ]}
    />
  );
}

function PairwiseReview({ comparison, available, remaining }: { comparison: Comparison; available: boolean; remaining: number }) {
  const { review, a, b, prototype } = comparison;
  const name = (winner: "a" | "b" | "undecided") => (winner === "a" ? `${a.label} is better` : winner === "b" ? `${b.label} is better` : "Undecided");
  const running = review?.status === "running";
  return (
    <Section id="pairwise" title="Pairwise review" description="An AI review judges which version better serves the intent for each persona, twice with the order swapped. Where the two runs disagree, it is Undecided. It is advisory, and it counts as one variant toward today's limit.">
      {running && <ProgressPoller url={`/api/prototypes/pairwise/${review.id}/status`} version="running" />}
      {review?.status === "done" && (
        <div className={styles.verdicts} data-pairwise="done">
          <p className={styles.muted}>{`AI review by ${review.model}`}</p>
          <ul className={styles.plainList}>
            {review.verdicts.map((verdict) => (
              <li key={verdict.personaId ?? verdict.personaName} className={styles.verdict} data-verdict={verdict.winner}>
                <p className={styles.verdictHead}>
                  <strong>{verdict.personaName}</strong>
                  <Status state={verdict.winner === "undecided" ? "pending" : "pass"} label={name(verdict.winner)} />
                </p>
                {verdict.reasons.length > 0 && (
                  <ul className={styles.reasons}>
                    {verdict.reasons.map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {review?.status === "failed" && (
        <Alert tone="error" title="The pairwise review failed.">
          {review.error ?? "Ask again to retry."}
        </Alert>
      )}
      {running ? (
        <p className={styles.muted} role="status" data-pairwise="running">
          Reviewing the pair…
        </p>
      ) : (
        <form action={pairwiseAction} className={styles.ask}>
          <input type="hidden" name="prototype" value={prototype.id} />
          <input type="hidden" name="versionA" value={a.version.id} />
          <input type="hidden" name="versionB" value={b.version.id} />
          <input type="hidden" name="a" value={a.key} />
          <input type="hidden" name="b" value={b.key} />
          <SubmitButton size="sm" pendingLabel="Starting" disabled={!available || remaining === 0}>
            {review ? "Review again" : "Ask for a pairwise review"}
          </SubmitButton>
          <span className={styles.muted}>{!available ? "Generation isn't configured in this environment." : remaining === 0 ? "Today's limit is used up." : `${remaining} left today.`}</span>
        </form>
      )}
    </Section>
  );
}

/**
 * The compare page (versions spec, "Two versions can be compared side by
 * side"; page-patterns spec: a focused page whose parent is its prototype).
 * Both previews sit side by side under one set of controls, each with its
 * evidence, the higher score on each criterion marked; a pairwise review on
 * request; and the code changes between them.
 */
export default async function ComparePage({ params, searchParams }: { params: Promise<{ prototypeId: string }>; searchParams: Promise<Query> }) {
  const [{ prototypeId }, query] = await Promise.all([params, searchParams]);
  if (!isPublicId(prototypeId, "pro")) notFound();
  const { db, workspace } = await prototypesRequest();
  let comparison: Comparison | null;
  try {
    comparison = await loadComparison(db, workspace.id, prototypeId, param(query, "a"), param(query, "b"));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const prototype = comparison?.prototype ?? (await getPrototype(db, workspace.id, prototypeId));
  const back = { href: `/prototypes/${prototype.id}`, label: `Back to ${prototype.name}` };
  if (!comparison) {
    return (
      <Page>
        <ShellHeader title={`Compare · ${prototype.name}`} back={back} />
        <EmptyState title="Nothing to compare yet" icon="layers">
          A prototype needs two versions, or to be a fork, to compare. Ask for a change to make version 2.
        </EmptyState>
      </Page>
    );
  }
  const { a, b, choices, diffs } = comparison;
  const preview = parseFramePreview(query);
  const action = `/prototypes/${prototype.id}/compare`;
  const higher = higherScores(a.version.fit, b.version.fit);
  const settings = getConfig().prototypes;
  const changed = diffs.filter((diff) => diff.hunks.length > 0 || diff.tooLarge);

  return (
    <Page>
      <ShellHeader title={`Compare ${a.label} and ${b.label} · ${prototype.name}`} back={back} />
      <OutcomeToast outcome={param(query, "notice") === "limit" ? { id: `limit:${a.version.id}:${b.version.id}`, tone: "error", title: "Today's limit is used up.", description: "The pairwise review counts as one variant; try again tomorrow." } : undefined} strip={["notice"]} />
      <AiNotice />
      <div className={styles.toolbar}>
        <form action={action} method="get" className={styles.pick} aria-label="Versions to compare">
          <Select id="compare-a" name="a" label="Left" size="sm" defaultValue={a.key} options={choices} />
          <Select id="compare-b" name="b" label="Right" size="sm" defaultValue={b.key} options={choices} />
          {Object.entries(previewQuery(preview)).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <Button type="submit" size="sm">
            Compare
          </Button>
        </form>
        <PreviewControls action={action} state={preview} keep={{ a: a.key, b: b.key }} />
      </div>
      <div className={styles.sides}>
        {(["a", "b"] as const).map((which) => {
          const side = which === "a" ? a : b;
          return (
            <section key={which} className={styles.side} aria-labelledby={`side-${which}`} data-compare-side={side.key}>
              <h2 id={`side-${which}`} className={styles.sideTitle}>
                {side.key === "origin" ? side.label : `Version ${side.version.number}`}
              </h2>
              <VersionPreview versionId={side.version.id} title={`${side.prototypeName} ${side.label}`} state={preview} needsAudit={!side.version.audit} renderErrorRecorded={Boolean(side.version.renderError)} />
              <Evidence side={side} higher={higher} which={which} />
            </section>
          );
        })}
      </div>
      <PairwiseReview comparison={comparison} available={generationConfigured(settings)} remaining={remainingToday(workspace, settings.dailyVariantLimit)} />
      <Section id="code-changes" title="Code changes" description={changed.length ? `What changed from ${a.label} to ${b.label}.` : `${a.label} and ${b.label} have the same code.`}>
        {diffs.map((diff) => (
          <CodeDiff key={diff.path} diff={diff} before={a.label} after={b.label} />
        ))}
      </Section>
    </Page>
  );
}
