import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { ApplicationCard, DemoDeploymentCard, type DemoDeploymentRow, PortalLabel, RenderingLabel, RepositoryLabel } from "@/components/applications/application-card";
import { ApplicationSwitcher } from "@/components/applications/application-switcher";
import { ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterMenu } from "@/components/ui/filter-rail";
import { MenuButton, MenuItem } from "@/components/ui/menu";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { SearchField } from "@/components/ui/search-field";
import { Status } from "@/components/ui/status";
import { Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ASSESSMENT_FILTERS, ASSESSMENT_FILTER_LABELS, type ApplicationRow, type AssessmentFilter, applicationCatalog } from "@/lib/applications/catalog";
import { RENDERING_MODES, RENDERING_MODE_LABELS, type RenderingMode } from "@/lib/applications/vocabulary";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { listApplications } from "@/lib/demo/applications";
import { buildProgress } from "@/lib/demo/build";
import { templateBySlug } from "@/lib/demo/catalog";
import { buildScriptFor } from "@/lib/demo/deployments";
import { demoEnabled } from "@/lib/demo/guard";
import { currentWorkspace } from "@/lib/demo/request";
import { currentPortal } from "@/lib/web/portal";
import { rememberedPortal } from "@/lib/web/portal-cookie";
import { demoOutcome } from "../templates/outcomes";
import { deleteApplicationAction } from "./actions";
import { ENVIRONMENT_LABELS } from "./labels";
import styles from "./list.module.css";

export const metadata: Metadata = { title: "Applications" };

const values = (params: Record<string, string | string[] | undefined>, name: string): string[] => {
  const value = params[name];
  return (Array.isArray(value) ? value : value === undefined ? [] : [value]).slice(0, 20);
};

/** The time this request renders, which each demo build's status is measured against. */
function requestTime(): number {
  return Date.now();
}

type Entry = { kind: "application"; row: ApplicationRow; changedAt: Date } | { kind: "demo"; row: DemoDeploymentRow; changedAt: Date };

/**
 * The Applications page (application-catalog spec; design decision 2): the
 * registered Applications in the current Portal, or every Portal with
 * `portal=all`, as cards or rows, searched and filtered in the address, and
 * while the demo is enabled the visitor's demo deployments among them, most
 * recently changed first.
 */
