import type { Executor } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { registerSource } from "./catalog";
import { CloneUrl } from "./clone-url";
import type { SourceBoundary } from "./source-boundary";
import { BULK_LIMIT, parseBulkLines } from "./bulk-lines";
import type { RepositorySource } from "./source-records";

export { BULK_LIMIT, type BulkLine, parseBulkLines } from "./bulk-lines";

/*
 * Adding Repositories in bulk: one clone URL per line, optionally followed by
 * a branch, tag, or commit. Each line is added on its own, exactly as New
 * Repository adds one, named after its URL's owner and repository and queued
 * for profiling; a line that can't be added doesn't stop the others. Blank
 * lines are skipped.
 */

export interface BulkFailure {
  readonly line: number;
  readonly text: string;
  readonly message: string;
}

export interface BulkResult {
  readonly created: RepositorySource[];
  readonly failed: BulkFailure[];
}

/**
 * Adds every line of +input+ it can, in order. A later line with the same
 * repository as an earlier one is refused as already registered. More than
 * BULK_LIMIT lines, or none, is refused before anything is added.
 */
export function addRepositories(db: Executor, input: string, boundary?: SourceBoundary): BulkResult {
  const lines = parseBulkLines(input);
  if (lines.length === 0) throw new ValidationError([{ field: "urls", message: "Enter at least one clone URL" }]);
  if (lines.length > BULK_LIMIT) throw new ValidationError([{ field: "urls", message: `Enter at most ${BULK_LIMIT} clone URLs at a time; this has ${lines.length}` }]);

  const result: { created: RepositorySource[]; failed: BulkFailure[] } = { created: [], failed: [] };
  for (const line of lines) {
    try {
      result.created.push(registerSource(db, { name: "", cloneUrl: line.cloneUrl, gitRef: line.gitRef }, boundary, "imported"));
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      // A refused URL is shown again without any credentials it carried.
      const text = [CloneUrl.redact(line.cloneUrl), line.gitRef].filter(Boolean).join(" ");
      result.failed.push({ line: line.line, text, message: error.issues.map((issue) => issue.message).join(" ") });
    }
  }
  return result;
}
