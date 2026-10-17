import { and, count, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalLabel, RepositoryLabel } from "@/components/applications/application-card";
import { ApplicationSwitcher } from "@/components/applications/application-switcher";
import { ProgressPoller } from "@/components/progress-poller";
import { ActionButton, ButtonLink } from "@/components/ui/button";
import { buttonProps } from "@/components/ui/button-content";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Menu, MenuItem } from "@/components/ui/menu";
import { type Outcome, OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RelativeTime } from "@/components/ui/relative-time";
import { Status } from "@/components/ui/status";
import { findApplication } from "@/lib/applications/applications";
import { ACTIVE_RUN_STATES, type ApplicationAssessmentState, applicationAssessmentState } from "@/lib/applications/assessment";
import { applicationCatalog } from "@/lib/applications/catalog";
import { productionChecklist } from "@/lib/applications/checklist";
import { storedDetermination } from "@/lib/applications/determinations";
import { type Determination, type DeterminationFact, RENDERING_RULE_LABELS } from "@/lib/applications/rendering";
import { parseRepositoryUrl } from "@/lib/applications/repository-url";
import { starterBySlug } from "@/lib/applications/starters";
import { RENDERING_MODE_LABELS } from "@/lib/applications/vocabulary";
import { assessmentNumber, findAssessment } from "@/lib/assessments/assessment-records";
import { assessmentStatus } from "@/lib/assessments/status";
import { getSource, sourceReferenceLabel } from "@/lib/catalog/source-records";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { portalMenuItems, portals, repositorySources } from "@/lib/db/schema";
import { templateBySlug } from "@/lib/demo/catalog";
import { rememberedPortal } from "@/lib/web/portal-cookie";
import { rerunAssessmentAction } from "./actions";
import styles from "./dashboard.module.css";

/** The browser title of a registered Application's dashboard. */
export function applicationTitle(applicationId: string): string {
  const application = findApplication(getDb(), applicationId);
  return application?.name && application.repositorySourceId !== null ? `${application.name} · Applications` : "Application not found";
}

/** A dashboard notice's message, built from the record so a crafted link can't inject text. */
function dashboardOutcome(code: string | undefined, name: string): Outcome | undefined {
  const id = `${code}:${name}`;
  switch (code) {
    case "created":
      return { id, tone: "success", title: `${name} was created.`, description: "Its DE Web assessment started; the dashboard updates as it runs." };
    case "rerun":
      return { id, tone: "success", title: "The assessment started again.", description: "The earlier determination stays until it finishes." };
    case "couldnt-start":
      return { id, tone: "error", title: "The assessment couldn't start.", description: "The reason is on the dashboard." };
    case "already-running":
      return { id, tone: "info", title: `An assessment of ${name} is already queued or running.` };
    case "edited":
      return { id, tone: "success", title: "The details are saved." };
    default:
      return undefined;
  }
}

const STAGES = ["queued", ...ACTIVE_RUN_STATES.filter((state) => state !== "queued")] as const;
const STAGE_LABELS: Record<(typeof STAGES)[number], string> = { queued: "Waiting for a worker", acquiring: "Reading the repository", analyzing: "Profiling the repository", finalizing: "Recording the results" };

/** The assessment state, linked to its Run, with the stage and progress while it runs, or why it failed. */
function AssessmentSummary({ state, runNumber }: { state: ApplicationAssessmentState; runNumber: number | null }) {
  const label = <Status state={state.state} />;
  return (
    <span className={styles.assessment}>
      {state.run ? <Link href={`/runs/${state.run.publicId}`}>{label}</Link> : label}
      {state.run && runNumber !== null && <span className={styles.muted}>{`Run #${runNumber}`}</span>}
      {state.active && state.run && (
        <span className={styles.stage}>
          <span>{STAGE_LABELS[state.run.state as (typeof STAGES)[number]] ?? "Assessing"}</span>
          <ProgressBar value={STAGES.indexOf(state.run.state as (typeof STAGES)[number]) + 1} max={STAGES.length} label="Assessment progress" />
        </span>
      )}
      {state.reason && <span className={styles.muted}>{state.reason}</span>}
    </span>
  );
}

