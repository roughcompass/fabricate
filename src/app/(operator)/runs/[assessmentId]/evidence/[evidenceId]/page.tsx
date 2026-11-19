import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { EvidenceView } from "@/components/results/evidence-view";
import { evidenceLocation } from "@/lib/profiles/evidence-locations";
import { runEvidence } from "@/lib/profiles/evidence-owners";
import { evidenceSection } from "@/lib/profiles/links";
import type { FactDocument } from "@/lib/profiles/states";
import { profileSectionHref } from "@/lib/profiles/tabs";
import { routes } from "@/lib/web/routes";
import { loadRun } from "../../load";

/** A Run's evidence, found through the evidence index (unify-surveys, design decision 7). */
const load = cache((assessmentId: string, evidenceId: string) => {
  const run = loadRun(assessmentId);
  if (!run) return undefined;
  const found = runEvidence(run.db, run.assessment.id, evidenceId);
  return found ? { run, found } : undefined;
});

export async function generateMetadata({ params }: PageProps<"/runs/[assessmentId]/evidence/[evidenceId]">): Promise<Metadata> {
  const { assessmentId, evidenceId } = await params;
  const loaded = load(assessmentId, evidenceId);
  return { title: loaded ? `${evidenceLocation(loaded.found.record)} · ${loaded.found.repository.name}` : "Evidence not found" };
}

export default async function EvidencePage({ params }: PageProps<"/runs/[assessmentId]/evidence/[evidenceId]">) {
  const { assessmentId, evidenceId } = await params;
  const loaded = load(assessmentId, evidenceId);
  if (!loaded) notFound();
  const { run, found } = loaded;
  // The Profile breadcrumb returns to the section that cites this evidence.
  const section = evidenceSection(found.facts as unknown as FactDocument, evidenceId);
  const profileHref = routes.profile(found.profile.publicId);
  return (
    <EvidenceView
      breadcrumbs={[...run.context.parents, { href: routes.run(run.assessment.publicId), label: run.context.name }, { href: section ? profileSectionHref(profileHref, section) : profileHref, label: found.repository.name }]}
      repository={found.repository.name}
      record={found.record}
      pin={{ sourcePublicId: found.repository.publicId, internalRef: found.survey.internalRef, commitSha: found.survey.commitSha }}
    />
  );
}
