import crypto from "node:crypto";
import Link from "next/link";
import { ProgressPoller } from "@/components/progress-poller";
import { PROFILE_DESCRIPTION, ProfileBody, profilePin } from "@/components/profiles/profile-body";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Status, humanize } from "@/components/ui/status";
import { SubmitButton } from "@/components/ui/submit-button";
import { ShortValue, Tag } from "@/components/ui/tag";
import { assessmentStatus } from "@/lib/assessments/status";
import { type RepositorySource, sourceReferenceLabel } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { getProfile } from "@/lib/profiles/profile-records";
import { type ProfileVersion, TRIGGER_LABELS, isActive } from "@/lib/profiling/versions";
import { repositoryFocusHref } from "@/lib/relationships/map-view";
import { repositoryHref, versionHref, versionsHref } from "@/lib/web/repository-paths";
import { reprofileSource } from "../actions";
import { sourceOutcome } from "../outcomes";
import styles from "@/components/profiles/profile-body.module.css";

/** Re-profile: queues the next version. The token is drawn when the page renders, so submitting the page twice queues one version. */
export function ReprofileForm({ source, variant = "primary" }: { source: RepositorySource; variant?: "primary" | "secondary" }) {
  return (
    <form action={reprofileSource} style={{ display: "contents" }}>
      <input type="hidden" name="publicId" value={source.publicId} />
      <input type="hidden" name="launchToken" value={crypto.randomUUID()} />
      <SubmitButton icon="refresh" pendingLabel="Queuing" variant={variant} disabled={!source.enabled}>
        Re-profile
      </SubmitButton>
    </form>
  );
}

/** A version's state in words: Queued, Profiling, Profiled, Failed, or Canceled. */
export function VersionStatus({ version, size = "md" }: { version: ProfileVersion; size?: "sm" | "md" }) {
  if (version.profile) return <Status state="complete" label="Profiled" size={size} />;
  if (isActive(version)) return <Status state={version.assessment.state} label={version.assessment.state === "queued" ? "Queued" : "Profiling"} size={size} />;
  return <Status state={version.assessment.state === "canceled" ? "canceled" : "failed"} size={size} />;
}

/**
 * A Repository's page (docs/profiling.md): one profile version of it, shown
 * as the Profile view, with the newest version's state and the way to every
 * version. Without +explicit+, the version is the current one, the newest
 * that wrote a Profile, and the page is the Repository's own; with it, the
 * page is that version's.
 */
