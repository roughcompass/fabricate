import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FocusPanel } from "@/components/relationships/focus";
import { RelationshipsTable } from "@/components/relationships/relationships-table";
import { Alert } from "@/components/ui/alert";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { SearchField } from "@/components/ui/search-field";
import { Section } from "@/components/ui/section";
import { statusLabel } from "@/components/ui/status";
import { formatAbsolute, formatDate } from "@/components/ui/time";
import { targetsOf } from "@/lib/assessments/assessment-records";
import { type PathStep, type RelationshipScope, SEARCH_KINDS, type SearchMatch, focusOf, relationshipPage, searchMap, withQuery } from "@/lib/relationships/levels";
import type { MapView } from "@/lib/relationships/map-view";
import type { LoadedRun } from "./load";
import styles from "./map.module.css";

type Query = Record<string, string | string[] | undefined>;

const KIND_TITLES: Record<SearchMatch["kind"], string> = { repository: "Repositories", application: "Applications", portal: "Portals", service: "Services", package: "Packages" };

/** A positive page number from the address, or 1. */
function pageParam(query: Query, name: string): number {
  const value = Number.parseInt(param(query, name) ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** The breadcrumbs from the Assessments list, or for a profile version the Repositories list, to the Run's map. */
function runCrumbs(run: LoadedRun, withMap: boolean): PathStep[] {
  return [
    ...run.context.parents,
    { href: `/runs/${run.assessment.publicId}`, label: run.context.name },
    ...(withMap ? [{ href: `/runs/${run.assessment.publicId}/map`, label: "Relationship Map" }] : []),
  ];
}

/** The page a Run shows before its map is written. */
export function NoMap({ run }: { run: LoadedRun }) {
  return (
    <Page>
      <PageHeader breadcrumbs={runCrumbs(run, false)} title="Relationship Map" />
      <Panel flush>
        <EmptyState title="No Relationship Map yet" icon="network">
          The map is written once every scoped repository has finished, from the Profiles that completed.
        </EmptyState>
      </Panel>
    </Page>
  );
}

/**
 * One level of the Relationship Map: its path from the Run, the date its
 * ownership is current as of, search, an optional focus beside the level,
 * and the relationships table scoped to the level or the focus.
 */
export function MapLevel({
  run,
  view,
  query,
  title,
  ancestors,
  description,
  levelHref,
  scope,
  scopeDescription,
  children,
}: {
  run: LoadedRun;
  view: MapView;
  query: Query;
  title: string;
  ancestors: readonly PathStep[];
  description: string;
  levelHref: string;
  scope: RelationshipScope;
  scopeDescription: string;
  children: React.ReactNode;
}) {
  const { db, assessment } = run;
  const search = (param(query, "q") ?? "").trim().slice(0, 200);
  const focusId = param(query, "focus");
  const matches = search ? searchMap(db, view, search) : [];
  const exact = matches.filter((match) => match.rank === 0);
  if (exact.length === 1) redirect(exact[0]!.href);

  const pages = { dependents: pageParam(query, "dependents"), dependencies: pageParam(query, "dependencies") };
  const focus = focusId ? focusOf(db, view, levelHref, focusId, pages) : undefined;
  const tableScope: RelationshipScope = focus ? (focus.kind === "package" ? { kind: "package", name: focus.label } : { kind: "touching", node: focus.nodeId! }) : scope;
  const page = relationshipPage(db, view, tableScope, pageParam(query, "page"));
  const keep = { focus: focusId };
  const failures = new Map(targetsOf(db, assessment.id).flatMap((target) => (target.failureMessage ? [[target.publicId, target.failureMessage] as const] : [])));
  const breadcrumbs = [...runCrumbs(run, ancestors.length > 0 || levelHref !== view.base), ...ancestors];

  return (
    <Page>
      <PageHeader
        breadcrumbs={levelHref === view.base ? runCrumbs(run, false) : breadcrumbs}
        title={title}
        description={description}
        meta={[
          view.asOf ? (
            <time key="as-of" dateTime={view.asOf.toISOString()} title={formatAbsolute(view.asOf)}>
              {`Ownership as of ${formatDate(view.asOf)}`}
            </time>
          ) : (
            <span key="as-of">No ownership claimed yet</span>
          ),
        ]}
        alerts={
          view.missing.length > 0 && (
            <Alert tone="warning" title={`${countLabel(view.missing.length, "repository", "repositories")} did not contribute`}>
              <ul>
                {view.missing.map((gap) => (
                  <li key={gap.target}>
                    <strong>{gap.source}</strong>
                    {` · ${statusLabel(gap.state)}: `}
                    {failures.get(gap.target) ?? (gap.state === "canceled" ? "stopped before it finished" : "no reason was recorded")}
                    {gap.reason && (
                      <>
                        {" "}
                        <span className={styles.code}>{gap.reason}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <p>Relationships these repositories declare are missing, and an unresolved reference might belong to one of them. Evaluations treat what they could contain as unknown.</p>
            </Alert>
          )
        }
      />

      <div>
        <Form key={search} action={levelHref} scroll={false} className={styles.search} role="search" aria-label="Search the map">
          <SearchField id="map-search" name="q" label="Search the map" hideLabel placeholder="Search repositories, applications, SEAL IDs, portals, services, and packages" defaultValue={search} clearHref={withQuery(levelHref, keep)} />
        </Form>
      </div>

      {search && <SearchResults search={search} matches={matches} />}

      {focusId && !focus && (
        <Alert tone="info" title="Nothing to focus">
          {"This Run's map has nothing to focus at that address. "}
          <Link href={levelHref}>Close focus</Link>
        </Alert>
      )}

      <div className={focus ? styles.withFocus : styles.level}>
        {focus && (
          <aside className={styles.focus} aria-label={`Focus: ${focus.label}`}>
            <FocusPanel
              focus={focus}
              assessmentId={assessment.publicId}
              closeHref={levelHref}
              pageHref={(list, number) => withQuery(levelHref, { focus: focusId, ...pages, [list]: number })}
            />
          </aside>
        )}
        <div className={styles.content}>{children}</div>
      </div>

      <RelationshipsTable
        page={page}
        assessmentId={assessment.publicId}
        focusHref={(nodeId) => withQuery(levelHref, { focus: nodeId })}
        pageHref={(number) => withQuery(levelHref, { ...keep, page: number })}
        coverageComplete={view.missing.length === 0}
        description={focus ? `The relationships of ${focus.label}, from the repository that declared each one.` : scopeDescription}
      />
    </Page>
  );
}

function SearchResults({ search, matches }: { search: string; matches: readonly SearchMatch[] }) {
  return (
    <Section title="Search results" description={`Matches for “${search}”, exact matches first.`}>
      <Panel>
        {matches.length === 0 ? (
          <p className={styles.muted}>{`Nothing in this Run matches “${search}”.`}</p>
        ) : (
          <div className={styles.results}>
            {SEARCH_KINDS.filter((kind) => matches.some((match) => match.kind === kind)).map((kind) => (
              <section key={kind} aria-label={KIND_TITLES[kind]} className={styles.resultGroup}>
                <h3 className={styles.resultTitle}>{KIND_TITLES[kind]}</h3>
                <ul className={styles.resultList}>
                  {matches
                    .filter((match) => match.kind === kind)
                    .map((match) => (
                      <li key={match.href}>
                        <Link href={match.href}>{match.label}</Link>
                        {match.detail && <span className={styles.muted}>{` · ${match.detail}`}</span>}
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>
    </Section>
  );
}
