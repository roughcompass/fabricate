import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { EvidenceView } from "@/components/results/evidence-view";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { evidenceLocation } from "@/lib/profiles/evidence-locations";
import { profileEvidence } from "@/lib/profiles/evidence-owners";
import { evidenceSection } from "@/lib/profiles/links";
import type { FactDocument } from "@/lib/profiles/states";
import { profileSectionHref } from "@/lib/profiles/tabs";
import { routes } from "@/lib/web/routes";

/** Evidence reached from a Profile, such as a version's, which has no Run (unify-surveys, design decision 7). */
const load = cache((profileId: string, evidenceId: string) => (isPublicId(profileId, "prf") ? profileEvidence(getDb(), profileId, evidenceId) : undefined));

export async function generateMetadata({ params }: PageProps<"/profiles/[profileId]/evidence/[evidenceId]">): Promise<Metadata> {
  const { profileId, evidenceId } = await params;
  const found = load(profileId, evidenceId);
  return { title: found ? `${evidenceLocation(found.record)} · ${found.repository.name}` : "Evidence not found" };
}

export default async function ProfileEvidencePage({ params }: PageProps<"/profiles/[profileId]/evidence/[evidenceId]">) {
  const { profileId, evidenceId } = await params;
  const found = load(profileId, evidenceId);
  if (!found) notFound();
  const section = evidenceSection(found.facts as unknown as FactDocument, evidenceId);
  const profileHref = routes.profile(found.profile.publicId);
  return (
    <EvidenceView
      breadcrumbs={[
        { href: routes.repositories, label: "Repositories" },
        { href: routes.repository(found.repository.publicId), label: found.repository.name },
        { href: section ? profileSectionHref(profileHref, section) : profileHref, label: `Version ${found.survey.number}` },
      ]}
      repository={found.repository.name}
      record={found.record}
      pin={{ repositoryPublicId: found.repository.publicId, internalRef: found.survey.internalRef, commitSha: found.survey.commitSha }}
    />
  );
}
