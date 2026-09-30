import { DOCUMENT_SCHEMAS } from "@/lib/documents/schemas";
import type { ValueType } from "./registry";

/**
 * The Standard document, version 1: a draft's structured content and, once
 * published, a Release's immutable Controls.
 *
 * A Control has a stable key, a title, a rationale, a severity, a subject
 * (each repository, or the assessment-wide Relationship Map), an
 * applicability expression, an expected condition, and optional guidance.
 * Expressions are JSON trees over a closed set of operators and registered
 * selectors, with hard limits on depth and size. A Release also records the
 * Standard's name and purpose as they were when it was published. See
 * docs/standards.md.
 */

export const STANDARD_SCHEMA = DOCUMENT_SCHEMAS.standard.name;
export const STANDARD_SCHEMA_VERSION = 1;

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SUBJECTS = ["repository", "relationship_map"] as const;
export type Subject = (typeof SUBJECTS)[number];

export const OPERATORS = ["always", "all", "any", "not", "exists", "equals", "in", "compare", "contains", "semver_satisfies", "every", "some", "count"] as const;
export type Operator = (typeof OPERATORS)[number];

export const COMPARATORS = ["eq", "lt", "lte", "gt", "gte"] as const;
export type Comparator = (typeof COMPARATORS)[number];

export const CONTAINS_MODES = ["all", "any"] as const;

/** The operators each selector value type supports. */
export const OPERATORS_BY_TYPE: Readonly<Record<ValueType, readonly Operator[]>> = {
  boolean: ["exists", "equals"],
  string: ["exists", "equals", "in"],
  string_set: ["exists", "contains"],
  number: ["exists", "equals", "compare"],
  version: ["exists", "semver_satisfies"],
};

/** Hard limits, enforced by validation before anything is saved as a Release or evaluated. */
export const LIMITS = {
  controls: 100,
  depth: 8,
  items: 16,
  values: 64,
  key: 64,
  title: 200,
  text: 4_000,
  literal: 200,
  range: 100,
} as const;

export interface SelectorReference {
  selector: string;
  /** The item a parametric selector reads, such as a package name. */
  parameter?: string;
}

export type Literal = string | number | boolean;

export type Expression =
  | { op: "always" }
  | { op: "all"; items: Expression[] }
  | { op: "any"; items: Expression[] }
  | { op: "not"; item: Expression }
  | ({ op: "exists" } & SelectorReference)
  | ({ op: "equals"; value: Literal } & SelectorReference)
  | ({ op: "in"; values: string[] } & SelectorReference)
  | ({ op: "compare"; comparator: Comparator; value: number } & SelectorReference)
  | ({ op: "contains"; mode: (typeof CONTAINS_MODES)[number]; values: string[] } & SelectorReference)
  | ({ op: "semver_satisfies"; range: string } & SelectorReference)
  | { op: "every"; collection: string; where?: Expression; condition: Expression }
  | { op: "some"; collection: string; where?: Expression; condition: Expression }
  | { op: "count"; collection: string; where?: Expression; comparator: Comparator; value: number };

export interface Control {
  key: string;
  title: string;
  rationale: string;
  severity: Severity;
  subject: Subject;
  applicability: Expression;
  condition: Expression;
  guidance: string | null;
}

export interface StandardDocument {
  schema: string;
  schema_version: number;
  input_schemas: { repository_profile: number[]; relationship_map: number[] };
  controls: Control[];
  /** Present on a Release: the Standard's name and purpose when it was published. */
  standard?: { name: string; purpose: string };
}

export const CONTROL_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
