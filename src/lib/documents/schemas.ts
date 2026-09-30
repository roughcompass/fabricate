/** Names and supported versions of every versioned document Fabricate stores. */
export const DOCUMENT_SCHEMAS = {
  repositoryProfile: { name: "fabricate.repository_profile", versions: [1] },
  relationshipMap: { name: "fabricate.relationship_map", versions: [1] },
  standard: { name: "fabricate.standard", versions: [1] },
  finding: { name: "fabricate.finding", versions: [1] },
} as const;

export type DocumentKind = keyof typeof DOCUMENT_SCHEMAS;

export const CURRENT_VERSION = {
  repositoryProfile: 1,
  relationshipMap: 1,
  standard: 1,
  finding: 1,
} as const;
