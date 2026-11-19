/** Names and supported versions of every versioned document the Frontend Registry stores. */
export const DOCUMENT_SCHEMAS = {
  // Version 2 embeds Surveyor fact document version 2, which adds the design-system categories;
  // version 3 embeds fact document version 3, which names its Reference Catalog entries.
  repositoryProfile: { name: "fabricate.repository_profile", versions: [1, 2, 3] },
  relationshipMap: { name: "fabricate.relationship_map", versions: [1] },
  standard: { name: "fabricate.standard", versions: [1] },
  finding: { name: "fabricate.finding", versions: [1] },
} as const;

export type DocumentKind = keyof typeof DOCUMENT_SCHEMAS;

export const CURRENT_VERSION = {
  repositoryProfile: 3,
  relationshipMap: 1,
  standard: 1,
  finding: 1,
} as const;

/**
 * Versions that extend earlier ones: what a reader of the earlier version
 * reads is kept, unchanged, and fields are only added. Anything that reads an
 * earlier version can therefore read them. Repository Profile version 2
 * extends version 1, and version 3 extends both: Standards read a Profile's
 * fact document, and fact document version 3 adds Reference Catalog entries
 * to version 2's facts. Version 3's envelope no longer repeats the
 * Repository's name, clone URL, and reference, which no reader takes from it.
 */
const EXTENDS: Readonly<Partial<Record<DocumentKind, Readonly<Record<number, readonly number[]>>>>> = {
  repositoryProfile: { 2: [1], 3: [2, 1] },
};

/** Whether a reader that declares +declared+ versions of +kind+ can read a +version+ document. */
export function readableBy(kind: DocumentKind, version: number, declared: readonly number[]): boolean {
  if (declared.includes(version)) return true;
  return (EXTENDS[kind]?.[version] ?? []).some((earlier) => declared.includes(earlier));
}
