import type { JsonValue } from "@repo-facts/contract";
import semver from "semver";
import { COMPARATORS, CONTAINS_MODES, CONTROL_KEY, LIMITS, OPERATORS, OPERATORS_BY_TYPE, type Operator, SEVERITIES, STANDARD_SCHEMA, STANDARD_SCHEMA_VERSION, SUBJECTS } from "./document";
import { COLLECTION_BY_ID, INPUT_SCHEMAS, type InputSchema, SELECTOR_BY_ID, SUBJECT_SCOPE, SUPPORTED_VERSIONS, type Scope, schemaOfScope } from "./registry";

/**
 * Complete server-side validation of a Standard document.
 *
 * Every problem is reported, each with the field it concerns, such as
 * `controls[1].condition.items[0].selector`. Validation checks metadata,
 * the document envelope, declared input schemas, at least one Control, unique
 * Control keys, subject scopes, every expression node and operator, selector
 * and collection references and their scopes, operand types, parameters,
 * hard limits, and that each Control can be evaluated against a declared
 * schema version. Nothing submitted is executed or interpreted as code: the
 * operator is matched against a closed list, and selectors and collections are
 * looked up in the registries.
 */

export interface Issue {
  field: string;
  message: string;
}

type Record_ = { readonly [key: string]: JsonValue };

export function validateStandard(input: JsonValue, options: { metadata?: { name: string; purpose: string } } = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (field: string, message: string) => void issues.push({ field, message });

  if (options.metadata) {
    if (!options.metadata.name.trim()) add("name", "Enter a name");
    if (!options.metadata.purpose.trim()) add("purpose", "Describe the Standard's purpose");
  }
  if (!isRecord(input)) {
    add("document", "A Standard must be a structured document");
    return issues;
  }
  unsupportedFields(input, ["schema", "schema_version", "input_schemas", "controls", "standard"], "document", add);
  if (input.schema !== STANDARD_SCHEMA) add("document.schema", `The document must declare schema ${STANDARD_SCHEMA}`);
  if (input.schema_version !== STANDARD_SCHEMA_VERSION) add("document.schema_version", `Standard document version ${JSON.stringify(input.schema_version ?? null)} is not supported`);

  const declared = inputSchemas(input.input_schemas, add);
  if (input.standard !== undefined) {
    const standard = input.standard;
    if (!isRecord(standard) || typeof standard.name !== "string" || typeof standard.purpose !== "string") add("document.standard", "The published Standard must record its name and purpose");
    else unsupportedFields(standard, ["name", "purpose"], "document.standard", add);
  }

  const controls = input.controls;
  if (!Array.isArray(controls)) {
    add("controls", "Controls must be a list");
    return issues;
  }
  if (controls.length === 0) add("controls", "Add at least one Control");
  if (controls.length > LIMITS.controls) add("controls", `A Standard can have at most ${LIMITS.controls} Controls`);
  const keys = new Map<string, number>();
  controls.slice(0, LIMITS.controls).forEach((control, index) => {
    const key = validateControl(control, `controls[${index}]`, declared, add);
    if (key === null) return;
    const first = keys.get(key);
    if (first === undefined) keys.set(key, index);
    else add(`controls[${index}].key`, `Control ${first + 1} already uses the key ${key}`);
  });
  return issues;
}

function inputSchemas(value: JsonValue | undefined, add: (field: string, message: string) => void): Record<InputSchema, number[]> {
  const declared: Record<InputSchema, number[]> = { repository_profile: [], relationship_map: [] };
  if (!isRecord(value)) {
    add("input_schemas", "Declare the input schema versions the Controls read");
    return declared;
  }
  unsupportedFields(value, INPUT_SCHEMAS, "input_schemas", add);
  for (const schema of INPUT_SCHEMAS) {
    const versions = value[schema];
    if (versions === undefined) continue;
    if (!Array.isArray(versions)) {
      add(`input_schemas.${schema}`, "Schema versions must be a list");
      continue;
    }
    for (const version of versions) {
      if (typeof version === "number" && SUPPORTED_VERSIONS[schema].includes(version)) declared[schema].push(version);
      else add(`input_schemas.${schema}`, `Version ${JSON.stringify(version)} of ${schema} is not supported; supported versions are ${SUPPORTED_VERSIONS[schema].join(", ")}`);
    }
  }
  return declared;
}

