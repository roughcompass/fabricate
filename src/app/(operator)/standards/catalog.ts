import { COMPARATORS, CONTAINS_MODES, LIMITS, OPERATORS_BY_TYPE, SEVERITIES } from "@/lib/standards/document";
import { COLLECTIONS, SELECTORS } from "@/lib/standards/registry";

/**
 * The registries and grammar the Standard editor offers, as plain data. The
 * server page passes it to the client editor, which renders every choice
 * from it and never accepts a free-form expression.
 */

export interface CatalogSelector {
  id: string;
  label: string;
  description: string;
  scope: string;
  type: string;
  parameter: { label: string; description: string } | null;
  choices: string[] | null;
}

interface CatalogCollection {
  id: string;
  label: string;
  description: string;
  scope: string;
  item: string;
}

export interface EditorCatalog {
  selectors: CatalogSelector[];
  collections: CatalogCollection[];
  operatorsByType: Record<string, string[]>;
  severities: string[];
  comparators: string[];
  containsModes: string[];
  limits: { controls: number; depth: number; items: number; values: number };
}

export function editorCatalog(): EditorCatalog {
  return {
    selectors: SELECTORS.map((selector) => ({
      id: selector.id,
      label: selector.label,
      description: selector.description,
      scope: selector.scope,
      type: selector.type,
      parameter: selector.parameter ?? null,
      choices: selector.choices ? [...selector.choices] : null,
    })),
    collections: COLLECTIONS.map((collection) => ({ id: collection.id, label: collection.label, description: collection.description, scope: collection.scope, item: collection.item })),
    operatorsByType: Object.fromEntries(Object.entries(OPERATORS_BY_TYPE).map(([type, operators]) => [type, [...operators]])),
    severities: [...SEVERITIES],
    comparators: [...COMPARATORS],
    containsModes: [...CONTAINS_MODES],
    limits: { controls: LIMITS.controls, depth: LIMITS.depth, items: LIMITS.items, values: LIMITS.values },
  };
}