/** Each fact's file and line, linked to the Profile evidence the Run recorded. */
function FactList({ facts, run, label }: { facts: readonly DeterminationFact[]; run: string; label: string }) {
  return (
    <ul className={styles.facts} aria-label={label}>
      {facts.map((fact) => (
        <li key={`${fact.rule}:${fact.key}`}>
          <span>{fact.summary}</span>
          <span className={styles.evidence}>
            {fact.evidence.map((evidence) => (
              <Link key={evidence.id} href={`/runs/${run}/evidence/${evidence.id}`}>
                {evidence.path ?? "Evidence"}
                {evidence.lines ? `:${evidence.lines.start}` : ""}
              </Link>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The rendering determination, which opens to how it was decided
 * (application-dashboard spec, "The determination's evidence can be
 * inspected"): the rule, the deciding facts linked to their evidence, the
 * facts also observed, and the Run; for Undetermined, why and the
 * candidates.
 */
function DeterminationDetail({ determination, earlier }: { determination: Determination; earlier: number | null }) {
  return (
    <div id="rendering" className={styles.determination}>
      <Disclosure variant="plain" summary={RENDERING_MODE_LABELS[determination.mode]} aside={earlier !== null ? `From the earlier assessment, Run #${earlier}` : undefined}>
        <div className={styles.detail}>
          <p>
            <span className={styles.muted}>Rule: </span>
            {RENDERING_RULE_LABELS[determination.rule]}
          </p>
          {determination.reason && <p>{determination.reason}</p>}
          {determination.deciding.length > 0 && <FactList facts={determination.deciding} run={determination.assessment} label="Deciding facts" />}
          {determination.candidates.length > 0 && (
            <>
              <p className={styles.muted}>Candidates</p>
              <FactList facts={determination.candidates.map((candidate, index) => ({ ...candidate, rule: determination.rule, category: "composition", key: `candidate-${index}`, state: "conflicting" }))} run={determination.assessment} label="Candidates" />
            </>
          )}
          {determination.alsoObserved.length > 0 && (
            <>
              <p className={styles.muted}>Also observed</p>
              <FactList facts={determination.alsoObserved} run={determination.assessment} label="Also observed" />
            </>
          )}
          <p>
            <Link href={`/runs/${determination.assessment}`}>Open the Run</Link>
            {" · "}
            <Link href={`/profiles/${determination.profile}`}>Open the Profile</Link>
          </p>
        </div>
      </Disclosure>
    </div>
  );
}

/**
 * A registered Application's dashboard (application-dashboard spec; task
 * 8.1): its overview, with the assessment's progress live while it runs and
 * the rendering determination, then its Production checklist beside the
 * Observability and Analytics placeholders.
 */
export async function ApplicationDashboard({ applicationId, query }: { applicationId: string; query: Record<string, string | string[] | undefined> }) {
  const db = getDb();
  const config = getConfig();
  const application = findApplication(db, applicationId);
  if (!application || application.repositorySourceId === null || application.portalId === null || !application.name || !application.slug) notFound();

  const source = getSource(db, db.select({ publicId: repositorySources.publicId }).from(repositorySources).where(eq(repositorySources.id, application.repositorySourceId)).get()!.publicId);
  const portal = db.select().from(portals).where(eq(portals.id, application.portalId)).get()!;
  const menuItems = db.select({ n: count() }).from(portalMenuItems).where(and(eq(portalMenuItems.portalId, portal.id), eq(portalMenuItems.applicationId, application.id))).get()?.n ?? 0;
  const assessment = applicationAssessmentState(db, application.id);
  const run = assessment.run ? findAssessment(db, assessment.run.publicId) : undefined;
  const determination = storedDetermination(application);
  const earlierRun = determination && determination.assessment !== assessment.run?.publicId ? findAssessment(db, determination.assessment) : undefined;
  const checklist = productionChecklist({ application, repository: source, portal, menuItems, assessment });
  let repository: ReturnType<typeof parseRepositoryUrl> | null = null;
  try {
    repository = parseRepositoryUrl(source.cloneUrl, { bitbucketHosts: config.applications.bitbucketHosts, allowLocal: true });
  } catch {
    repository = null;
  }
  const starter = application.starter ? (starterBySlug(application.starter)?.title ?? templateBySlug(application.starter)?.title ?? application.starter) : null;
  const scope = await rememberedPortal(db);
  const switcher = applicationCatalog(db, { portalId: scope?.id ?? null }, config.applications.bitbucketHosts).map(({ publicId, name, slug, sealId }) => ({ publicId, name, slug, sealId }));
  // A dashboard isn't scoped by the switcher: it's listed there even from another Portal, so the switcher can show it.
  if (!switcher.some((entry) => entry.publicId === application.publicId)) switcher.unshift({ publicId: application.publicId, name: application.name, slug: application.slug, sealId: application.sealId ?? "" });

  const rerunBlocked = assessment.active ? "An assessment is already queued or running" : !source.enabled ? "The repository is disabled in Repositories" : null;
  const viewCode = repository?.webUrl ?? null;

  return (
    <Page>
      {assessment.active && run && <ProgressPoller url={`/api/runs/${run.publicId}/status`} version={assessmentStatus(db, run).version} />}
      <PageHeader
        breadcrumbs={[{ href: "/applications", label: "Applications" }]}
        title={application.name}
        headerStart={<ApplicationSwitcher applications={switcher} current={application.publicId} />}
        meta={[
          <span key="updated">
            Updated <RelativeTime value={application.updatedAt} />
          </span>,
        ]}
        primaryAction={
          rerunBlocked ? (
            <span className={styles.pendingAction}>
              <button type="button" {...buttonProps("primary")} disabled aria-describedby="rerun-blocked">
                <Icon name="refresh" size={16} />
                Re-run assessment
              </button>
              <span id="rerun-blocked" className={styles.pendingNote}>
                {rerunBlocked}
              </span>
            </span>
          ) : (
            <ActionButton action={rerunAssessmentAction.bind(null, application.publicId)} variant="primary" icon="refresh">
              Re-run assessment
            </ActionButton>
          )
        }
        // View code is a control, not a secondary link, so it stays beside the menu on a phone instead of collapsing into a second one.
        extraActions={
          <>
            {viewCode && (
              <ButtonLink href={viewCode} icon="code" target="_blank" rel="noreferrer">
                View code<span className="visually-hidden"> (opens in a new tab)</span>
              </ButtonLink>
            )}
            <Menu label={`More actions for ${application.name}`}>
              <MenuItem href={`/applications/${application.publicId}/edit`} icon="edit">
                Edit details
              </MenuItem>
              <MenuItem href={`/repositories/${source.publicId}/edit`} icon="git">
                Open in Repositories
              </MenuItem>
            </Menu>
          </>
        }
        alerts={<OutcomeToast outcome={dashboardOutcome(param(query, "notice"), application.name)} strip={["notice"]} />}
      />

      <Panel title="Overview">
        <DescriptionList
          layout="columns"
          items={[
            ["Slug", <code key="slug">{application.slug}</code>],
            ["SEAL ID", application.sealId ?? "None"],
            ["Portal", <PortalLabel key="portal" portal={{ publicId: portal.publicId, label: portal.label, lifecycle: portal.lifecycle }} />],
            ["Starter", starter ?? "None"],
            ["Description", application.description ?? "None"],
            ["Assessment", <AssessmentSummary key="assessment" state={assessment} runNumber={run ? assessmentNumber(db, run) : null} />],
            ["Rendering", determination ? <DeterminationDetail key="rendering" determination={determination} earlier={earlierRun && assessment.active ? assessmentNumber(db, earlierRun) : null} /> : <span key="rendering" className={styles.muted}>{assessment.active ? "Determined when the assessment finishes" : "Not determined yet"}</span>],
            [
              "Source",
              <span key="source" className={styles.source}>
                <RepositoryLabel repository={{ publicId: source.publicId, cloneUrl: source.cloneUrl, provider: repository?.provider ?? null, label: repository ? (repository.owner ? `${repository.owner}/${repository.name}` : repository.name) : source.name, webUrl: viewCode }} />
                {viewCode && (
                  <a href={viewCode} target="_blank" rel="noreferrer">
                    View code<span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                )}
                <span className={styles.muted}>{`Assessed at the ${sourceReferenceLabel(source)}`}</span>
              </span>,
            ],
          ]}
        />
      </Panel>

      <div className={styles.row}>
        <Panel title="Production checklist" actions={<span className={styles.count}>{`${checklist.completed}/${checklist.available}`}</span>}>
          <ul className={styles.checklist} aria-label="Production checklist">
            {checklist.items.map((item) => (
              <li key={item.id} data-state={item.state}>
                <Icon name={item.state === "done" ? "checkCircle" : item.state === "not_available" ? "minus" : "clock"} className={styles.checkIcon} label={item.state === "done" ? "Done" : item.state === "not_available" ? "Not available" : "To do"} />
                {item.href && item.state !== "not_available" ? (
                  <Link href={item.href} className={styles.checkLabel}>
                    {item.label}
                  </Link>
                ) : (
                  <span className={styles.checkLabel}>{item.label}</span>
                )}
                {item.state === "not_available" && <span className={styles.muted}>Not available</span>}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Observability">
          <EmptyState title="Not available yet" icon="target">
            Errors, latency, and availability for this application will appear here once DE FabLab reads them.
          </EmptyState>
        </Panel>
        <Panel title="Analytics">
          <EmptyState title="Not available yet" icon="network">
            Visits and the routes people use will appear here once DE FabLab reads them.
          </EmptyState>
        </Panel>
      </div>
    </Page>
  );
}