/** Validates one Control and returns its key, when it has a usable one. */
function validateControl(control: JsonValue, path: string, declared: Record<InputSchema, number[]>, add: (field: string, message: string) => void): string | null {
  if (!isRecord(control)) {
    add(path, "A Control must be a structured object");
    return null;
  }
  unsupportedFields(control, ["key", "title", "rationale", "severity", "subject", "applicability", "condition", "guidance"], path, add);

  let key: string | null = null;
  if (typeof control.key !== "string" || !control.key) add(`${path}.key`, "Enter a key");
  else if (control.key.length > LIMITS.key || !CONTROL_KEY.test(control.key)) add(`${path}.key`, `Keys use lowercase letters, digits, and single hyphens, start with a letter, and have at most ${LIMITS.key} characters`);
  else key = control.key;
  text(control.title, `${path}.title`, "Enter a title", LIMITS.title, add);
  text(control.rationale, `${path}.rationale`, "Explain the rationale", LIMITS.text, add);
  if (!(SEVERITIES as readonly JsonValue[]).includes(control.severity ?? null)) add(`${path}.severity`, `Choose a severity: ${SEVERITIES.join(", ")}`);
  if (control.guidance !== null && control.guidance !== undefined) text(control.guidance, `${path}.guidance`, "Guidance must be text, or left out", LIMITS.text, add);

  if (control.subject !== "repository" && control.subject !== "relationship_map") {
    add(`${path}.subject`, `Choose a subject: ${SUBJECTS.join(" or ")}`);
    return key;
  }
  const scope: Scope = SUBJECT_SCOPE[control.subject];
  const schema = schemaOfScope(scope);
  if (declared[schema].length === 0) add(`${path}.subject`, `Declare a supported ${schema} version to evaluate a ${control.subject === "repository" ? "repository" : "Relationship Map"} Control`);

  const used: { field: string; label: string; schema: InputSchema; versions: readonly number[] }[] = [];
  for (const part of ["applicability", "condition"] as const) {
    if (control[part] === undefined) add(`${path}.${part}`, part === "applicability" ? "Choose when the Control applies" : "Define the expected condition");
    else validateExpression(control[part]!, `${path}.${part}`, scope, 1, add, used);
  }
  // Each Control must be evaluable against at least one declared version of every schema it reads.
  for (const item of used) {
    if (declared[item.schema].length && !item.versions.some((version) => declared[item.schema].includes(version))) {
      add(item.field, `${item.label} does not support the declared ${item.schema} versions ${declared[item.schema].join(", ")}`);
    }
  }
  return key;
}

function validateExpression(node: JsonValue, path: string, scope: Scope, depth: number, add: (field: string, message: string) => void, used: { field: string; label: string; schema: InputSchema; versions: readonly number[] }[]): void {
  if (depth > LIMITS.depth) {
    add(path, `Expressions can nest at most ${LIMITS.depth} levels`);
    return;
  }
  if (!isRecord(node)) {
    add(path, "Expected an expression");
    return;
  }
  const op = node.op;
  if (typeof op !== "string" || !(OPERATORS as readonly string[]).includes(op)) {
    add(`${path}.op`, `Unsupported operator ${JSON.stringify(op ?? null)}`);
    return;
  }
  const child = (value: JsonValue, field: string, childScope: Scope) => validateExpression(value, `${path}.${field}`, childScope, depth + 1, add, used);

  switch (op as Operator) {
    case "always":
      unsupportedFields(node, ["op"], path, add);
      return;
    case "all":
    case "any": {
      unsupportedFields(node, ["op", "items"], path, add);
      const items = node.items;
      if (!Array.isArray(items) || items.length === 0) add(`${path}.items`, "Add at least one condition");
      else if (items.length > LIMITS.items) add(`${path}.items`, `Combine at most ${LIMITS.items} conditions in one group`);
      else items.forEach((item, index) => child(item, `items[${index}]`, scope));
      return;
    }
    case "not":
      unsupportedFields(node, ["op", "item"], path, add);
      if (node.item === undefined) add(`${path}.item`, "Choose the condition to negate");
      else child(node.item, "item", scope);
      return;
    case "every":
    case "some":
    case "count": {
      unsupportedFields(node, op === "count" ? ["op", "collection", "where", "comparator", "value"] : ["op", "collection", "where", "condition"], path, add);
      const collection = typeof node.collection === "string" ? COLLECTION_BY_ID.get(node.collection) : undefined;
      if (!collection) {
        add(`${path}.collection`, `Unknown collection ${JSON.stringify(node.collection ?? null)}`);
        return;
      }
      if (collection.scope !== scope) {
        add(`${path}.collection`, `${collection.label} cannot be used in this part of the Control`);
        return;
      }
      used.push({ field: `${path}.collection`, label: collection.label, schema: collection.schema, versions: collection.versions });
      if (node.where !== undefined) child(node.where, "where", collection.item);
      if (op === "count") {
        comparator(node.comparator, `${path}.comparator`, add);
        if (!isCount(node.value)) add(`${path}.value`, "Enter a whole number of zero or more");
      } else if (node.condition === undefined) add(`${path}.condition`, "Define the condition each item is checked against");
      else child(node.condition, "condition", collection.item);
      return;
    }
    default:
      validatePredicate(node, op as Operator, path, scope, add, used);
  }
}

