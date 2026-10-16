import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgressPoller } from "@/components/progress-poller";
import { AiNotice } from "@/components/prototypes/ai-notice";
import { PreviewControls } from "@/components/prototypes/preview-controls";
import { NotesPreview } from "@/components/prototypes/notes-preview";
import { AuditRunner } from "@/components/prototypes/version-preview";
import { ShellHeader } from "@/components/shell/shell-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { ChecksPanel } from "@/components/ui/checks-panel";
import { Composer } from "@/components/ui/composer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page } from "@/components/ui/page";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { type ThreadItem, ThreadView } from "@/components/ui/thread-view";
import { getConfig } from "@/lib/config";
import { NotFoundError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { type Feedback, feedbackFor } from "@/lib/prototypes/feedback";
import { NOTE_LENGTH } from "@/lib/prototypes/limits";
import { generationConfigured } from "@/lib/prototypes/models";
import { refinementsOf, type ThreadEntry } from "@/lib/prototypes/pipeline/refine";
import { parseFramePreview, previewQuery } from "@/lib/prototypes/preview-state";
import { type KeptVersion, type Prototype, getPrototype, versionsOf } from "@/lib/prototypes/prototypes";
import { prototypesRequest } from "@/lib/prototypes/request";
import { checkSummary } from "@/lib/prototypes/summary";
import { archiveName } from "@/lib/prototypes/export";
import { templatesAvailable } from "@/lib/prototypes/guard";
import { latestSandboxRun, sandboxConfigured } from "@/lib/prototypes/sandbox";
import { sharesOf } from "@/lib/prototypes/shares";
import { SandboxControl } from "./sandbox-control";
import { type AcceptedTemplate, eligibility, liveTemplateFor } from "@/lib/prototypes/templates";
import { createShareAction, revokeShareAction } from "./share-actions";
import { SharePanel } from "./share-panel";
import { Status } from "@/components/ui/status";
import { withdrawAction } from "./accept/actions";
import { addNoteAction, deletePrototypeAction, forkAction, rateAction, refineAction, renameAction } from "./actions";
import { CodeView, codeFiles } from "./code-view";
import { FeedbackView } from "./feedback-view";
import { prototypeOutcome } from "./outcomes";
import { ProvenanceView } from "./provenance-view";
import { RatingForm } from "./rating-form";
import { RenameForm } from "./rename-form";
import { TABS, type TabId } from "./tabs";
import { VersionPicker } from "./version-picker";
import styles from "./prototype.module.css";

type Query = Record<string, string | string[] | undefined>;

interface Loaded {
  readonly prototype: Prototype;
  readonly versions: KeptVersion[];
  readonly refinements: ThreadEntry[];
  readonly feedbackOf: (versionId: string) => Promise<Feedback[]>;
  readonly template: AcceptedTemplate | null;
  readonly shares: Awaited<ReturnType<typeof sharesOf>>;
  readonly sandboxRunOf: (versionId: string) => ReturnType<typeof latestSandboxRun>;
}

async function load(prototypeId: string): Promise<Loaded> {
  if (!isPublicId(prototypeId, "pro")) notFound();
  const { db, workspace } = await prototypesRequest();
  try {
    const prototype = await getPrototype(db, workspace.id, prototypeId);
    return { prototype, versions: await versionsOf(db, prototype.id), refinements: await refinementsOf(db, prototype.id), feedbackOf: (versionId) => feedbackFor(db, versionId), template: await liveTemplateFor(db, prototype.id), shares: await sharesOf(db, workspace.id, prototype.id), sandboxRunOf: (versionId) => latestSandboxRun(db, workspace.id, versionId) };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ prototypeId: string }> }): Promise<Metadata> {
  const { prototypeId } = await params;
  if (!isPublicId(prototypeId, "pro")) return { title: "Prototype not found" };
  const { db, workspace } = await prototypesRequest();
  const prototype = await getPrototype(db, workspace.id, prototypeId).catch(() => null);
  return { title: prototype ? `${prototype.name} · Prototypes` : "Prototype not found" };
}

