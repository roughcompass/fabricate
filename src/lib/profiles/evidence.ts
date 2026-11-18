import type { JsonObject } from "@repo-facts/contract";
import { assessmentById } from "@/lib/assessments/lookups";
import type { Executor } from "@/lib/db/client";
import { type EvidenceLocation, evidenceLocations } from "./evidence-locations";
import { findProfile, profileDiagnostics, profileDocument } from "./profile-records";
import { reasoningLead } from "./reasoning";
import { type FactDocument, categoryDefinitions } from "./states";
import { type HeldFact, type ProfileView, profileView } from "./view";

/**
 * A row's evidence panel, loaded when it's opened rather than sent with the
 * page: a large repository's Profile holds thousands of locations and raw
 * values that few readers open.
 */

/** One block of a row's panel: a fact, or the facts of one category that share a value. */
export interface HeldSection {
  /** The fact's category, when the row holds facts of several. */
  label: string | null;
  locations: EvidenceLocation[];
  keys: string[];
  /** Keys left out after the first few of a merged row. */
  moreKeys: number;
  /** The fact's rule, when its category's facts came from more than one. */
  rule: string | null;
  reasoning: string | null;
  /** The value as the document stores it, as indented JSON. */
  raw: string;
}

export interface RowEvidence {
  assessmentId: string;
  sections: HeldSection[];
}

/** How many fact keys a merged row's panel names before counting the rest. */
const MERGED_KEYS = 20;

/** The table a row is in: a category's id, or a shared table's kind. */
function findRow(view: ProfileView, table: string, rowId: string): { held: HeldFact[]; evidence: string[]; reasoning: boolean } | undefined {
  for (const block of view.groups.flatMap((group) => group.blocks)) {
    if (block.kind === "category" && block.heading.definition.id === table) {
      const row = block.rows.find((candidate) => candidate.id === rowId);
      // A category row shows its reasoning's statement beside its value, so its panel repeats the reasoning only when it has examples to add.
      return row && { held: row.held, evidence: row.evidence, reasoning: Boolean(row.reasoning && reasoningLead(row.reasoning) !== row.reasoning) };
    }
    if ((block.kind === "dependencies" || block.kind === "scripts") && block.kind === table) {
      const row = block.groups.flatMap((group) => group.rows).find((candidate) => candidate.id === rowId);
      return row && { held: row.held, evidence: row.evidence, reasoning: true };
    }
  }
  return undefined;
}

/** What a row's panel shows, from its Profile's view, or undefined when there's no such row. */
export function rowEvidence(loaded: LoadedProfile, table: string, rowId: string): RowEvidence | undefined {
  const row = findRow(loaded.view, table, rowId);
  if (!row) return undefined;
  const { held } = row;
  const raw = (entry: HeldFact) => JSON.stringify(entry.fact.value, null, 2);
  // A row that stands for several facts of one category with the same value lists their locations once, then the facts' keys and the value they share.
  if (held.length > 1 && held.every((entry) => entry.category === held[0]!.category)) {
    return {
      assessmentId: loaded.assessmentId,
      sections: [{ label: null, locations: evidenceLocations(row.evidence, loaded.records), keys: held.slice(0, MERGED_KEYS).map((entry) => entry.fact.key), moreKeys: Math.max(0, held.length - MERGED_KEYS), rule: null, reasoning: null, raw: raw(held[0]!) }],
    };
  }
  return {
    assessmentId: loaded.assessmentId,
    sections: held.map((entry) => ({
      label: held.length > 1 ? (loaded.labels.get(entry.category) ?? entry.category) : null,
      locations: evidenceLocations(entry.fact.evidence, loaded.records),
      keys: [entry.fact.key],
      moreKeys: 0,
      rule: entry.rule,
      reasoning: row.reasoning ? (entry.fact.reasoning ?? null) : null,
      raw: raw(entry),
    })),
  };
}

/** A Profile's view, with what its panels need to name and link their evidence. */
export interface LoadedProfile {
  publicId: string;
  assessmentId: string;
  view: ProfileView;
  records: JsonObject;
  labels: ReadonlyMap<string, string>;
}

/** How long the last Profile a panel opened stays parsed, so its page's other panels open at once. */
const KEPT_MS = 2 * 60_000;
let kept: { loaded: LoadedProfile; timer: ReturnType<typeof setTimeout> } | undefined;

/** The Profile +publicId+ parsed and viewed as its page shows it, keeping the last one for the next panel. */
export function loadProfile(db: Executor, publicId: string): LoadedProfile | undefined {
  if (kept?.loaded.publicId === publicId) {
    kept.timer.refresh();
    return kept.loaded;
  }
  const profile = findProfile(db, publicId);
  if (!profile) return undefined;
  const document = profileDocument(profile);
  const facts = document.fact_document as unknown as FactDocument;
  const loaded: LoadedProfile = {
    publicId,
    assessmentId: assessmentById(db, profile.assessmentId).publicId,
    view: profileView(facts, profileDiagnostics(document)),
    records: (facts.evidence ?? {}) as JsonObject,
    labels: new Map(categoryDefinitions(facts).map((definition) => [definition.id, definition.label])),
  };
  if (kept) clearTimeout(kept.timer);
  const timer = setTimeout(() => (kept = undefined), KEPT_MS);
  timer.unref?.();
  kept = { loaded, timer };
  return loaded;
}
