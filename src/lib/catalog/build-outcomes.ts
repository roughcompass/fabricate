import type { BuildFailure } from "@repo-facts/catalog-builder";
import type { BuildReason } from "./build";

/**
 * What each Catalog build failure means and what to do, in words
 * (operator-interface/page-patterns spec, content standard "Failures"). The
 * Catalog Builder's reason and message stay in a build's details.
 */
export const BUILD_FAILURE_SENTENCES: Readonly<Record<BuildFailure | "failed", string>> = {
  registry_unreachable: "The package registry couldn't be reached. Check FRONTEND_REGISTRY_CATALOG_REGISTRY and the network; the next Catalog check tries again.",
  not_found: "The package registry has no such version. It may have been unpublished; the next Catalog check builds the versions still in use.",
  integrity_mismatch: "A package didn't match the registry's checksum, so nothing was stored. Check the registry or mirror that served it.",
  invalid_package: "A package couldn't be read as the Catalog Builder expects. A newer Surveyor release may read it.",
  invalid_rules: "The team's rules in config/catalog-rules aren't valid. Fix the file, then the next Catalog check builds again.",
  invalid_entry: "The built entry didn't pass validation, so nothing was stored. A newer Surveyor release may build it.",
  failed: "The build stopped unexpectedly. The server log has the details; the next Catalog check tries again.",
};

/** Why a build was queued, as the status page names it. */
export const BUILD_REASON_LABELS: Readonly<Record<BuildReason, string>> = {
  in_use: "A Repository uses this version",
  published: "Newest release",
  rules: "The team's rules changed",
};

/** The sentence for a build's failure reason; an unknown reason reads as an unexpected failure. */
export function buildFailureSentence(reason: string): string {
  return BUILD_FAILURE_SENTENCES[reason as keyof typeof BUILD_FAILURE_SENTENCES] ?? BUILD_FAILURE_SENTENCES.failed;
}
