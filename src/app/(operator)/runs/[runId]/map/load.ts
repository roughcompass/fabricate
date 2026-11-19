import { notFound } from "next/navigation";
import { cache } from "react";
import { type MapView, loadMapView } from "@/lib/relationships/map-view";
import { type LoadedRun, loadRun } from "../load";

export interface LoadedMap extends LoadedRun {
  /** The map's view, or undefined while the Run has no map yet. */
  view: MapView | undefined;
}

/** A Run and its map view, read once per request and shared by the page and its metadata. */
export const loadMap = cache((publicId: string): LoadedMap | undefined => {
  const run = loadRun(publicId);
  return run && { ...run, view: loadMapView(run.db, run.run) };
});

/**
 * A map page's Run, its view, and the level +build+ makes from it, read once
 * for the page. An unknown Run or level is not found; a Run whose map isn't
 * written yet has no view and no level.
 */
export function loadMapLevel<Level>(runId: string, build: (run: LoadedMap, view: MapView) => Level | undefined): { run: LoadedMap; view: MapView; level: Level } | { run: LoadedMap; view: undefined } {
  const run = loadMap(runId);
  if (!run) notFound();
  if (!run.view) return { run, view: undefined };
  const level = build(run, run.view);
  if (level === undefined) notFound();
  return { run, view: run.view, level };
}

export function mapTitle(run: LoadedMap | undefined, level?: string): string {
  if (!run) return "Run not found";
  return [level, "Relationship Map", run.context.name].filter(Boolean).join(" · ");
}
