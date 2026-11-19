import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { PROFILE_DESCRIPTION, ProfileBody, profilePin } from "@/components/profiles/profile-body";
import { Alert } from "@/components/ui/alert";
import { Page, PageHeader } from "@/components/ui/page";
import { RelativeTime } from "@/components/ui/relative-time";
import { ShortValue } from "@/components/ui/tag";
import { assessmentNumber, targetById } from "@/lib/assessments/assessment-records";
import { assessmentById } from "@/lib/assessments/lookups";
import { getDb } from "@/lib/db/client";
import { initiativeById } from "@/lib/initiatives/initiative-records";
import { findProfile } from "@/lib/profiles/profile-records";
import { currentProfile } from "@/lib/profiling/current";
import { versionOfAssessment } from "@/lib/profiling/versions";
import { repositoryFocusHref } from "@/lib/relationships/map-view";
import styles from "@/components/profiles/profile-body.module.css";
import { routes } from "@/lib/web/routes";

const load = cache((publicId: string) => {
  const db = getDb();
  const profile = findProfile(db, publicId);
  if (!profile) return undefined;
  const target = targetById(db, profile.assessmentTargetId);
  const assessment = assessmentById(db, profile.assessmentId);
  return { profile, target, assessment, initiative: initiativeById(db, assessment.initiativeId), number: assessmentNumber(db, assessment) };
});

export async function generateMetadata({ params }: PageProps<"/profiles/[profileId]">): Promise<Metadata> {
  const found = load((await params).profileId);
  return { title: found ? `${found.target.sourceName} · Run #${found.number}` : "Profile not found" };
}

/**
 * A Profile from a Run of an Assessment. A profile version's Profile lives
 * on its repository's page instead (docs/profiling.md), so its address
 * redirects there, keeping links from evidence pages working.
 */
export default async function ProfilePage({ params, searchParams }: PageProps<"/profiles/[profileId]">) {
  const [{ profileId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const found = load(profileId);
  if (!found) notFound();
  const { profile, target, assessment, initiative, number } = found;
  const version = initiative.profiling ? versionOfAssessment(db, assessment.id) : null;
  // The view and the tables' pages carry over; the browser keeps the section in the fragment.
  if (version) {
    const params = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    redirect(`${routes.repositoryVersion(version.sourcePublicId, version.version)}${params.size ? `?${params}` : ""}`);
  }

  const { commit } = profilePin(profile);
  const current = currentProfile(db, target.repositorySourceId);
  const newer = current && current.profile.id !== profile.id ? current : null;
  const mapHref = repositoryFocusHref(getDb(), assessment, target.id);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[
          { href: "/assessments", label: "Assessments" },
          { href: routes.assessment(initiative.publicId), label: initiative.name },
          { href: routes.run(assessment.publicId), label: `Run #${number}` },
        ]}
        title={target.sourceName}
        secondaryActions={mapHref ? [{ href: mapHref, label: "Relationship Map", icon: "network" }] : undefined}
        meta={[
          <ShortValue key="commit" value={commit} label="commit" />,
          <span key="created">
            Profiled <RelativeTime value={profile.createdAt} />
          </span>,
        ]}
        description={PROFILE_DESCRIPTION}
        alerts={
          newer && (
            <Alert
              tone="info"
              title="This is a historical Profile"
              actions={
                <Link href={routes.profile(newer.profile.publicId)} className={styles.alertLink}>
                  View the newest Profile
                </Link>
              }
            >
              A newer Profile of this repository exists. This one keeps its original facts, evidence, and detector release.
            </Alert>
          )
        }
      />

      <ProfileBody profile={profile} assessment={assessment} query={query} base={routes.profile(profile.publicId)} />
    </Page>
  );
}
