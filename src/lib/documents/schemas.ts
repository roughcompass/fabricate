/** Names and supported versions of every versioned document Fabricate stores. */
export const DOCUMENT_SCHEMAS = {
  // Version 2 embeds repo-facts fact document version 2, which adds the design-system categories.
  repositoryProfile: { name: "fabricate.repository_profile", versions: [1, 2] },
  relationshipMap: { name: "fabricate.relationship_map", versions: [1] },
  standard: { name: "fabricate.standard", versions: [1] },
  finding: { name: "fabricate.finding", versions: [1] },
} as const;

export type DocumentKind = keyof typeof DOCUMENT_SCHEMAS;

export const CURRENT_VERSION = {
  repositoryProfile: 2,
  relationshipMap: 1,
  standard: 1,
  finding: 1,
} as const;

/**
 * Versions that extend earlier ones: they keep every field of the earlier
 * version, unchanged, and only add fields. Anything that reads an earlier
 * version can therefore read them. Repository Profile version 2 extends
 * version 1.
 */
const EXTENDS: Readonly<Partial<Record<DocumentKind, Readonly<Record<number, readonly number[]>>>>> = {
  repositoryProfile: { 2: [1] },
};

/** Whether a reader that declares +declared+ versions of +kind+ can read a +version+ document. */
export function readableBy(kind: DocumentKind, version: number, declared: readonly number[]): boolean {
  if (declared.includes(version)) return true;
  return (EXTENDS[kind]?.[version] ?? []).some((earlier) => declared.includes(earlier));
}
