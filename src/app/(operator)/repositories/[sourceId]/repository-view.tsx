import Link from "next/link";
import { ProgressPoller } from "@/components/progress-poller";
import { PROFILE_DESCRIPTION, ProfileBody, profilePin } from "@/components/profiles/profile-body";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Status, humanize } from "@/components/ui/status";
import { SubmitButton } from "@/components/ui/submit-button";
import { ShortValue, Tag } from "@/components/ui/tag";
import { type RepositorySource, sourceReferenceLabel } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { getProfile } from "@/lib/profiles/profile-records";
import type { CurrentProfile } from "@/lib/profiling/current";
import { type ProfileVersion, TRIGGER_LABELS, isActive, profilingActivity } from "@/lib/profiling/versions";
import { repositoryRelationships } from "@/lib/profiles/relationships";
import { surveyRequestFailure } from "@/lib/surveys/background";
import { reprofileSource } from "../actions";
import { PREVIEW_OUTCOME_PARAMS, previewOutcome, sourceOutcome } from "../outcomes";
import { PreviewsSection } from "./previews-section";
import styles from "@/components/profiles/profile-body.module.css";
import { routes } from "@/lib/web/routes";

/** Re-profile: surveys the configured reference again, unless its Profile is already up to date. */
export function ReprofileForm({ source, variant = "primary" }: { source: RepositorySource; variant?: "primary" | "secondary" }) {
  return (
    <form action={reprofileSource} style={{ display: "contents" }}>
      <input type="hidden" name="publicId" value={source.publicId} />
      <SubmitButton icon="refresh" pendingLabel="Queuing" variant={variant}>
        Re-profile
      </SubmitButton>
    </form>
  );
}

/** A version's state in words: its survey's, Queued, Profiling, Profiled, or Failed. */
export function VersionStatus({ version, size = "md" }: { version: ProfileVersion; size?: "sm" | "md" }) {
  return <Status state={version.survey.state} size={size} />;
}

/**
 * A Repository's page (docs/profiling.md), as the Profile view, with the
 * newest version's state and the way to every version. Without +version+, it
 * shows the Repository's current Profile, its newest successful survey of its
 * configured reference, and is the Repository's own page; with it, the page
 * is that version's.
 */