export function RepositoryView({
  source,
  shown,
  latest,
  count,
  explicit,
  query,
}: {
  source: RepositorySource;
  /** The version shown, or undefined when the Repository has no profiled version yet. */
  shown: ProfileVersion | undefined;
  latest: ProfileVersion | undefined;
  count: number;
  explicit: boolean;
  query: Record<string, string | string[] | undefined>;
}) {
  const db = getDb();
  const profile = shown?.profile ? getProfile(db, shown.profile.publicId) : null;
  const pin = profile ? profilePin(profile) : null;
  const mapHref = profile && shown ? repositoryFocusHref(db, shown.assessment, profile.assessmentTargetId) : null;
  const base = explicit && shown ? versionHref(source.publicId, shown.version) : repositoryHref(source.publicId);
  const pending = latest && isActive(latest) ? latest : null;
  const failed = latest && !isActive(latest) && !latest.profile && latest.version !== shown?.version ? latest : null;
  const newer = explicit && shown && latest && latest.version > shown.version ? latest : null;

  return (
    <Page>
      {pending && <ProgressPoller url={`/api/runs/${pending.assessment.publicId}/status`} version={assessmentStatus(db, pending.assessment).version} />}
      <PageHeader
        breadcrumbs={explicit ? [{ href: "/repositories", label: "Repositories" }, { href: repositoryHref(source.publicId), label: source.name }, { href: versionsHref(source.publicId), label: "Versions" }] : [{ href: "/repositories", label: "Repositories" }]}
        title={explicit && shown ? `Version ${shown.version}` : source.name}
        status={!source.enabled ? <Status state="disabled" /> : undefined}
        meta={[
          ...(explicit ? [] : shown ? [<Link key="version" href={versionHref(source.publicId, shown.version)}>{`Version ${shown.version}`}</Link>] : []),
          ...(pin ? [<ShortValue key="commit" value={pin.pinned} label={pin.pinnedLabel} />] : []),
          source.gitRef ? <Tag key="reference">{source.gitRef}</Tag> : <span key="reference">{humanize(sourceReferenceLabel(source))}</span>,
          ...(profile
            ? [
                <span key="profiled">
                  Profiled <RelativeTime value={profile.createdAt} />
                </span>,
              ]
            : []),
        ]}
        description={pin ? (pin.commit ? PROFILE_DESCRIPTION.commit : PROFILE_DESCRIPTION.template) : undefined}
        primaryAction={<ReprofileForm source={source} />}
        secondaryActions={[
          { href: versionsHref(source.publicId), label: `Versions (${count})`, icon: "history" },
          ...(mapHref ? [{ href: mapHref, label: "Relationship Map", icon: "network" as const }] : []),
          { href: `/repositories/${source.publicId}/edit`, label: "Edit", icon: "edit" },
        ]}
        alerts={
          <>
            <OutcomeToast outcome={sourceOutcome(db, param(query, "notice"), source.publicId, undefined, undefined)} />
            {pending && pending.version !== shown?.version && (
              <Alert tone="info" title={`Version ${pending.version} is ${pending.assessment.state === "queued" ? "queued" : "being profiled"}`}>
                {`${TRIGGER_LABELS[pending.trigger]}. This page shows it once it's profiled.`}
              </Alert>
            )}
            {failed && (
              <Alert
                tone="warning"
                title={`Version ${failed.version} couldn't be profiled`}
                actions={
                  <Link href={versionHref(source.publicId, failed.version)} className={styles.alertLink}>
                    View version {failed.version}
                  </Link>
                }
              >
                {failed.failure?.message ?? "Its Run was canceled before it profiled the repository."}
              </Alert>
            )}
            {newer && (
              <Alert
                tone="info"
                title="This is an earlier version"
                actions={
                  <Link href={repositoryHref(source.publicId)} className={styles.alertLink}>
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

      {profile && shown ? (
        <ProfileBody profile={profile} assessment={shown.assessment} query={query} base={base} />
      ) : (
        <Panel>
          <NoProfile source={source} shown={shown} latest={latest} explicit={explicit} />
        </Panel>
      )}
    </Page>
  );
}

/** Why there's no Profile to show: nothing profiled yet, a version still running, or a version that failed. */
function NoProfile({ source, shown, latest, explicit }: { source: RepositorySource; shown: ProfileVersion | undefined; latest: ProfileVersion | undefined; explicit: boolean }) {
  if (explicit && shown && isActive(shown)) {
    return (
      <EmptyState title={`Version ${shown.version} is ${shown.assessment.state === "queued" ? "queued" : "being profiled"}`} icon="clock">
        Its Profile appears here when the repository has been read.
      </EmptyState>
    );
  }
  if (explicit && shown) {
    return (
      <EmptyState title={`Version ${shown.version} couldn't be profiled`} icon="alert">
        {shown.failure ? `${humanize(shown.failure.code)}: ${shown.failure.message}` : "Its Run was canceled before it profiled the repository."}
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
  if (!source.enabled) {
    return (
      <EmptyState title="Not profiled" icon="git">
        Disabled Repositories aren&apos;t profiled. Enable it to queue its first version.
      </EmptyState>
    );
  }
  return (
    <EmptyState title="Not profiled yet" icon="clock">
      Its first version is profiled in the background. Work people start runs first, so it may wait.
    </EmptyState>
  );
}
