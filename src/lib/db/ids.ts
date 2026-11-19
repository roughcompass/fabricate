import crypto from "node:crypto";

/**
 * Stable, prefixed public identifiers used in URLs, documents, and Git refs.
 * Database row ids never leave the data-access layer.
 */
export const PUBLIC_ID_PREFIXES = {
  repositorySource: "src",
  initiative: "ini",
  assessment: "asm",
  assessmentTarget: "tgt",
  sourceSnapshot: "snp",
  repositoryProfile: "prf",
  relationshipMap: "map",
  standard: "std",
  standardRelease: "rel",
  evaluation: "evl",
  finding: "fnd",
  demoApplication: "app",
  demoThread: "thr",
  demoComment: "cmt",
  demoProfile: "dpf",
  ontologyRelease: "olr",
  /** Applications created before onboarding keep the prefix they were given. */
  legacyApplication: "sea",
  application: "wap",
  lineOfBusiness: "lob",
  portal: "ptl",
  menuItem: "mnu",
  experienceVersion: "pxv",
  ownershipAssertion: "own",
  deConsoleConflict: "dcc",
  microfrontend: "mfe",
  placement: "plc",
  placementDecision: "pdc",
  externalReference: "xrf",
  bitbucketToken: "bbt",
  previewPreparation: "ppr",
  previewBuild: "pvw",
} as const;

export type PublicIdPrefix = (typeof PUBLIC_ID_PREFIXES)[keyof typeof PUBLIC_ID_PREFIXES];

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const LENGTH = 16;

export function generatePublicId(prefix: PublicIdPrefix): string {
  let suffix = "";
  for (let index = 0; index < LENGTH; index++) suffix += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${prefix}_${suffix}`;
}

export function isPublicId(value: unknown, prefix?: PublicIdPrefix): value is string {
  return typeof value === "string" && /^[a-z]{3}_[a-z0-9]{16}$/.test(value) && (prefix === undefined || value.startsWith(`${prefix}_`));
}
