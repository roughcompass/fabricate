import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { PROFILE_DESCRIPTION, ProfileBody, profilePin } from "@/components/profiles/profile-body";
import { Alert } from "@/components/ui/alert";
import { Page, PageHeader } from "@/components/ui/page";
import { RelativeTime } from "@/components/ui/relative-time";
import { ShortValue } from "@/components/ui/tag";
import { assessmentNumber } from "@/lib/assessments/assessment-records";
import { assessmentById } from "@/lib/assessments/lookups";
import { getDb } from "@/lib/db/client";
import { assessmentTargets } from "@/lib/db/schema";
import { initiativeById } from "@/lib/initiatives/initiative-records";
import { findProfile, latestProfileOfSource } from "@/lib/profiles/profile-records";
import { versionOfAssessment } from "@/lib/profiling/versions";
import { repositoryFocusHref } from "@/lib/relationships/map-view";
import { versionHref } from "@/lib/web/repository-paths";
import { eq } from "drizzle-orm";
import styles from "@/components/profiles/profile-body.module.css";

const load = cache((publicId: string) => {
  const db = getDb();
  const profile = findProfile(db, publicId);
  if (!profile) return undefined;
  const target = db.select().from(assessmentTargets).where(eq(assessmentTargets.id, profile.assessmentTargetId)).get()!;
  const assessment = assessmentById(db, profile.assessmentId);
  return { profile, target, assessment, initiative: initiativeById(db, assessment.initiativeId), number: assessmentNumber(db, assessment) };
});

export async function generateMetadata({ params }: { params: Promise<{ profileId: string }> }): Promise<Metadata> {
  const found = load((await params).profileId);
  return { title: found ? `${found.target.sourceName} · Run #${found.number}` : "Profile not found" };
}

/**
 * A Profile from a Run of an Assessment. A profile version's Profile lives
 * on its repository's page instead (docs/profiling.md), so its address
 * redirects there, keeping links from evidence pages working.
 */
export default async function ProfilePage({ params, searchParams }: { params: Promise<{ profileId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ profileId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const found = load(profileId);
  if (!found) notFound();
  const { profile, target, assessment, initiative, number } = found;
  const version = initiative.profiling ? versionOfAssessment(db, assessment.id) : null;
  if (version) redirect(versionHref(version.sourcePublicId, version.version));

  const { document, commit, pinned, pinnedLabel } = profilePin(profile);
  const latest = latestProfileOfSource(db, target.sourcePublicId);
  const newer = latest && latest.profile.id !== profile.id ? latest : null;
  const template = target.kind === "template" ? (document.template as { version_number: number | null }) : null;
  const mapHref = repositoryFocusHref(getDb(), assessment, target.id);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[
          { href: "/assessments", label: "Assessments" },
          { href: `/assessments/${initiative.publicId}`, label: initiative.name },
          { href: `/runs/${assessment.publicId}`, label: `Run #${number}` },
        ]}
        title={target.sourceName}
        secondaryActions={mapHref ? [{ href: mapHref, label: "Relationship Map", icon: "network" }] : undefined}
        meta={[
          <ShortValue key="commit" value={pinned} label={pinnedLabel} />,
          ...(template ? [<span key="template">{template.version_number ? `Template version ${template.version_number}` : "Before acceptance"}</span>] : []),
          <span key="created">
            Profiled <RelativeTime value={profile.createdAt} />
          </span>,
        ]}
        description={commit ? PROFILE_DESCRIPTION.commit : PROFILE_DESCRIPTION.template}
        alerts={
          newer && (
            <Alert
              tone="info"
              title="This is a historical Profile"
              actions={
                <Link href={`/profiles/${newer.profile.publicId}`} className={styles.alertLink}>
                  View the newest Profile
                </Link>
              }
            >
              A newer Profile of this repository exists. This one keeps its original facts, evidence, and detector release.
            </Alert>
          )
        }
      />

      <ProfileBody profile={profile} assessment={assessment} query={query} base={`/profiles/${profile.publicId}`} />
    </Page>
  );
}