export function RepositoryView({
  source,
  current,
  version,
  latest,
  count,
  query,
  address,
}: {
  source: RepositorySource;
  /** The current Profile, on the Repository's own page; undefined until a survey of its configured reference has succeeded. */
  current?: CurrentProfile;
  /** The version shown, on a version's page. */
  version?: ProfileVersion;
  latest: ProfileVersion | undefined;
  count: number;
  query: Record<string, string | string[] | undefined>;
  /** The page's address, when a version is shown at its Profile's (`/profiles/<id>`) rather than its own. */
  address?: string;
}) {
  const db = getDb();
  const explicit = version !== undefined;
  const profile = explicit ? (version.profile ? getProfile(db, version.profile.publicId) : null) : (current?.profile ?? null);
  const shownVersion = explicit ? version.version : (current?.version ?? null);
  const pin = profile ? profilePin(profile) : null;
  // The repository's focus in the newest Run that mapped it, if any has.
  const mapHref = profile ? repositoryRelationships(db, source.id).mapHref : null;
  const base = address ?? (explicit ? routes.repositoryVersion(source.publicId, version.version) : routes.repository(source.publicId));
  const pending = latest && isActive(latest) ? latest : null;
  // The newest version failed: on a version's page, unless it's the one shown; on the Repository's, if it's newer than the current Profile.
  const failed = latest && !isActive(latest) && !latest.profile && (explicit ? latest.version !== version.version : !current || latest.version > current.version) ? latest : null;
  // A reference that couldn't be read leaves no version; its request's error says why.
  const unreadable = explicit ? null : surveyRequestFailure(db, source, latest?.survey);
  const newer = explicit && latest && latest.version > version.version ? latest : null;

  return (
    <Page>
      {pending && <ProgressPoller url="/api/repositories/profiling" version={profilingActivity(db).version} />}
      <PageHeader
        breadcrumbs={explicit ? [{ href: "/repositories", label: "Repositories" }, { href: routes.repository(source.publicId), label: source.name }, { href: routes.repositoryVersions(source.publicId), label: "Versions" }] : [{ href: "/repositories", label: "Repositories" }]}
        title={explicit && !address ? `Version ${version.version}` : source.name}
        meta={[
          // At its Profile's address, a version is titled by its repository and names its number here.
          ...(explicit && address ? [<Link key="version" href={routes.repositoryVersion(source.publicId, version.version)}>{`Version ${version.version}`}</Link>] : []),
          ...(explicit || !current
            ? []
            : [
                <Link key="version" href={routes.repositoryVersion(source.publicId, current.version)}>{`Version ${current.version}`}</Link>,
              ]),
          ...(pin ? [<ShortValue key="commit" value={pin.commit} label="commit" />] : []),
          source.gitRef ? <Tag key="reference">{source.gitRef}</Tag> : <span key="reference">{humanize(sourceReferenceLabel(source))}</span>,
          ...(profile
            ? [
                <span key="profiled">
                  Profiled <RelativeTime value={profile.createdAt} />
                </span>,
              ]
            : []),
        ]}
        description={pin ? PROFILE_DESCRIPTION : undefined}
        primaryAction={<ReprofileForm source={source} />}
        secondaryActions={[
          { href: routes.repositoryVersions(source.publicId), label: `Versions (${count})`, icon: "history" },
          ...(mapHref ? [{ href: mapHref, label: "Relationship Map", icon: "network" as const }] : []),
          { href: routes.repositorySettings(source.publicId), label: "Settings", icon: "settings" },
        ]}
        alerts={
          <>
            <OutcomeToast outcome={sourceOutcome(db, param(query, "notice"), source.publicId)} />
            {!explicit && <OutcomeToast outcome={previewOutcome(db, param(query, "notice"), param(query, "preview"))} strip={PREVIEW_OUTCOME_PARAMS} />}
            {pending && pending.version !== shownVersion && (
              <Alert tone="info" title={`Version ${pending.version} is ${pending.survey.state === "queued" ? "queued" : "being profiled"}`}>
                {`${TRIGGER_LABELS[pending.trigger]}. This page shows it once it's profiled.`}
              </Alert>
            )}
            {failed && (
              <Alert
                tone="warning"
                title={`Version ${failed.version} couldn't be profiled`}
                actions={
                  <Link href={routes.repositoryVersion(source.publicId, failed.version)} className={styles.alertLink}>
                    View version {failed.version}
                  </Link>
                }
              >
                {failed.failure?.message ?? "Its survey failed."}
              </Alert>
            )}
            {unreadable && (
              <Alert tone="warning" title="The reference couldn't be read">
                {`${unreadable.message} The next check tries again.`}
              </Alert>
            )}
            {newer && (
              <Alert
                tone="info"
                title="This is an earlier version"
                actions={
                  <Link href={routes.repository(source.publicId)} className={styles.alertLink}>
                    View the current version
                  </Link>
                }
              >
                {`Version ${newer.version} is the newest. This one keeps its original facts, evidence, and detector release.`}
              </Alert>
            )}
          </>
        }
      />

      {!explicit && <PreviewsSection source={source} query={query} />}

      {profile ? (
        <ProfileBody profile={profile} query={query} base={base} />
      ) : (
        <Panel>
          <NoProfile version={version} latest={latest} />
        </Panel>
      )}
    </Page>
  );
}

/** Why there's no Profile to show: nothing profiled yet, a version still running, or a version that failed. */
function NoProfile({ version, latest }: { version: ProfileVersion | undefined; latest: ProfileVersion | undefined }) {
  if (version && isActive(version)) {
    return (
      <EmptyState title={`Version ${version.version} is ${version.survey.state === "queued" ? "queued" : "being profiled"}`} icon="clock">
        Its Profile appears here when the repository has been read.
      </EmptyState>
    );
  }
  if (version) {
    return (
      <EmptyState title={`Version ${version.version} couldn't be profiled`} icon="alert">
        {version.failure ? `${humanize(version.failure.code)}: ${version.failure.message}` : "Its survey failed."}
      </EmptyState>
    );
  }
  // Every version so far failed; the alert above says why.
  if (latest && !isActive(latest)) {
    return (
      <EmptyState title="Not profiled" icon="alert">
        No version has profiled this repository yet. Fix what stopped the last one, then re-profile it.
      </EmptyState>
    );
  }
  return (
    <EmptyState title="Not profiled yet" icon="clock">
      Its first version is profiled in the background. Work people start runs first, so it may wait.
    </EmptyState>
  );
}