/** The version a page shows: the one in the address, or the latest (versions spec, "Versions are numbered and immutable"). */
function shownVersion(versions: readonly KeptVersion[], query: Query): KeptVersion | undefined {
  const requested = Number.parseInt(typeof query.v === "string" ? query.v : "", 10);
  return versions.find((version) => version.number === requested) ?? versions.at(-1);
}

/** The thread: how version 1 came about, then every refinement with the version it produced. */
function threadItems(versions: readonly KeptVersion[], refinements: readonly ThreadEntry[], href: (number: number) => string): ThreadItem[] {
  const first = versions[0];
  const origin: ThreadItem[] = first?.provenance
    ? [
        first.provenance.forkedFrom
          ? { id: first.id, kind: "forked", text: `From ${first.provenance.forkedFrom.prototypeName} v${first.provenance.forkedFrom.number}`, stage: null, summary: null, failure: null, version: { number: 1, href: href(1) } }
          : first.provenance.startedFromTemplate
            ? { id: first.id, kind: "template", text: first.provenance.startedFromTemplate.title, stage: null, summary: null, failure: null, version: { number: 1, href: href(1) } }
            : { id: first.id, kind: "generated", text: first.provenance.intent, stage: null, summary: first.provenance.direction ? `${first.provenance.direction.title}: ${first.provenance.direction.sentence}` : first.summary, failure: null, version: { number: 1, href: href(1) } },
      ]
    : [];
  return [
    ...origin,
    ...refinements.map(({ generation, variant, version }): ThreadItem => {
      const number = version?.number ?? null;
      const running = variant?.status === "running";
      return {
        id: generation.id,
        kind: "refined",
        text: generation.message ?? "",
        stage: running ? (version?.status === "ready" ? "reviewing" : variant!.stage) : variant?.status === "failed" ? "failed" : null,
        summary: number ? (version?.summary ?? null) : null,
        failure: variant?.status === "failed" ? (variant.failure?.message ?? null) : null,
        version: number ? { number, href: href(number) } : null,
      };
    }),
  ];
}

/**
 * A prototype's page (prototypes/versions spec; design.md, decision 15): a
 * focused page, with the thread of messages and versions on the left and the
 * version shown, with its tabs, on the right. Every choice lives in the
 * address: the version, the tab, the file, and the preview's mode, density,
 * and device. A message builds the next version on the version shown, and
 * only one refinement runs at a time.
 */