export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const db = getDb();
  const config = getConfig();

  // The address's portal wins over the switcher for this view: a Portal, or all.
  const portalParam = param(params, "portal");
  const scope = portalParam === "all" ? null : portalParam ? currentPortal(db, portalParam) : await rememberedPortal(db);
  const search = (param(params, "q") ?? "").slice(0, 200);
  const rendering = values(params, "rendering").filter((value): value is RenderingMode => (RENDERING_MODES as readonly string[]).includes(value));
  const states = values(params, "state").filter((value): value is AssessmentFilter => Object.hasOwn(ASSESSMENT_FILTERS, value));
  const view = param(params, "view") === "list" ? "list" : "grid";

  const inScope = applicationCatalog(db, { portalId: scope?.id ?? null }, config.applications.bitbucketHosts);
  const registered = applicationCatalog(db, { portalId: scope?.id ?? null, search, rendering, states }, config.applications.bitbucketHosts);

  // Demo deployments aren't assessed or scoped by Portal, so a state filter leaves them out and only the search narrows them.
  const workspace = demoEnabled() ? await currentWorkspace() : null;
  const now = requestTime();
  const demos: DemoDeploymentRow[] = (workspace ? listApplications(db, workspace.id) : []).flatMap((application) => {
    const template = templateBySlug(application.templateSlug);
    if (!template) return [];
    const status = buildProgress(buildScriptFor(application, template), application.createdAt.getTime(), now, application.buildSkippedAt?.getTime() ?? null).status;
    return [{ publicId: application.publicId, name: application.name, template: template.title, environment: ENVIRONMENT_LABELS[application.environment], status, createdAt: application.createdAt }];
  });
  const shownDemos = rendering.length || states.length ? [] : demos.filter((demo) => !search.trim() || demo.name.toLowerCase().includes(search.trim().toLowerCase()));
  const entries: Entry[] = [...registered.map((row): Entry => ({ kind: "application", row, changedAt: row.changedAt })), ...shownDemos.map((row): Entry => ({ kind: "demo", row, changedAt: row.createdAt }))].sort(
    (a, b) => b.changedAt.getTime() - a.changedAt.getTime() || a.row.name.localeCompare(b.row.name),
  );

  // Every address on the page keeps the view, the Portal override, the search, and the filters it doesn't change.
  const keep = (overrides: Record<string, string | string[] | null>) => {
    const query = new URLSearchParams();
    const entries: [string, string | string[] | null][] = Object.entries({ portal: portalParam ?? null, q: search || null, rendering, state: states, view: view === "list" ? "list" : null, ...overrides });
    for (const [name, value] of entries) for (const item of Array.isArray(value) ? value : value ? [value] : []) query.append(name, item);
    return query.size ? `/applications?${query}` : "/applications";
  };
  const filtered = rendering.length > 0 || states.length > 0;
  const keepFields = Object.fromEntries([["portal", portalParam], ["q", search || null], ["view", view === "list" ? "list" : null]].filter((entry): entry is [string, string] => Boolean(entry[1])));
  const clearHref = keep({ q: null, rendering: [], state: [] });
  const nothingYet = inScope.length === 0 && demos.length === 0;

  const demoActions = (deployment: DemoDeploymentRow) => (
    <ConfirmDialog
      action={deleteApplicationAction}
      fields={{ application: deployment.publicId }}
      trigger={{ label: "Delete", icon: "trash" }}
      menu={{
        label: `Actions for ${deployment.name}`,
        // As on the deployment's page, Visit waits for the build.
        items:
          deployment.status === "ready" ? (
            <MenuItem href={`/run/${deployment.publicId}`} icon="arrowRight" newTab>
              Visit
            </MenuItem>
          ) : (
            <MenuButton icon="arrowRight" disabled>
              Visit<span className="visually-hidden"> (available when the build finishes)</span>
            </MenuButton>
          ),
      }}
      title={`Delete ${deployment.name}?`}
      confirmLabel="Delete deployment"
      tone="danger"
    >
      <p>Its comments and share links are removed too.</p>
    </ConfirmDialog>
  );

  return (
    <Page>
      <PageHeader
        title="Applications"
        headerStart={<ApplicationSwitcher applications={inScope.map(({ publicId, name, slug, sealId }) => ({ publicId, name, slug, sealId }))} current={null} />}
        description={scope ? `Applications registered in ${scope.label}, the current Portal.` : "Applications registered in every Portal."}
        primaryAction={
          <ButtonLink href="/applications/new" variant="primary" icon="plus">
            Add application
          </ButtonLink>
        }
        alerts={<OutcomeToast outcome={demoOutcome(param(params, "notice"))} strip={["notice"]} />}
      />

      {!nothingYet && (
        <div className={styles.toolbar}>
          <Form key={search} action="/applications" scroll={false} className={styles.search} role="search" aria-label="Search Applications">
            {Object.entries({ portal: portalParam, view: view === "list" ? "list" : null }).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
            {rendering.map((value) => (
              <input key={`rendering-${value}`} type="hidden" name="rendering" value={value} />
            ))}
            {states.map((value) => (
              <input key={`state-${value}`} type="hidden" name="state" value={value} />
            ))}
            <SearchField id="application-search" name="q" label="Search Applications" hideLabel placeholder="Search Applications…" defaultValue={search} clearHref={keep({ q: null })} shortcut="/" />
          </Form>
          <div className={styles.controls}>
            <FilterMenu
              key={keep({})}
              action="/applications"
              label="Filter Applications"
              groups={[
                { name: "rendering", legend: "Rendering", options: RENDERING_MODES.map((mode) => ({ value: mode, label: RENDERING_MODE_LABELS[mode], count: inScope.filter((row) => row.rendering === mode).length })) },
                { name: "state", legend: "Assessment", options: (Object.keys(ASSESSMENT_FILTERS) as AssessmentFilter[]).map((filter) => ({ value: filter, label: ASSESSMENT_FILTER_LABELS[filter], count: inScope.filter((row) => (ASSESSMENT_FILTERS[filter] as readonly string[]).includes(row.assessment)).length })) },
              ]}
              selected={{ rendering, state: states }}
              keep={keepFields}
              activeCount={rendering.length + states.length}
              filtered={filtered}
              clearHref={keep({ rendering: [], state: [] })}
            />
            <ToggleGroup
              action="/applications"
              label="View"
              name="view"
              options={[
                { value: "grid", label: "Grid", icon: "columns" },
                { value: "list", label: "List", icon: "menu" },
              ]}
              selected={view}
              keep={Object.fromEntries(new URLSearchParams(keep({ view: null }).split("?")[1] ?? ""))}
              iconOnly
            />
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <Panel flush>
          {nothingYet || (!search && !filtered) ? (
            <EmptyState
              title="No applications yet"
              icon="layers"
              action={
                <ButtonLink href="/applications/new" variant="primary" icon="plus">
                  Add application
                </ButtonLink>
              }
            >
              {scope ? `Applications registered in ${scope.label} from a starter or a repository appear here.` : "Applications registered from a starter or a repository appear here."}
            </EmptyState>
          ) : (
            <EmptyState
              title="No applications match"
              icon="search"
              action={
                <ButtonLink href={clearHref} variant="secondary">
                  Clear
                </ButtonLink>
              }
            >
              {search ? `No application matches “${search}”${filtered ? " with the chosen filters" : ""}.` : "No application matches the chosen filters."}
            </EmptyState>
          )}
        </Panel>
      ) : (
        <>
          <p className={styles.count} role="status">
            {countLabel(entries.length, "application")}
          </p>
          {view === "grid" ? (
            <ul className={styles.grid} aria-label="Applications">
              {entries.map((entry) => (
                <li key={entry.row.publicId}>{entry.kind === "application" ? <ApplicationCard application={entry.row} /> : <DemoDeploymentCard deployment={entry.row} actions={demoActions(entry.row)} />}</li>
              ))}
            </ul>
          ) : (
            <Panel flush>
              <Table
                label="Applications"
                head={
                  <>
                    <Th>Application</Th>
                    <Th>Repository</Th>
                    <Th>Portal</Th>
                    <Th>Assessment</Th>
                    <Th>Rendering</Th>
                    <Th>Updated</Th>
                    <Th align="actions" hidden>
                      Actions
                    </Th>
                  </>
                }
              >
                {entries.map((entry) =>
                  entry.kind === "application" ? (
                    <tr key={entry.row.publicId}>
                      <Td label="Application">
                        <Primary>
                          <Link href={`/applications/${entry.row.publicId}`}>{entry.row.name}</Link>
                        </Primary>
                        <Secondary>{entry.row.slug}</Secondary>
                      </Td>
                      <Td label="Repository">
                        <RepositoryLabel repository={entry.row.repository} />
                      </Td>
                      <Td label="Portal">
                        <PortalLabel portal={entry.row.portal} />
                      </Td>
                      <Td label="Assessment">
                        <Status state={entry.row.assessment} size="sm" />
                      </Td>
                      <Td label="Rendering">
                        <RenderingLabel mode={entry.row.rendering} />
                      </Td>
                      <Td label="Updated">
                        <RelativeTime value={entry.row.changedAt} />
                      </Td>
                      <Td align="actions" />
                    </tr>
                  ) : (
                    <tr key={entry.row.publicId}>
                      <Td label="Application">
                        <Primary>
                          <Link href={`/applications/${entry.row.publicId}`}>{entry.row.name}</Link>
                        </Primary>
                        <Secondary>
                          <Tag sans>Demo</Tag> {`${entry.row.template} template`}
                        </Secondary>
                      </Td>
                      <Td label="Repository">
                        <Secondary>{entry.row.environment}</Secondary>
                      </Td>
                      <Td label="Portal">
                        <Secondary>None</Secondary>
                      </Td>
                      <Td label="Assessment">
                        <Status state={entry.row.status} size="sm" />
                      </Td>
                      <Td label="Rendering">
                        <Secondary>Not assessed</Secondary>
                      </Td>
                      <Td label="Updated">
                        <RelativeTime value={entry.row.createdAt} />
                      </Td>
                      <Td align="actions">
                        <RowActions>{demoActions(entry.row)}</RowActions>
                      </Td>
                    </tr>
                  ),
                )}
              </Table>
            </Panel>
          )}
        </>
      )}
    </Page>
  );
}