function validatePredicate(node: Record_, op: Operator, path: string, scope: Scope, add: (field: string, message: string) => void, used: { field: string; label: string; schema: InputSchema; versions: readonly number[] }[]): void {
  const operands: Partial<Record<Operator, readonly string[]>> = { exists: [], equals: ["value"], in: ["values"], compare: ["comparator", "value"], contains: ["mode", "values"], semver_satisfies: ["range"] };
  unsupportedFields(node, ["op", "selector", "parameter", ...(operands[op] ?? [])], path, add);
  const selector = typeof node.selector === "string" ? SELECTOR_BY_ID.get(node.selector) : undefined;
  if (!selector) {
    add(`${path}.selector`, `Unknown field ${JSON.stringify(node.selector ?? null)}`);
    return;
  }
  if (selector.scope !== scope) {
    add(`${path}.selector`, `${selector.label} cannot be read in this part of the Control`);
    return;
  }
  used.push({ field: `${path}.selector`, label: selector.label, schema: selector.schema, versions: selector.versions });
  if (!OPERATORS_BY_TYPE[selector.type].includes(op)) add(`${path}.op`, `${selector.label} does not support ${op}; use ${OPERATORS_BY_TYPE[selector.type].join(", ")}`);

  if (selector.parameter) text(node.parameter, `${path}.parameter`, `Enter the ${selector.parameter.label.toLowerCase()}`, LIMITS.literal, add);
  else if (node.parameter !== undefined) add(`${path}.parameter`, `${selector.label} takes no parameter`);

  const choice = (value: JsonValue, field: string) => {
    if (typeof value !== "string" || !value || value.length > LIMITS.literal) add(field, `Enter text of at most ${LIMITS.literal} characters`);
    else if (selector.choices && !selector.choices.includes(value)) add(field, `${JSON.stringify(value)} is not an allowed ${selector.label.toLowerCase()}; choose ${selector.choices.join(", ")}`);
  };
  const strings = (value: JsonValue | undefined, field: string) => {
    if (!Array.isArray(value) || value.length === 0) add(field, "Enter at least one value");
    else if (value.length > LIMITS.values) add(field, `Enter at most ${LIMITS.values} values`);
    else value.forEach((item, index) => choice(item, `${field}[${index}]`));
  };

  switch (op) {
    case "equals":
      if (selector.type === "boolean" && typeof node.value !== "boolean") add(`${path}.value`, "Choose true or false");
      else if (selector.type === "number" && !isCount(node.value)) add(`${path}.value`, "Enter a whole number of zero or more");
      else if (selector.type === "string") choice(node.value ?? null, `${path}.value`);
      return;
    case "in":
      strings(node.values, `${path}.values`);
      return;
    case "compare":
      comparator(node.comparator, `${path}.comparator`, add);
      if (!isCount(node.value)) add(`${path}.value`, "Enter a whole number of zero or more");
      return;
    case "contains":
      if (!(CONTAINS_MODES as readonly JsonValue[]).includes(node.mode ?? null)) add(`${path}.mode`, "Choose whether all or any of the values must be present");
      strings(node.values, `${path}.values`);
      return;
    case "semver_satisfies":
      if (typeof node.range !== "string" || !node.range.trim() || node.range.length > LIMITS.range || semver.validRange(node.range) === null) add(`${path}.range`, `Enter a semantic version range of at most ${LIMITS.range} characters, such as >=18.0.0`);
      return;
    default:
      return;
  }
}

function comparator(value: JsonValue | undefined, field: string, add: (field: string, message: string) => void): void {
  if (!(COMPARATORS as readonly JsonValue[]).includes(value ?? null)) add(field, `Choose a comparison: ${COMPARATORS.join(", ")}`);
}

function text(value: JsonValue | undefined, field: string, missing: string, limit: number, add: (field: string, message: string) => void): void {
  if (typeof value !== "string" || !value.trim()) add(field, missing);
  else if (value.length > limit) add(field, `Use at most ${limit.toLocaleString("en-US")} characters`);
}

function unsupportedFields(value: Record_, allowed: readonly string[], path: string, add: (field: string, message: string) => void): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) add(`${path}.${key}`, `Unsupported field ${JSON.stringify(key)}`);
}

function isCount(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: JsonValue | undefined): value is Record_ {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
