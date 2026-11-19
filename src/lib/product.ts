/**
 * The names of the product and its parts, as the interface shows them
 * (operator-interface/page-patterns, content standard "Product names"). Every
 * browser title, product mark, and message that names one reads it from here.
 */
export const PRODUCT = {
  /** The product: CIB's registry of frontend applications. */
  name: "Frontend Registry",
  /** The analyzer that surveys a repository's commit and reports its facts. */
  surveyor: "Surveyor",
  /** Versioned descriptions of what repositories build on. */
  referenceCatalog: "Reference Catalog",
  /** Writes Reference Catalog entries from published packages and rules. */
  catalogBuilder: "Catalog Builder",
} as const;

/** The release of Surveyor a survey ran, as labels and messages name it. */
export const SURVEYOR_RELEASE_LABEL = `${PRODUCT.surveyor} release`;

/** A browser title for a page: its own title, then the product's name. */
export function browserTitle(title: string): string {
  return `${title} · ${PRODUCT.name}`;
}
