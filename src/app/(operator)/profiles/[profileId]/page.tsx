import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PROFILE_DESCRIPTION, ProfileBody } from "@/components/profiles/profile-body";
import { Alert } from "@/components/ui/alert";
import { Page, PageHeader } from "@/components/ui/page";
import { cache } from "react";
import { sourceById } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { findProfile } from "@/lib/profiles/profile-records";
import { findVersion, versionsOf } from "@/lib/profiling/versions";
import { surveyById } from "@/lib/surveys/records";
import { routes } from "@/lib/web/routes";
import { RepositoryView } from "../../repositories/[sourceId]/repository-view";

const load = cache((publicId: string) => {
  const db = getDb();
  const profile = isPublicId(publicId, "prf") ? findProfile(db, publicId) : undefined;
  if (!profile) return undefined;
  const survey = surveyById(db, profile.surveyId);
  const source = sourceById(db, survey.repositorySourceId);
  return { profile, source, version: findVersion(db, source.id, survey.number)! };
});

export async function generateMetadata({ params }: PageProps<"/profiles/[profileId]">): Promise<Metadata> {
  const found = load((await params).profileId);
  return { title: found ? `Version ${found.version.version} · ${found.source.name}` : "Profile not found" };
}

/**
 * A Profile, as its Repository's version (unify-surveys, design decision 1):
 * every Profile is a survey's, and every survey is one of the Repository's
 * numbered versions, whichever Run, check, or preview started it. Runs and
 * evidence pages link Profiles here, so the page keeps this address.
 */
export default async function ProfilePage({ params, searchParams }: PageProps<"/profiles/[profileId]">) {
  const [{ profileId }, query] = await Promise.all([params, searchParams]);
  const found = load(profileId);
  if (!found) notFound();
  // A deleted Repository's Profiles stay with the Runs that used them, without its actions.
  if (found.source.deletedAt) {
    return (
      <Page>
        <PageHeader
          breadcrumbs={[{ href: routes.repositories, label: "Repositories" }]}
          title={found.source.name}
          description={PROFILE_DESCRIPTION}
          alerts={
            <Alert tone="info" title="This Repository was deleted">
              {`Version ${found.version.version} stays with the Runs that used it.`}
            </Alert>
          }
        />
        <ProfileBody profile={found.profile} query={query} base={routes.profile(found.profile.publicId)} />
      </Page>
    );
  }
  const latest = versionsOf(getDb(), found.source.id, 1)[0];
  return <RepositoryView source={found.source} version={found.version} latest={latest} count={latest?.version ?? 0} query={query} address={routes.profile(found.profile.publicId)} />;
}
