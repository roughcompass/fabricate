import fs from "node:fs";
import path from "node:path";
import type { Executor } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { CloneUrl } from "./clone-url";
import { BoundaryViolation, SourceBoundary } from "./source-boundary";
import { type RepositorySource, findEnabledSourceByCanonicalUrl, insertSource } from "./source-records";

/**
 * Previews and confirms importing the immediate child Git working trees of a
 * local directory as file:// sources.
 *
 * Previewing only inspects the filesystem; it never writes to the catalog.
 * Denied children, such as fleet-kit/, are skipped without being inspected.
 * Confirmation re-runs the preview, so only candidates that are still valid
 * children of the directory can be added, whatever paths were submitted.
 */

export type CandidateStatus = "importable" | "registered" | "rejected";

export interface ImportCandidate {
  name: string;
  path: string;
  cloneUrl: string | null;
  status: CandidateStatus;
  reason: string | null;
}

export interface ImportPreview {
  root: string;
  candidates: ImportCandidate[];
}

export interface ImportResult {
  created: RepositorySource[];
  failed: { candidate: ImportCandidate; message: string }[];
}

export function previewImport(db: Executor, directory: string, boundary = new SourceBoundary()): ImportPreview {
  const root = boundary.checkDirectory(directory.trim());
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink()))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const candidates = entries.flatMap((entry) => {
    const candidate = candidateFor(db, boundary, path.join(root, entry.name), entry.name);
    return candidate ? [candidate] : [];
  });
  return { root, candidates };
}

export function confirmImport(db: Executor, directory: string, selectedPaths: readonly string[], boundary = new SourceBoundary()): ImportResult {
  const selected = new Set(selectedPaths);
  const { candidates } = previewImport(db, directory, boundary);
  const result: ImportResult = { created: [], failed: [] };

  for (const candidate of candidates) {
    if (candidate.status !== "importable" || !selected.has(candidate.path)) continue;
    const url = CloneUrl.parse(candidate.cloneUrl!);
    try {
      result.created.push(insertSource(db, { name: candidate.name, cloneUrl: url.toString(), canonicalUrl: url.canonical }));
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      result.failed.push({ candidate, message: error.issues.map((issue) => issue.message).join(" ") });
    }
  }
  return result;
}

function candidateFor(db: Executor, boundary: SourceBoundary, child: string, name: string): ImportCandidate | null {
  if (boundary.denied(child)) return null;

  try {
    const location = boundary.check(child);
    if (location.gitDir === location.path) return null; // a bare repository is not a working tree
    const url = CloneUrl.forLocalPath(location.path);
    const existing = findEnabledSourceByCanonicalUrl(db, url.canonical);
    return {
      name,
      path: child,
      cloneUrl: url.toString(),
      status: existing ? "registered" : "importable",
      reason: existing ? `Already registered as ${existing.name}` : null,
    };
  } catch (error) {
    if (!(error instanceof BoundaryViolation)) throw error;
    // Non-repositories are not candidates; denied targets are not mentioned.
    if (error.code === "not_a_repository" || error.code === "not_a_directory" || error.code === "denied_root") return null;
    return { name, path: child, cloneUrl: null, status: "rejected", reason: error.message };
  }
}
