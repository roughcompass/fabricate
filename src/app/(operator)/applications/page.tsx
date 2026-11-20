import type { Metadata } from "next";
import Form from "next/form";
import { IndexTemplate } from "@/components/templates/index-template";
import { ButtonLink } from "@/components/ui/button";
import { countLabel, formatNumber } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterRail } from "@/components/ui/filter-rail";
import { HiddenFields } from "@/components/ui/form";
import { MediaCard } from "@/components/ui/media-card";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { SearchField } from "@/components/ui/search-field";
import { Tag } from "@/components/ui/tag";
import { requireApplications } from "@/lib/applications/availability";
import { EMPTY_QUERY, applicationsHref, findApplication, listApplications, parseApplicationQuery, statusSnapshot } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { ApplicationsPoller } from "./applications-poller";
import { applicationOutcome } from "./outcomes";
import { ResetWorkspaceSection, workspaceOutcome } from "./reset-workspace";
import { ApplicationStatusLabel, applicationImage, traitsLabel } from "./views";
import styles from "./applications.module.css";
import { APPLICATION_STATUS_LABELS, STATUS_FILTER_LABELS } from "@/lib/applications/status";

export const metadata: Metadata = { title: "Applications" };

/** The application onboarding just created, which its outcome names. */
function created(params: Record<string, string | string[] | undefined>) {
  const slug = param(params, "application");
  return slug ? findApplication(getDb(), slug) : undefined;
}

/**
 * The Applications page (applications/catalog spec), on the Index template
 * with a card grid and a filter rail: a full-width search, the "Filter applications" rail with Framework and
 * Status, the count, a card per application with its status and its
 * current build's screenshot, and pages of 24. Every choice lives in the
 * address and works without JavaScript. While a shown application is
 * building, the page refreshes its cards and announces finished builds.
 * Reset workspace's section comes last, since page headers hold no
 * destructive actions.
 */
export default async function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  requireApplications();
  const params = await searchParams;
  const query = parseApplicationQuery(params);
  const listing = listApplications(getDb(), query);
  const filtered = query.search !== "" || query.frameworks.length > 0 || query.statuses.length > 0;
  const clearHref = applicationsHref(EMPTY_QUERY);
  const snapshot = statusSnapshot(listing.items);
  const newApplication = (
    <ButtonLink href={routes.newApplication()} variant="primary" icon="plus">
      New application
    </ButtonLink>
  );

  return (
    <IndexTemplate
      header={{ title: "Applications", description: "Frontend applications built from a branch of a repository, kept up to date as the branch moves.", primaryAction: newApplication }}
      alerts={<OutcomeToast outcome={applicationOutcome(param(params, "notice"), created(params)) ?? workspaceOutcome(param(params, "notice"))} strip={["notice", "application"]} />}
      empty={
        listing.total === 0
          ? { title: "No applications yet", icon: "frame", children: "Applications are built from repositories: choose a repository, the branch to track, and its package, and the Frontend Registry builds it.", action: newApplication }
          : undefined
      }
      rail={
        listing.total > 0 && (
        <FilterRail
          key={applicationsHref({ ...query, search: "", page: 1 })}
          action={routes.applications}
          label="Filter applications"
          groups={[
            { name: "framework", legend: "Framework", options: listing.frameworks.map((option) => ({ value: option.value, label: option.value, count: option.count })) },
            { name: "status", legend: "Status", options: listing.statuses.map((option) => ({ value: option.value, label: STATUS_FILTER_LABELS[option.value], count: option.count })) },
          ]}
          selected={{ framework: query.frameworks, status: query.statuses }}
          keep={query.search ? { q: query.search } : {}}
          activeCount={query.frameworks.length + query.statuses.length}
          filtered={filtered}
          clearHref={clearHref}
        />
        )
      }
      filters={
        listing.total > 0 && (
        <Form key={query.search} action={routes.applications} scroll={false} className={styles.search} role="search" aria-label="Search applications">
          <HiddenFields values={{ framework: query.frameworks, status: query.statuses }} />
          <SearchField
            id="application-search"
            name="q"
            label="Search applications"
            hideLabel
            size="lg"
            placeholder="Search by name, description, repository, or branch"
            defaultValue={query.search}
            clearHref={applicationsHref({ ...query, search: "", page: 1 })}
          />
        </Form>
        )
      }
    >
      <section className={styles.results} aria-labelledby="applications-results">
        <h2 id="applications-results" className="visually-hidden">
          Applications
        </h2>
        <p className={styles.count} role="status">
          {listing.pages > 1 ? `Showing ${formatNumber(listing.from)}–${formatNumber(listing.to)} of ${countLabel(listing.matched, "application")}` : `Showing ${formatNumber(listing.matched)} of ${countLabel(listing.total, "application")}`}
        </p>
        {listing.items.length > 0 ? (
          <ul className={styles.grid}>
            {listing.items.map((application) => (
              <li key={application.publicId}>
                <MediaCard
                  title={application.name}
                  description={application.description || `${application.repository.name}${application.packageDir === "." ? "" : ` · ${application.packageDir}`}`}
                  image={applicationImage(application, "card")}
                  href={routes.application(application.slug)}
                  footer={
                    <>
                      <ApplicationStatusLabel application={application} size="sm" />
                      {traitsLabel(application) && <span className={styles.traits}>{traitsLabel(application)}</span>}
                      <Tag>{application.trackedBranch}</Tag>
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <Panel flush>
            <EmptyState
              title="No applications match"
              icon="search"
              action={
                <ButtonLink href={clearHref} variant="primary">
                  Clear filters
                </ButtonLink>
              }
            >
              {query.search ? `No application matches “${query.search}” with the chosen filters.` : "No application matches the chosen filters."}
            </EmptyState>
          </Panel>
        )}
        <Pagination label="Applications pages" page={listing.page} pages={listing.pages} href={(page) => applicationsHref({ ...query, page })} />
        <ApplicationsPoller
          url={routes.applicationsStatus(listing.items.map((application) => application.publicId))}
          version={snapshot.version}
          shown={listing.items.map((application) => ({ id: application.publicId, name: application.name, label: APPLICATION_STATUS_LABELS[application.status], settling: application.settling }))}
        />
      </section>
      <ResetWorkspaceSection />
    </IndexTemplate>
  );
}
