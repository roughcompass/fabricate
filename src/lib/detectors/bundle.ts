import type { FabricateConfig } from "@/lib/config";
import type { JsonObject } from "@/lib/documents/canonical-json";
import { CURRENT_VERSION, DOCUMENT_SCHEMAS } from "@/lib/documents/schemas";
import type { Detector } from "./contract";
import { inventoryDetector } from "./inventory";
import { npmLockDetector } from "./lockfiles/npm";
import { pnpmLockDetector } from "./lockfiles/pnpm";
import { yarnLockDetector } from "./lockfiles/yarn";
import { manifestsDetector } from "./manifests";
import { packageMetadataDetector } from "./packages";
import { runtimeDetector } from "./runtime";
import { SYNTAX_DEPTH_LIMIT, SYNTAX_NODE_LIMIT, SYNTAX_PARSER } from "./syntax";
import { toolingDetector } from "./tooling";

/**
 * The versioned set of trusted, in-process detectors every Assessment runs.
 * The release and a digest of this configuration are recorded on each
 * Assessment, so identical commits, release, and configuration can be shown to
 * produce equivalent Profiles.
 */
export const DETECTOR_RELEASE = "2026.09.1";

/** Detectors in the order they run within each stage. */
export const DETECTORS: readonly Detector[] = [inventoryDetector, manifestsDetector, packageMetadataDetector, toolingDetector, runtimeDetector, npmLockDetector, pnpmLockDetector, yarnLockDetector];

/** Relationship resolver version, recorded with every Relationship Map. */
export const RESOLVER_VERSION = "1";

export function detectorConfiguration(config: FabricateConfig): JsonObject {
  return {
    schema: DOCUMENT_SCHEMAS.detectorConfiguration.name,
    schema_version: 1,
    release: DETECTOR_RELEASE,
    limits: { max_blob_bytes: config.analysis.maxBlobBytes, max_files: config.analysis.maxFiles, max_total_bytes: config.analysis.maxTotalBytes },
    detectors: DETECTORS.map((detector) => ({ id: detector.id, version: detector.version })),
    syntax: { parser: SYNTAX_PARSER.name, parser_version: SYNTAX_PARSER.version, max_nodes: SYNTAX_NODE_LIMIT, max_depth: SYNTAX_DEPTH_LIMIT },
    profile_schema_version: CURRENT_VERSION.repositoryProfile,
    relationship_schema_version: CURRENT_VERSION.relationshipMap,
    resolver_version: RESOLVER_VERSION,
  };
}