export default async function PrototypePage({ params, searchParams }: { params: Promise<{ prototypeId: string }>; searchParams: Promise<Query> }) {
  const [{ prototypeId }, query] = await Promise.all([params, searchParams]);
  const { prototype, versions, refinements, feedbackOf, template, shares, sandboxRunOf } = await load(prototypeId);
  const version = shownVersion(versions, query);
  if (!version) notFound();
  const tab: TabId = typeof query.tab === "string" && query.tab in TABS ? (query.tab as TabId) : "preview";
  const preview = parseFramePreview(query);
  const action = `/prototypes/${prototype.id}`;
  const isLatest = version.number === prototype.latestNumber;
  const versionQuery = (number: number): Record<string, string> => (number === prototype.latestNumber ? {} : { v: String(number) });
  const href = (extra: Record<string, string>) => {
    const search = new URLSearchParams(extra);
    return `${action}${search.size ? `?${search}` : ""}`;
  };
  const tabHref = (id: TabId) => href({ ...versionQuery(version.number), ...(id === "preview" ? {} : { tab: id }), ...previewQuery(preview) });
  const keep: Record<string, string> = { ...versionQuery(version.number), ...(tab === "preview" ? {} : { tab }) };
  const refining = Boolean(prototype.refiningGenerationId);
  const available = generationConfigured(getConfig().prototypes);
  const summary = checkSummary(version);
  const gates = version.attempts.at(-1)?.gates ?? [];
  const highlightIndex = Number.parseInt(param(query, "highlight") ?? "", 10);
  const highlight = Number.isInteger(highlightIndex) ? version.audit?.violations[highlightIndex]?.targets : undefined;
  const files = codeFiles(version.code, version.sampleData?.source ?? "", version.scope);
  const parent = versions.find((entry) => entry.id === version.provenance?.parentVersionId);
  // Compare the version shown with the one it was built on, the one before it, or the version its fork came from.
  const compareWith = parent?.number ?? (version.number > 1 ? version.number - 1 : versions[0]?.provenance?.forkedFrom ? "origin" : null);
  // Accept is offered only for a page, and only where the gallery it publishes to exists; for an ineligible version it is unavailable and names the blocker.
  const acceptable = version.scope === "page" && templatesAvailable() ? eligibility(version) : null;
  const isTemplate = template?.versions.some((entry) => entry.snapshot.versionId === version.id) ?? false;
  const given = await feedbackOf(version.id);
  const rating = given.find((entry) => entry.kind === "rating");
  const notes = given.filter((entry) => entry.kind === "note");
  const openNotes = notes.flatMap((note, index) => (note.noteStatus === "open" && note.element ? [{ id: note.id, number: index + 1, locator: note.element.locator, text: note.text ?? "", component: note.element.component }] : []));

  return (
    <Page>
      <ShellHeader title={prototype.name} back={{ href: "/prototypes", label: "Back to Prototypes" }} />
      {refining && <ProgressPoller url={`/api/prototypes/${prototype.id}/status`} version={`${prototype.latestNumber}|${prototype.refiningGenerationId}`} />}
      <OutcomeToast outcome={prototypeOutcome(param(query, "notice"), prototype, versions[0]?.provenance)} strip={["notice"]} />
      {!version.audit && <AuditRunner versionId={version.id} title={version.title || prototype.name} />}
      <div className={styles.layout}>
        <aside className={styles.thread} aria-label="Thread and refinements">
          <div className={styles.threadHead}>
            <p className={styles.name}>{prototype.name}</p>
            <VersionPicker action={action} versions={versions.map((entry) => entry.number)} shown={version.number} keep={{ ...(tab === "preview" ? {} : { tab }), ...previewQuery(preview) }} />
            {prototype.generationId && (
              <Link href={`/prototypes/generations/${prototype.generationId}`} className={styles.originLink}>
                See the variants it was kept from
              </Link>
            )}
          </div>
          <ThreadView items={threadItems(versions, refinements, (number) => href(versionQuery(number)))} current={version.number} />
          <Composer
            action={refineAction.bind(null, prototype.id, version.id)}
            label={isLatest ? "Ask for a change" : `Ask for a change to version ${version.number}`}
            placeholder="Group by cut-off time and show the total per group"
            unavailable={refining ? "A refinement is running. Send the next message when it finishes." : !available ? "Generation isn't configured in this environment." : null}
            maxLength={NOTE_LENGTH}
          />
          {template && templatesAvailable() && (
            <div className={styles.accepted} data-accepted="">
              <Status state="pass" label={`Accepted as template v${template.latest.number}, from v${template.latest.snapshot.number}`} />
              <Link href={`/templates/${template.slug}`}>{`${template.latest.title} in Salt Patterns`}</Link>
              <ConfirmDialog action={withdrawAction} fields={{ prototype: prototype.id, template: template.id }} trigger={{ label: "Withdraw template", variant: "tertiary", size: "sm" }} title={`Withdraw ${template.latest.title}?`} confirmLabel="Withdraw template" tone="danger">
                Every version of it leaves the Salt Patterns gallery for everyone. Prototypes already started from it keep their copies.
              </ConfirmDialog>
            </div>
          )}
          <AiNotice confidential />
          <Disclosure summary="Share or download">
            <SharePanel
              prototypeId={prototype.id}
              number={version.number}
              create={createShareAction.bind(null, prototype.id, version.id)}
              revoke={revokeShareAction}
              links={shares.map((share) => ({ id: share.id, number: share.number, createdAt: share.createdAt }))}
              downloadHref={`/api/prototypes/versions/${version.id}/download`}
              downloadName={archiveName(prototype.name, version.number)}
              sandbox={<SandboxControl prototypeId={prototype.id} versionId={version.id} number={version.number} configured={sandboxConfigured()} run={await sandboxRunOf(version.id)} />}
            />
          </Disclosure>
          <Disclosure summary="Rename or delete">
            <div className={styles.manage}>
              <RenameForm action={renameAction.bind(null, prototype.id)} name={prototype.name} />
              <ConfirmDialog action={deletePrototypeAction} fields={{ prototype: prototype.id }} trigger={{ label: "Delete prototype", icon: "trash", variant: "danger", size: "sm" }} title={`Delete ${prototype.name}?`} confirmLabel="Delete prototype" tone="danger">
                Its versions, feedback, and share links are deleted. Lessons learned from it remain, and so does any template accepted from it.
              </ConfirmDialog>
            </div>
          </Disclosure>
        </aside>
        <section className={styles.work} aria-label={`Version ${version.number}`} data-version-audit={version.audit ? "done" : "pending"}>
          <div className={styles.versionBar}>
            <p className={styles.muted} data-version-summary="">
              {`${isLatest ? `Version ${version.number}` : `Version ${version.number} of ${versions.length}`}: ${summary.text}${rating?.rating ? `, rated ${rating.rating} of 5` : ""}`}
            </p>
            <div className={styles.versionActions}>
              {compareWith !== null && (
                <ButtonLink href={`${action}/compare?${new URLSearchParams({ a: String(compareWith), b: String(version.number) })}`} size="sm" icon="columns">
                  Compare
                </ButtonLink>
              )}
              {acceptable && !isTemplate && (acceptable.eligible ? (
                <ButtonLink href={`${action}/accept${isLatest ? "" : `?v=${version.number}`}`} size="sm" icon="checkCircle">
                  {template ? `Accept as template v${template.latestNumber + 1}` : "Accept as template"}
                </ButtonLink>
              ) : (
                <span className={styles.blocked} data-accept-blocked="">
                  <Button type="button" size="sm" icon="checkCircle" disabled aria-describedby="accept-blocked">
                    Accept as template
                  </Button>
                  <span id="accept-blocked" className={styles.muted}>{acceptable.reason}</span>
                </span>
              ))}
              <form action={forkAction}>
                <input type="hidden" name="prototype" value={prototype.id} />
                <input type="hidden" name="version" value={version.id} />
                <Button type="submit" size="sm" icon="copy" aria-label={`Fork version ${version.number}`}>
                  Fork
                </Button>
              </form>
            </div>
          </div>
          <Tabs label="Version views">
            {(Object.keys(TABS) as TabId[]).map((id) => (
              <TabLink key={id} href={tabHref(id)} active={tab === id}>
                {TABS[id]}
              </TabLink>
            ))}
          </Tabs>
          {tab === "preview" && (
            <div className={styles.preview}>
              <PreviewControls action={action} state={preview} keep={keep} frameBase={`/prototypes/render/${version.id}`} />
              <NotesPreview versionId={version.id} title={version.title || prototype.name} state={preview} renderErrorRecorded={Boolean(version.renderError)} highlight={highlight} notes={openNotes} addNote={addNoteAction.bind(null, prototype.id, version.id)} />
            </div>
          )}
          {tab === "code" && <CodeView files={files} selected={param(query, "file") ?? "Prototype.tsx"} hrefFor={(path) => href({ ...versionQuery(version.number), tab: "code", ...(path === "Prototype.tsx" ? {} : { file: path }) })} />}
          {tab === "checks" && (
            <ChecksPanel
              gates={gates}
              attempts={version.attempts}
              firstPass={version.firstPass}
              audit={version.audit}
              renderError={version.renderError}
              fit={version.fit}
              highlightHref={(index) => href({ ...versionQuery(version.number), highlight: String(index), ...previewQuery(preview) })}
            />
          )}
          {tab === "feedback" && (
            <div className={styles.feedbackTab}>
              <RatingForm action={rateAction.bind(null, prototype.id, version.id)} current={rating?.rating ? { rating: rating.rating, note: rating.text ?? "" } : null} v={isLatest ? null : String(version.number)} />
              <FeedbackView entries={given} prototypeId={prototype.id} v={isLatest ? null : String(version.number)} addressedBy={(id) => versions.find((entry) => entry.id === id)?.number ?? null} />
            </div>
          )}
          {tab === "provenance" && version.provenance && <ProvenanceView provenance={version.provenance} attempts={version.attempts} parentHref={parent ? href(versionQuery(parent.number)) : null} parentNumber={parent?.number ?? null} />}
        </section>
      </div>
    </Page>
  );
}
