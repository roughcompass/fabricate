import type { Metadata } from "next";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { AiNotice } from "@/components/prototypes/ai-notice";
import { ProgressPoller } from "@/components/progress-poller";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import type { PrototypesExecutor } from "@/lib/prototypes/db/client";
import { feedback, versions } from "@/lib/prototypes/db/schema";
import { getConfig } from "@/lib/config";
import { VARIANTS_PER_INTENT, lessonCheckSummary, listBenchmarks, listLessonChecks } from "@/lib/prototypes/lesson-check";
import { type Lesson, listLessons } from "@/lib/prototypes/lessons";
import { generationConfigured } from "@/lib/prototypes/models";
import { remainingToday } from "@/lib/prototypes/workspace";
import { LESSON_LIMIT } from "@/lib/prototypes/limits";
import { listPersonas } from "@/lib/prototypes/personas";
import { type Measures, progressRows, progressSummary } from "@/lib/prototypes/progress";
import { prototypesRequest } from "@/lib/prototypes/request";
import { formatFit } from "@/lib/prototypes/summary";
import { acceptLessonAction, deleteLessonAction, dismissLessonAction, runLessonCheckAction, saveBenchmarkAction, saveLessonAction, toggleLessonAction } from "./actions";
import { BenchmarkForm, LessonCheckForm } from "./lesson-check-forms";
import { LessonForm } from "./lesson-form";
import styles from "./lessons.module.css";

export const metadata: Metadata = { title: "Lessons" };

const GATE_LABELS: Record<string, string> = { typecheck: "typecheck", "salt-only": "Salt-only", "salt-usage": "Salt usage", build: "build" };

const VIEWS = { lessons: "Lessons", progress: "Progress", check: "Lesson check" } as const;
type View = keyof typeof VIEWS;

const SOURCES: Record<Lesson["source"], string> = { agent: "Learned from feedback", visitor: "Written by you", seed: "Example" };

/** Where each cited feedback or failure can be seen: the version's Feedback or Checks tab. */
async function citationLinks(db: PrototypesExecutor, all: readonly Lesson[]): Promise<Map<string, { href: string; label: string }[]>> {
  const feedbackIds = all.flatMap((lesson) => lesson.citations.flatMap((citation) => (citation.kind === "feedback" ? [citation.feedbackId] : [])));
  const versionIds = all.flatMap((lesson) => lesson.citations.flatMap((citation) => (citation.kind === "failure" ? citation.versionIds.slice(0, 2) : [])));
  const cited = feedbackIds.length ? await db.select({ id: feedback.id, kind: feedback.kind, versionId: feedback.versionId }).from(feedback).where(inArray(feedback.id, feedbackIds)) : [];
  const allVersions = [...versionIds, ...cited.flatMap((entry) => (entry.versionId ? [entry.versionId] : []))];
  const rows = allVersions.length ? await db.select({ id: versions.id, prototypeId: versions.prototypeId, number: versions.number, generationId: versions.generationId }).from(versions).where(inArray(versions.id, allVersions)) : [];
  const href = (versionId: string | null, tab: string) => {
    const version = rows.find((row) => row.id === versionId);
    if (!version) return null;
    return version.prototypeId ? `/prototypes/${version.prototypeId}?v=${version.number}&tab=${tab}` : `/prototypes/generations/${version.generationId}`;
  };
  const KIND_LABELS: Record<string, string> = { "keep-reason": "keep reason", "discard-reason": "discard reason", rating: "rating note", note: "element note" };
  return new Map(
    all.map((lesson) => [
      lesson.id,
      lesson.citations.flatMap((citation) => {
        if (citation.kind === "feedback") {
          const entry = cited.find((row) => row.id === citation.feedbackId);
          const link = entry && href(entry.versionId, "feedback");
          return link ? [{ href: link, label: `A ${KIND_LABELS[entry.kind] ?? "note"}` }] : [];
        }
        // A recurring failure links once, to its first occurrence, named by its gate; the full signature is on the Checks tab.
        const link = href(citation.versionIds[0] ?? null, "checks");
        const gate = GATE_LABELS[citation.signature.split(":")[0] ?? ""] ?? "check";
        return link ? [{ href: link, label: `A recurring ${gate} failure` }] : [];
      }),
    ]),
  );
}

/** One link per kind of source, counted when it repeats, such as "A recurring typecheck failure (2)". */
function distinct(links: readonly { href: string; label: string }[]): { href: string; label: string }[] {
  const seen = new Map<string, { href: string; label: string; count: number }>();
  for (const link of links) {
    const entry = seen.get(link.label);
    if (entry) entry.count += 1;
    else seen.set(link.label, { ...link, count: 1 });
  }
  return [...seen.values()].map(({ href, label, count }) => ({ href, label: count > 1 ? `${label} (${count})` : label }));
}

