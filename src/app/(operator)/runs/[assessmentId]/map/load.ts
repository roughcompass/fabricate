import { cache } from "react";
import { type Assessment, assessmentNumber, findAssessment } from "@/lib/assessments/assessment-records";
import { type Executor, getDb } from "@/lib/db/client";
import { type Initiative, initiativeById } from "@/lib/initiatives/initiative-records";
import { type MapView, loadMapView } from "@/lib/relationships/map-view";

export interface LoadedRun {
  db: Executor;
  assessment: Assessment;
  initiative: Initiative;
  number: number;
  /** The map's view, or undefined while the Run has no map yet. */
  view: MapView | undefined;
}

/** A Run and its map view, read once per request and shared by the page and its metadata. */
export const loadRun = cache((publicId: string): LoadedRun | undefined => {
  const db = getDb();
  const assessment = findAssessment(db, publicId);
  if (!assessment) return undefined;
  return { db, assessment, initiative: initiativeById(db, assessment.initiativeId), number: assessmentNumber(db, assessment), view: loadMapView(db, assessment) };
});

export function mapTitle(run: LoadedRun | undefined, level?: string): string {
  if (!run) return "Run not found";
  return [level, "Relationship Map", `Run #${run.number}`].filter(Boolean).join(" · ");
}
