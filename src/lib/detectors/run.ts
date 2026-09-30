import { type Findings, type ProfileSource, reconcileProfile } from "@/lib/profiles/reconcile";
import type { ProfileDocument } from "@/lib/profiles/schema";
import { entryEvidence, lineEvidence, pointerEvidence } from "@/lib/snapshot/evidence";
import type { SnapshotReader } from "@/lib/snapshot/reader";
import { type Format, StructuredParseError, parse } from "@/lib/snapshot/structured";
import { type Detector, type DetectorContext, STAGES, type Stage, matchesPattern } from "./contract";
import { SyntaxTree, dialectOf } from "./syntax";

/** Detector id recorded on diagnostics from the shared syntax layer. */
export const SYNTAX_LAYER = "syntax";

/**
 * Runs a detector bundle over one snapshot, stage by stage, then reconciles
 * the candidates into a Profile. Cancellation is checked before every stage.
 * A detector that fails is recorded as a diagnostic, and every category it
 * searches is left incomplete, so its failure can never read as an absence.
 */

export interface DetectorRunOptions {
  reader: SnapshotReader;
  source: ProfileSource;
  detectorRelease: string;
  detectors: readonly Detector[];
  signal?: AbortSignal;
  /** Called before each stage; may throw to stop the run. */
  checkpoint?: (stage: Stage) => void;
}

export class DetectorRunCanceled extends Error {
  override name = "DetectorRunCanceled";
}

export async function runDetectors(options: DetectorRunOptions): Promise<ProfileDocument> {
  const { reader } = options;
  const findings: Findings = { facts: [], searches: [], services: [], references: [], diagnostics: [] };
  const shared = new Map<string, unknown>();
  const trees = new Map<string, Promise<SyntaxTree | null>>();

  for (const stage of STAGES) {
    if (options.signal?.aborted) throw new DetectorRunCanceled(`Analysis was canceled before the ${stage} stage`);
    options.checkpoint?.(stage);

    for (const detector of options.detectors.filter((candidate) => candidate.stage === stage)) {
      const context = contextFor(detector, { reader, findings, shared, trees }, options.signal);
      try {
        await detector.run(context);
      } catch (error) {
        if (error instanceof DetectorRunCanceled) throw error;
        findings.diagnostics.push({ path: "", reason: "detector_failed", detail: `${detector.id} failed: ${(error as Error).message}`.slice(0, 500), detector: detector.id });
        for (const category of detector.categories) findings.searches.push({ category, rule: `${detector.id}:failed`, surface: [], complete: false, skipped: [] });
      }
    }
  }

  return reconcileProfile(findings, reader, options.source, options.detectorRelease);
}

interface RunState {
  reader: SnapshotReader;
  findings: Findings;
  shared: Map<string, unknown>;
  trees: Map<string, Promise<SyntaxTree | null>>;
}

function contextFor(detector: Detector, { reader, findings, shared, trees }: RunState, signal?: AbortSignal): DetectorContext {
  const source = (rule: string) => ({ commit: reader.commitSha, detector: detector.id, rule });
  const diagnostic = (path: string, reason: string, detail: string) => findings.diagnostics.push({ path, reason, detail, detector: detector.id });

  const context: DetectorContext = {
    reader,
    commit: reader.commitSha,
    ...(signal && { signal }),
    shared,
    entries: (pattern) => reader.entries.filter((entry) => matchesPattern(entry.path, pattern)),
    async text(path) {
      const result = await reader.read(path);
      if (!result.ok) return null;
      return result.content.text === null ? null : result.content;
    },
    async parsed(path, format: Format) {
      const content = await context.text(path);
      if (!content) return null;
      try {
        return { content, value: parse(content.text!, format) };
      } catch (error) {
        if (!(error instanceof StructuredParseError)) throw error;
        diagnostic(path, "parse_failed", error.message);
        return null;
      }
    },
    syntax(path) {
      if (!dialectOf(path)) return Promise.resolve(null);
      let tree = trees.get(path);
      if (!tree) {
        tree = context.text(path).then((content) => {
          if (!content) return null;
          const result = SyntaxTree.parse(content);
          if (result.ok) return result.tree;
          findings.diagnostics.push({ path, reason: result.failure.reason, detail: result.failure.detail, detector: SYNTAX_LAYER });
          return null;
        });
        trees.set(path, tree);
      }
      return tree;
    },
    node(tree, node, rule) {
      const { start, end } = tree.lines(node);
      return lineEvidence(tree.content, source(rule), start, end);
    },
    lines: (content, rule, start, end) => lineEvidence(content, source(rule), start, end),
    pointer: (content, rule, format, pointer) => pointerEvidence(content, source(rule), format, pointer),
    entry: (entry, rule) => entryEvidence(entry, source(rule)),
    fact: (candidate) => findings.facts.push({ ...candidate, detector: detector.id }),
    search: (record) => findings.searches.push(record),
    service: (candidate) => findings.services.push(candidate),
    reference: (candidate) => findings.references.push(candidate),
    diagnostic,
  };
  return context;
}