const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const number = (value: number | null) => (value === null ? "—" : formatFit(value));

function MeasuresList({ label, measures }: { label: string; measures: Measures }) {
  return (
    <Panel title={label} level={3}>
      <DescriptionList
        items={[
          ["First-attempt passes", percent(measures.firstPassRate)],
          ["Repairs per generation", formatFit(measures.repairs)],
          ["Average fit", number(measures.fit)],
          ["Average rating", number(measures.rating)],
          ["Lessons applied", formatFit(measures.lessons)],
        ]}
      />
    </Panel>
  );
}

/**
 * The Lessons page (learning spec): proposed, active, and turned-off lessons,
 * each with its scope, category, source, citations, and how many versions
 * applied it, under the visitor's control; and the Progress section, which
 * shows what each generation measured, never a claim of improvement.
 */
export default async function LessonsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requested = (await searchParams).view;
  const view: View = typeof requested === "string" && requested in VIEWS ? (requested as View) : "lessons";
  const { db, workspace } = await prototypesRequest();
  const [all, people, rows, benchmarks, checks] = await Promise.all([listLessons(db, workspace.id), listPersonas(db, workspace.id), progressRows(db, workspace.id), listBenchmarks(db, workspace.id), listLessonChecks(db, workspace.id)]);
  const settings = getConfig().prototypes;
  const links = await citationLinks(db, all);
  const summary = progressSummary(rows);
  const byId = new Map(all.map((lesson) => [lesson.id, lesson]));
  const scopeValue = (lesson: Lesson) => (lesson.scope.kind === "general" ? "general" : lesson.scope.personaId);
  const personas = people.map((persona) => ({ id: persona.id, name: persona.name }));

  const item = (lesson: Lesson) => {
    const target = lesson.editsLessonId ? byId.get(lesson.editsLessonId) : undefined;
    const conflict = lesson.conflictsWithLessonId ? byId.get(lesson.conflictsWithLessonId) : undefined;
    return (
      <li key={lesson.id} className={styles.lesson} data-lesson={lesson.id} data-lesson-status={lesson.status}>
        {target && (
          <p className={styles.change} data-lesson-edit="">
            Edits <del>{target.text}</del>
          </p>
        )}
        <p className={styles.text}>{lesson.text}</p>
        {conflict && <p className={styles.change} data-lesson-conflict="">{`Contradicts the active lesson “${conflict.text}”. Accepting this one turns that one off.`}</p>}
        <p className={styles.meta}>
          <span>{lesson.scope.kind === "general" ? "Every persona" : `For ${lesson.scope.personaName}`}</span>
          <span>{lesson.category}</span>
          <span>{lesson.source === "agent" && lesson.citations.length > 0 && lesson.citations.every((citation) => citation.kind === "failure") ? "Learned from checks" : SOURCES[lesson.source]}</span>
          {lesson.status !== "proposed" && <span data-applied={lesson.appliedCount}>{`Applied by ${lesson.appliedCount} ${lesson.appliedCount === 1 ? "version" : "versions"}`}</span>}
          {distinct(links.get(lesson.id) ?? []).map((link, index) => (
            // Two citations can link to the same page, such as two discard reasons from one generation.
            <Link key={`${index}:${link.href}`} href={link.href}>
              {link.label}
            </Link>
          ))}
        </p>
        <div className={styles.actions}>
          {lesson.status === "proposed" ? (
            <>
              <form action={acceptLessonAction}>
                <input type="hidden" name="lesson" value={lesson.id} />
                <Button type="submit" variant="primary" size="sm" icon="check">
                  Accept
                </Button>
              </form>
              <form action={dismissLessonAction}>
                <input type="hidden" name="lesson" value={lesson.id} />
                <Button type="submit" size="sm">
                  Dismiss
                </Button>
              </form>
            </>
          ) : (
            <form action={toggleLessonAction}>
              <input type="hidden" name="lesson" value={lesson.id} />
              <input type="hidden" name="active" value={lesson.status === "active" ? "false" : "true"} />
              <Button type="submit" size="sm">
                {lesson.status === "active" ? "Turn off" : "Turn on"}
              </Button>
            </form>
          )}
          {lesson.status !== "proposed" && (
            <ConfirmDialog action={deleteLessonAction} fields={{ lesson: lesson.id }} trigger={{ label: "Delete", variant: "tertiary", size: "sm" }} title="Delete this lesson?" confirmLabel="Delete lesson" tone="danger">
              Later generations stop applying it. Versions that applied it keep their copy.
            </ConfirmDialog>
          )}
        </div>
        <Disclosure summary={lesson.status === "proposed" ? "Edit, then accept" : "Edit"} variant="plain">
          <LessonForm id={`edit-${lesson.id}`} action={saveLessonAction.bind(null, lesson.status === "proposed" ? "accept" : "edit", lesson.id)} initial={{ text: lesson.text, category: lesson.category, scope: scopeValue(lesson) }} personas={personas} submitLabel={lesson.status === "proposed" ? "Accept with edits" : "Save lesson"} />
        </Disclosure>
      </li>
    );
  };

  const proposed = all.filter((lesson) => lesson.status === "proposed");
  const active = all.filter((lesson) => lesson.status === "active");
  const off = all.filter((lesson) => lesson.status === "off");
  const list = (label: string, lessons: readonly Lesson[]) => (
    <ul className={styles.list} aria-label={label}>
      {lessons.map(item)}
    </ul>
  );
  const href = (id: View) => (id === "lessons" ? "/prototypes/lessons" : `/prototypes/lessons?view=${id}`);

  return (
    <Page>
      <PageHeader title="Lessons" description="Short rules that earlier feedback taught. Every later generation applies the active ones that fit its personas." />
      <Tabs label="Lessons views">
        {(Object.keys(VIEWS) as View[]).map((id) => (
          <TabLink key={id} href={href(id)} active={view === id} count={id === "lessons" && proposed.length ? proposed.length : undefined}>
            {VIEWS[id]}
          </TabLink>
        ))}
      </Tabs>
      {view === "lessons" && (
        <>
          <AiNotice confidential />
          {proposed.length > 0 && (
            <Section id="lessons-proposed" title="To review" description="Proposed from your feedback and from checks that keep failing. They apply only once you accept them.">
              {list("Lessons to review", proposed)}
            </Section>
          )}
          <Section id="lessons-active" title="Active" description={`Applied to every new generation and refinement whose personas they fit. A workspace holds up to ${LESSON_LIMIT} lessons.`}>
            <Disclosure summary="Write a lesson">
              <LessonForm id="new-lesson" action={saveLessonAction.bind(null, "add", null)} initial={{ text: "", category: "Content", scope: "general" }} personas={personas} submitLabel="Add lesson" />
            </Disclosure>
            {active.length ? list("Active lessons", active) : <p className={styles.muted}>No active lessons yet. Accept a proposal, or write one.</p>}
          </Section>
          {off.length > 0 && (
            <Disclosure summary={`Turned off (${off.length})`} variant="plain">
              <p className={styles.muted}>{"Generations don't apply these. Versions that applied them keep their copies."}</p>
              {list("Turned off lessons", off)}
            </Disclosure>
          )}
        </>
      )}
      {view === "progress" && (
        <Section id="progress" title="Progress" description="What each generation measured, oldest first, up to the latest 30. These are measured values, not proof that lessons helped.">
          {summary.enough && summary.earliest && summary.latest ? (
            <div className={styles.summary} data-progress-summary="">
              <MeasuresList label="Earliest five generations" measures={summary.earliest} />
              <MeasuresList label="Latest five generations" measures={summary.latest} />
            </div>
          ) : (
            <p className={styles.muted} data-progress-summary="not-enough">
              {`There isn't enough data yet: the summary compares the earliest five generations with the latest five, so it needs at least six${rows.length ? `, and there ${rows.length === 1 ? "is 1" : `are ${rows.length}`} so far` : ""}.`}
            </p>
          )}
          <Panel flush>
            {rows.length ? (
              <Table
                label="Progress per generation"
                head={
                  <>
                    <Th>Generation</Th>
                    <Th>First attempt</Th>
                    <Th align="numeric">Repairs</Th>
                    <Th align="numeric">Fit</Th>
                    <Th align="numeric">Rating</Th>
                    <Th align="numeric">Lessons applied</Th>
                  </>
                }
              >
                {rows.map((row) => (
                  <tr key={row.generationId} data-progress-row={row.generationId}>
                    <Td label="Generation">
                      {row.intent}
                      <Secondary>
                        {row.kind === "refine" ? "Refinement · " : ""}
                        <RelativeTime value={row.createdAt} />
                      </Secondary>
                    </Td>
                    <Td label="First attempt">{row.firstPass === null ? <Secondary>No version</Secondary> : <Status state={row.firstPass ? "pass" : "fail"} label={row.firstPass ? "Passed" : "Failed"} />}</Td>
                    <Td label="Repairs" align="numeric">
                      {row.repairs}
                    </Td>
                    <Td label="Fit" align="numeric">
                      {number(row.fit)}
                    </Td>
                    <Td label="Rating" align="numeric">
                      {number(row.rating)}
                    </Td>
                    <Td label="Lessons applied" align="numeric">
                      {row.lessons}
                    </Td>
                  </tr>
                ))}
              </Table>
            ) : (
              <EmptyState title="No generations yet" icon="clock">
                Each generation and refinement adds a row here.
              </EmptyState>
            )}
          </Panel>
        </Section>
      )}
      {view === "check" && (
        <LessonCheckSection
          benchmarks={benchmarks}
          checks={checks}
          personas={personas}
          remaining={remainingToday(workspace, settings.dailyVariantLimit)}
          unavailable={!generationConfigured(settings) ? "Generation isn't configured in this environment." : active.length ? null : "Accept or add a lesson to check it."}
        />
      )}
    </Page>
  );
}

