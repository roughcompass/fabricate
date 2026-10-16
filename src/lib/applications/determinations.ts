import { eq, inArray } from "drizzle-orm";
import type { Assessment } from "@/lib/assessments/assessment-records";
import type { Executor } from "@/lib/db/client";
import { applicationAssessments, applications, initiatives } from "@/lib/db/schema";
import { profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import type { FactDocument } from "@/lib/profiles/states";
import { type Determination, determineRendering } from "./rendering";

/*
 * Writing each Application's rendering determination when its DE Web Run
 * finishes (rendering-assessment spec, "The determination records its
 * evidence"; design decision 7). It's stored on the Application, so Home
 * and the Applications page filter by it without reading a Profile. A Run
 * that fails or is canceled, or that couldn't read the Application's
 * repository, leaves the earlier determination as it was.
 */

/** The most facts, and evidence records per fact, a stored determination keeps; the Profile has the rest. */
const MAX_FACTS = 20;
const MAX_EVIDENCE = 10;

function compact(determination: Determination): Determination {
  const trim = <T extends { evidence: unknown[] }>(facts: T[]) => facts.slice(0, MAX_FACTS).map((fact) => ({ ...fact, evidence: fact.evidence.slice(0, MAX_EVIDENCE) }));
  return { ...determination, deciding: trim(determination.deciding), alsoObserved: trim(determination.alsoObserved), candidates: trim(determination.candidates) };
}

/**
 * Records the determination of every Application linked to +assessment+, a
 * finished DE Web Run, from the Profile of its repository, and marks each
 * linked Application updated. Returns how many determinations it wrote.
 * Runs in the transaction that finishes the Run.
 */
export function recordRenderingDeterminations(db: Executor, assessment: Assessment): number {
  const initiative = db.select({ deWeb: initiatives.deWeb }).from(initiatives).where(eq(initiatives.id, assessment.initiativeId)).get();
  if (!initiative?.deWeb) return 0;
  const linked = db.select({ application: applications }).from(applicationAssessments).innerJoin(applications, eq(applications.id, applicationAssessments.applicationId)).where(eq(applicationAssessments.assessmentId, assessment.id)).all();
  if (linked.length === 0) return 0;
  const now = new Date();
  db.update(applications)
    .set({ updatedAt: now })
    .where(inArray(applications.id, linked.map(({ application }) => application.id)))
    .run();
  if (assessment.state !== "complete" && assessment.state !== "complete_with_issues") return 0;

  const profiles = profilesOf(db, assessment.id);
  let written = 0;
  for (const { application } of linked) {
    const found = profiles.find(({ target }) => target.repositorySourceId === application.repositorySourceId);
    if (!found) continue;
    const document = profileDocument(found.profile).fact_document as unknown as FactDocument;
    const determination = compact(determineRendering(document, { profile: found.profile.publicId, assessment: assessment.publicId }));
    db.update(applications)
      .set({ renderingMode: determination.mode, renderingEvidence: JSON.stringify(determination), renderingAssessmentId: assessment.id, updatedAt: now })
      .where(eq(applications.id, application.id))
      .run();
    written += 1;
  }
  return written;
}

/** The determination stored on an Application, or null before its first finished DE Web Run. */
export function storedDetermination(application: { renderingEvidence: string | null }): Determination | null {
  return application.renderingEvidence ? (JSON.parse(application.renderingEvidence) as Determination) : null;
}
