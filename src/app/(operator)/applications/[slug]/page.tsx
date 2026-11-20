import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { DetailsTemplate } from "@/components/templates/details-template";
import { Alert } from "@/components/ui/alert";
import { ActionButton, Button, ButtonLink } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { MediaImage } from "@/components/ui/media-card";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import { formatDuration } from "@/components/ui/time";
import { applicationsAvailable, requireApplications } from "@/lib/applications/availability";
import { type ApplicationBuildEntry, applicationHistory } from "@/lib/applications/history";
import { type Application, findApplication, getApplicationRow, statusSnapshot } from "@/lib/applications/records";
import { APPLICATION_STATUS_LABELS } from "@/lib/applications/status";
import { getDb } from "@/lib/db/client";
import { param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { rebuildAction } from "../actions";
import { ApplicationsPoller } from "../applications-poller";
import { applicationOutcome } from "../outcomes";
import { ApplicationStatusLabel, applicationImage, traitsLabel } from "../views";
import styles from "../applications.module.css";

/** The application at +slug+, while applications are offered. */
const load = cache((slug: string) => (applicationsAvailable() ? findApplication(getDb(), slug) : undefined));

export async function generateMetadata({ params }: PageProps<"/applications/[slug]">): Promise<Metadata> {
  const application = load((await params).slug);
  return { title: application ? `${application.name} · Applications` : "Application not found" };
}

const TRIGGERS = { first: "First build", automatic: "New commit", rebuild: "Rebuild", branch: "Branch switch" } as const;
/** A build's state in the history: its outcome, as the status registry names it. */
const OUTCOME_STATES = { building: "building", ready: "ready", failed: "failed", not_previewable: "cant_be_previewed", replaced: "replaced" } as const;

/**
 * An application's page (applications/catalog spec), on the Details
 * template: breadcrumbs back to Applications, its name, status, and
 * description; Preview application, Open full screen, Settings, and Rebuild;
 * its screenshot, placeholder, or failure state beside its overview; why its
 * latest build failed, with a link to the log; and its builds, newest first.
 * Preview application and Open full screen are offered once a build has
 * succeeded, and Rebuild while no build is under way. The page refreshes
 * while a build or its screenshot is under way.
 */
export default async function ApplicationPage({ params, searchParams }: PageProps<"/applications/[slug]">) {
  requireApplications();
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const application = load(slug);
  if (!application) notFound();
  const history = applicationHistory(getDb(), getApplicationRow(getDb(), application.publicId).id);
  const snapshot = statusSnapshot([application]);
  const building = application.latest.outcome === "building";

  return (
    <DetailsTemplate
      header={{
        breadcrumbs: [{ href: routes.applications, label: "Applications" }],
        title: application.name,
        status: <ApplicationStatusLabel application={application} />,
        meta: [
          <Link key="repository" href={routes.repository(application.repository.publicId)}>
            {application.repository.name}
          </Link>,
          <span key="branch">
            Branch <Tag>{application.trackedBranch}</Tag>
          </span>,
          ...(application.current
            ? [
                <span key="built">
                  Built <RelativeTime value={application.current.finishedAt} />
                </span>,
              ]
            : []),
        ],
        description: application.description || undefined,
        primaryAction: application.current ? (
          <ButtonLink href={routes.applicationPreview(application.slug)} variant="primary" icon="eye">
            Preview application
          </ButtonLink>
        ) : (
          <Button variant="primary" icon="eye" disabled title="Available once a build succeeds">
            Preview application
          </Button>
        ),
        secondaryActions: [{ label: "Settings", href: routes.applicationSettings(application.slug), icon: "settings" }],
        extraActions: (
          <>
            {application.current ? (
              <ButtonLink href={routes.runningApplication(application.slug)} target="_blank" icon="external">
                Open full screen
              </ButtonLink>
            ) : (
              <Button icon="external" disabled title="Available once a build succeeds">
                Open full screen
              </Button>
            )}
            {building ? (
              <Button icon="refresh" disabled title="Available once this build finishes">
                Rebuild
              </Button>
            ) : (
              <ActionButton action={rebuildAction} fields={{ application: application.slug }} icon="refresh">
                Rebuild
              </ActionButton>
            )}
          </>
        ),
      }}
      alerts={
        <>
          <OutcomeToast outcome={applicationOutcome(param(query, "notice"), application)} />
          <LatestFailure application={application} history={history} />
        </>
      }
    >
      <div className={styles.detail}>
        <div className={styles.overview}>
          {/* Beside the image the overview has a third of the page, so each term sits above its value, which keeps a commit or a package's path on one line. */}
          <DescriptionList
            surface
            layout="columns"
            items={[
              ["Repository", <Link key="repository" href={routes.repository(application.repository.publicId)}>{application.repository.name}</Link>],
              ["Package", application.packageDir === "." ? "The repository root" : <Tag key="package">{application.packageDir}</Tag>],
              ["Tracked branch", <Tag key="branch">{application.trackedBranch}</Tag>],
              ["Current build", application.current ? <CurrentBuild key="current" application={application} /> : "None yet"],
              ["Built with", traitsLabel(application, true) ?? "Not decided yet"],
              ["Latest build", <ApplicationStatusLabel key="latest" application={application} />],
            ]}
          />
        </div>
        <figure className={styles.image}>
          <MediaImage image={applicationImage(application, "full")} sizes="(max-width: 767px) 100vw, 800px" />
        </figure>
      </div>

      <Section title="Builds" description="Each build the application started, newest first: its first build, new commits, rebuilds, and branch switches.">
        <Panel flush>
          <Table
            label={`Builds of ${application.name}`}
            head={
              <>
                <Th>Commit</Th>
                <Th>Started</Th>
                <Th>State</Th>
                <Th align="numeric">Duration</Th>
                <Th>Log</Th>
              </>
            }
          >
            {history.map((entry, index) => (
              <BuildRow key={`${entry.startedAt.getTime()}-${index}`} entry={entry} />
            ))}
          </Table>
        </Panel>
      </Section>
      <ApplicationsPoller url={routes.applicationsStatus([application.publicId])} version={snapshot.version} shown={[{ id: application.publicId, name: application.name, label: APPLICATION_STATUS_LABELS[application.status], settling: application.settling }]} />
    </DetailsTemplate>
  );
}

function CurrentBuild({ application }: { application: Application }) {
  const current = application.current!;
  return (
    <>
      <ShortValue value={current.commitSha} length={7} label="commit" /> <RelativeTime value={current.finishedAt} />
    </>
  );
}

/** Why the latest build failed or was refused, with its log when it's kept. */
function LatestFailure({ application, history }: { application: Application; history: readonly ApplicationBuildEntry[] }) {
  if (application.latest.outcome !== "failed" && application.latest.outcome !== "not_previewable") return null;
  const newest = history[0];
  const log = newest?.build?.logKept ? routes.repositoryPreview(newest.build.repository, newest.build.preview) + "#log" : null;
  return (
    <Alert tone="error" title={application.latest.outcome === "failed" ? `Why the build of ${application.latest.commitSha.slice(0, 7)} failed` : `Why ${application.latest.commitSha.slice(0, 7)} can't be previewed`} actions={log && <Link href={log}>View the build log</Link>}>
      {application.latest.reasons.length === 1 ? (
        application.latest.reasons[0]!.text
      ) : (
        <ul>
          {application.latest.reasons.map((reason, index) => (
            <li key={index}>{reason.text}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

function BuildRow({ entry }: { entry: ApplicationBuildEntry }) {
  const log = entry.build?.logKept ? routes.repositoryPreview(entry.build.repository, entry.build.preview) + "#log" : null;
  return (
    <tr>
      <Td label="Commit">
        <Primary>
          <ShortValue value={entry.commitSha} length={7} label="commit" />
        </Primary>
        <Secondary>{`${TRIGGERS[entry.trigger]} · ${entry.branch}`}</Secondary>
      </Td>
      <Td label="Started">
        <RelativeTime value={entry.startedAt} />
      </Td>
      <Td label="State">
        <Status state={OUTCOME_STATES[entry.outcome]} label={entry.outcome === "failed" ? "Failed" : entry.outcome === "not_previewable" ? "Can't be previewed" : undefined} />
        {entry.reasons[0] && <Secondary>{entry.reasons[0].text}</Secondary>}
      </Td>
      <Td label="Duration" align="numeric">
        {entry.durationMs === null ? "Running" : formatDuration(entry.durationMs)}
      </Td>
      <Td label="Log">{log ? <Link href={log}>{`Log of ${entry.commitSha.slice(0, 7)}`}</Link> : <span className={styles.traits}>{entry.build ? "No longer kept" : "No build"}</span>}</Td>
    </tr>
  );
}