const SIDES = { true: "Passed", false: "Failed", null: "Not generated" } as const;

/**
 * The lesson check (learning spec, "A lesson check measures whether lessons
 * help"): each benchmark intent generated with and without the active
 * lessons, judged pairwise. Results keep the date, intents, and lessons they
 * used, and state what was measured, never a claim of improvement.
 */
function LessonCheckSection({ benchmarks, checks, personas, remaining, unavailable }: { benchmarks: Awaited<ReturnType<typeof listBenchmarks>>; checks: Awaited<ReturnType<typeof listLessonChecks>>; personas: readonly { id: string; name: string }[]; remaining: number; unavailable: string | null }) {
  const running = checks.find((check) => check.status === "running");
  const uses = benchmarks.length * VARIANTS_PER_INTENT;
  return (
    <Section id="lesson-check" title="Do lessons help?" description="Generates each benchmark intent once with the active lessons and once without, then judges each pair with a pairwise review. Three pairs are evidence, not proof.">
      {running ? (
        <p className={styles.muted} data-lesson-check-running="">
          <ProgressPoller url={`/api/prototypes/lesson-checks/${running.id}/status`} version={running.status} />
          <Status state="checking" label="A lesson check is running" />
        </p>
      ) : (
        <LessonCheckForm action={runLessonCheckAction} uses={uses} remaining={remaining} unavailable={unavailable} />
      )}
      <Disclosure summary="Benchmark intents">
        <div className={styles.list}>
          {benchmarks.map((benchmark, index) => (
            <BenchmarkForm key={benchmark.id} id={`benchmark-${index + 1}`} label={`Benchmark ${index + 1}`} action={saveBenchmarkAction.bind(null, benchmark.id)} initial={{ intent: benchmark.intent, scope: benchmark.scope, personas: benchmark.personaIds }} personas={personas} />
          ))}
        </div>
      </Disclosure>
      {checks
        .filter((check) => check.status !== "running")
        .map((check) => (
          <Panel key={check.id} flush>
            <div className={styles.check} data-lesson-check={check.id}>
              <p className={styles.text}>{check.result ? lessonCheckSummary(check.result) : (check.error?.message ?? "The lesson check failed.")}</p>
              <p className={styles.meta}>
                <RelativeTime value={check.createdAt} />
                <span>{`${check.lessons.length} ${check.lessons.length === 1 ? "lesson" : "lessons"} checked`}</span>
              </p>
              <ul className={styles.plain} aria-label="Lessons it checked">
                {check.lessons.map((lesson) => (
                  <li key={lesson.id}>{lesson.text}</li>
                ))}
              </ul>
            </div>
            {check.result && (
              <Table
                label="Pairs"
                head={
                  <>
                    <Th>Benchmark intent</Th>
                    <Th>Result</Th>
                    <Th>Checks with lessons</Th>
                    <Th>Checks without</Th>
                  </>
                }
              >
                {check.result.pairs.map((pair, index) => (
                  <tr key={index} data-lesson-check-pair={index + 1}>
                    <Td label="Benchmark intent">{pair.intent}</Td>
                    <Td label="Result">
                      <Status state={pair.winner === "with" ? "pass" : pair.winner === "without" ? "fail" : "undecided"} label={pair.winner === "with" ? "Lessons won" : pair.winner === "without" ? "Lessons lost" : "Undecided"} />
                    </Td>
                    <Td label="Checks with lessons">{SIDES[String(pair.withGates) as keyof typeof SIDES]}</Td>
                    <Td label="Checks without">{SIDES[String(pair.withoutGates) as keyof typeof SIDES]}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        ))}
    </Section>
  );
}
