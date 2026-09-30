"use client";

import { Button } from "@/components/ui/button";
import { ChoiceGroup, Select, TextInput } from "@/components/ui/form";
import type { CatalogSelector, EditorCatalog } from "../../catalog";
import styles from "../../standards.module.css";

/**
 * A structured builder for one expression node. Every choice comes from the
 * catalog: the kind of condition, the field, the operator, and literal values.
 * There is no way to type an expression, so nothing an operator enters is
 * ever code.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Node = { [key: string]: Json };

const OPERATOR_LABELS: Record<string, string> = {
  exists: "is known and present",
  equals: "equals",
  in: "is one of",
  compare: "compares to a number",
  contains: "contains",
  semver_satisfies: "satisfies a version range",
};
const COMPARATOR_LABELS: Record<string, string> = { eq: "equal to", lt: "less than", lte: "at most", gt: "more than", gte: "at least" };
const KIND_LABELS: Record<string, string> = { always: "Always", field: "A field", all: "All of these", any: "Any of these", not: "Not", every: "Every item", some: "At least one item", count: "Number of items" };

export interface ExpressionEditorProps {
  node: Node;
  scope: string;
  path: string;
  depth: number;
  label: string;
  catalog: EditorCatalog;
  idPrefix: string;
  errorsFor: (path: string) => string[];
  onChange: (next: Node) => void;
}

/** The kind of builder a node needs. */
function kindOf(node: Node): string {
  const op = node.op;
  if (op === "always" || op === "all" || op === "any" || op === "not" || op === "every" || op === "some" || op === "count") return op;
  return "field";
}

export function defaultPredicate(catalog: EditorCatalog, scope: string): Node {
  const selector = catalog.selectors.find((item) => item.scope === scope);
  if (!selector) return { op: "always" };
  return { op: "exists", selector: selector.id, ...(selector.parameter && { parameter: "" }) };
}

function defaultNode(catalog: EditorCatalog, scope: string, kind: string, current: Node): Node {
  const collection = catalog.collections.find((item) => item.scope === scope);
  switch (kind) {
    case "always":
      return { op: "always" };
    case "all":
    case "any":
      // Switching between all and any keeps the conditions.
      return { op: kind, items: Array.isArray(current.items) ? current.items : [defaultPredicate(catalog, scope)] };
    case "not":
      return { op: "not", item: defaultPredicate(catalog, scope) };
    case "every":
    case "some":
      return collection ? { op: kind, collection: collection.id, condition: defaultPredicate(catalog, collection.item) } : { op: "always" };
    case "count":
      return collection ? { op: "count", collection: collection.id, comparator: "eq", value: 0 } : { op: "always" };
    default:
      return defaultPredicate(catalog, scope);
  }
}

export function ExpressionEditor({ node, scope, path, depth, label, catalog, idPrefix, errorsFor, onChange }: ExpressionEditorProps) {
  const id = `${idPrefix}-${path.replace(/[^A-Za-z0-9]+/g, "-")}`;
  const kind = kindOf(node);
  const collections = catalog.collections.filter((item) => item.scope === scope);
  const kinds = ["always", "field", "all", "any", "not", ...(collections.length ? ["every", "some", "count"] : [])];
  const nodeErrors = [...errorsFor(path), ...errorsFor(`${path}.op`)];
  const child = (field: string) => `${path}.${field}`;

  return (
    <fieldset className={styles.builder}>
      <legend className={styles.builderLegend}>{label}</legend>
      <Select
        id={`${id}-kind`}
        label="Condition type"
        value={kind}
        options={kinds.map((value) => ({ value, label: KIND_LABELS[value]! }))}
        errors={nodeErrors}
        onChange={(event) => onChange(defaultNode(catalog, scope, event.target.value, node))}
      />

      {kind === "field" && <PredicateEditor node={node} scope={scope} path={path} catalog={catalog} id={id} errorsFor={errorsFor} onChange={onChange} />}

      {(kind === "all" || kind === "any") && (
        <GroupEditor node={node} scope={scope} path={path} depth={depth} catalog={catalog} idPrefix={idPrefix} errorsFor={errorsFor} onChange={onChange} />
      )}

      {kind === "not" && (
        <ExpressionEditor node={record(node.item)} scope={scope} path={child("item")} depth={depth + 1} label="The condition that must not hold" catalog={catalog} idPrefix={idPrefix} errorsFor={errorsFor} onChange={(item) => onChange({ ...node, item })} />
      )}

      {(kind === "every" || kind === "some" || kind === "count") && (
        <QuantifierEditor node={node} scope={scope} path={path} depth={depth} catalog={catalog} idPrefix={idPrefix} id={id} errorsFor={errorsFor} onChange={onChange} />
      )}
    </fieldset>
  );
}

function GroupEditor({ node, scope, path, depth, catalog, idPrefix, errorsFor, onChange }: Omit<ExpressionEditorProps, "label">) {
  const items = Array.isArray(node.items) ? node.items.map(record) : [];
  const update = (next: Node[]) => onChange({ ...node, items: next });
  return (
    <>
      {items.map((item, index) => (
        <div key={index} className={styles.builder}>
          <ExpressionEditor
            node={item}
            scope={scope}
            path={`${path}.items[${index}]`}
            depth={depth + 1}
            label={`Condition ${index + 1}`}
            catalog={catalog}
            idPrefix={idPrefix}
            errorsFor={errorsFor}
            onChange={(next) => update(items.map((existing, position) => (position === index ? next : existing)))}
          />
          <div className={styles.toolbar}>
            <Button variant="ghost" icon="trash" onClick={() => update(items.filter((_, position) => position !== index))} aria-label={`Remove condition ${index + 1}`}>
              Remove condition
            </Button>
          </div>
        </div>
      ))}
      {errorsFor(`${path}.items`).map((message) => (
        <p key={message} className={styles.fieldError}>
          {message}
        </p>
      ))}
      <div className={styles.toolbar}>
        <Button icon="plus" disabled={items.length >= catalog.limits.items || depth >= catalog.limits.depth} onClick={() => update([...items, defaultPredicate(catalog, scope)])}>
          Add condition
        </Button>
      </div>
    </>
  );
}

function QuantifierEditor({ node, scope, path, depth, catalog, idPrefix, id, errorsFor, onChange }: Omit<ExpressionEditorProps, "label"> & { id: string }) {
  const collections = catalog.collections.filter((item) => item.scope === scope);
  const collection = collections.find((item) => item.id === node.collection) ?? collections[0]!;
  const hasWhere = node.where !== undefined && node.where !== null;
  return (
    <>
      <Select
        id={`${id}-collection`}
        label="Items"
        value={collection.id}
        options={collections.map((item) => ({ value: item.id, label: item.label }))}
        hint={collection.description}
        errors={errorsFor(`${path}.collection`)}
        onChange={(event) => {
          const next = collections.find((item) => item.id === event.target.value)!;
          const { where: _where, ...rest } = node;
          onChange({ ...rest, collection: next.id, ...(node.op !== "count" && { condition: defaultPredicate(catalog, next.item) }) });
        }}
      />
      <label className={styles.toolbar}>
        <input
          type="checkbox"
          checked={hasWhere}
          onChange={(event) => {
            const { where: _where, ...rest } = node;
            onChange(event.target.checked ? { ...node, where: defaultPredicate(catalog, collection.item) } : rest);
          }}
        />
        Only include items that match a condition
      </label>
      {hasWhere && (
        <ExpressionEditor node={record(node.where)} scope={collection.item} path={`${path}.where`} depth={depth + 1} label="Items to include" catalog={catalog} idPrefix={idPrefix} errorsFor={errorsFor} onChange={(where) => onChange({ ...node, where })} />
      )}
      {node.op === "count" ? (
        <div className={styles.row}>
          <Select id={`${id}-comparator`} label="The number of items is" value={String(node.comparator ?? "eq")} options={catalog.comparators.map((value) => ({ value, label: COMPARATOR_LABELS[value] ?? value }))} errors={errorsFor(`${path}.comparator`)} onChange={(event) => onChange({ ...node, comparator: event.target.value })} />
          <TextInput id={`${id}-value`} label="Count" type="number" min={0} step={1} value={String(node.value ?? 0)} errors={errorsFor(`${path}.value`)} onChange={(event) => onChange({ ...node, value: wholeNumber(event.target.value) })} />
        </div>
      ) : (
        <ExpressionEditor
          node={record(node.condition)}
          scope={collection.item}
          path={`${path}.condition`}
          depth={depth + 1}
          label={node.op === "every" ? "Condition every item must meet" : "Condition at least one item must meet"}
          catalog={catalog}
          idPrefix={idPrefix}
          errorsFor={errorsFor}
          onChange={(condition) => onChange({ ...node, condition })}
        />
      )}
    </>
  );
}

function PredicateEditor({ node, scope, path, catalog, id, errorsFor, onChange }: { node: Node; scope: string; path: string; catalog: EditorCatalog; id: string; errorsFor: (path: string) => string[]; onChange: (next: Node) => void }) {
  const selectors = catalog.selectors.filter((item) => item.scope === scope);
  const selector: CatalogSelector | undefined = selectors.find((item) => item.id === node.selector);
  const operators = selector ? (catalog.operatorsByType[selector.type] ?? []) : [];
  const op = typeof node.op === "string" && operators.includes(node.op) ? node.op : (operators[0] ?? "exists");

  const choose = (selectorId: string) => {
    const next = selectors.find((item) => item.id === selectorId)!;
    const nextOperators = catalog.operatorsByType[next.type] ?? [];
    onChange(operands({ op: nextOperators.includes(op) ? op : nextOperators[0]!, selector: next.id, ...(next.parameter && { parameter: typeof node.parameter === "string" ? node.parameter : "" }) }, next));
  };

  return (
    <>
      <div className={styles.row}>
        <Select
          id={`${id}-selector`}
          label="Field"
          value={selector?.id ?? ""}
          options={[...(selector ? [] : [{ value: "", label: "Choose a field" }]), ...selectors.map((item) => ({ value: item.id, label: item.label }))]}
          hint={selector?.description}
          errors={errorsFor(`${path}.selector`)}
          onChange={(event) => choose(event.target.value)}
        />
        {selector && (
          <Select id={`${id}-operator`} label="Operator" value={op} options={operators.map((value) => ({ value, label: OPERATOR_LABELS[value] ?? value }))} onChange={(event) => onChange(operands({ ...pick(node, ["selector", "parameter"]), op: event.target.value }, selector))} />
        )}
      </div>
      {selector?.parameter && (
        <TextInput id={`${id}-parameter`} label={selector.parameter.label} hint={selector.parameter.description} value={String(node.parameter ?? "")} errors={errorsFor(`${path}.parameter`)} onChange={(event) => onChange({ ...node, parameter: event.target.value })} />
      )}
      {selector && <OperandEditor node={{ ...node, op }} selector={selector} path={path} catalog={catalog} id={id} errorsFor={errorsFor} onChange={onChange} />}
    </>
  );
}

/** The operands an operator needs for +selector+, with defaults. */
function operands(node: Node, selector: CatalogSelector): Node {
  const base = pick(node, ["op", "selector", "parameter"]);
  switch (node.op) {
    case "equals":
      return { ...base, value: selector.type === "boolean" ? true : selector.type === "number" ? 0 : (selector.choices?.[0] ?? "") };
    case "in":
      return { ...base, values: [] };
    case "compare":
      return { ...base, comparator: "gte", value: 0 };
    case "contains":
      return { ...base, mode: "any", values: [] };
    case "semver_satisfies":
      return { ...base, range: "" };
    default:
      return base;
  }
}

function OperandEditor({ node, selector, path, catalog, id, errorsFor, onChange }: { node: Node; selector: CatalogSelector; path: string; catalog: EditorCatalog; id: string; errorsFor: (path: string) => string[]; onChange: (next: Node) => void }) {
  const valuesErrors = () => [...errorsFor(`${path}.values`), ...Object.keys(Array.isArray(node.values) ? node.values : []).flatMap((index) => errorsFor(`${path}.values[${index}]`))];
  const valueList = (legend: string) =>
    selector.choices ? (
      <ChoiceGroup
        key={`${selector.id}-${String(node.op)}`}
        id={`${id}-values`}
        name={`${id}-values`}
        legend={legend}
        type="checkbox"
        choices={selector.choices.map((value) => ({ value, label: value }))}
        selected={Array.isArray(node.values) ? node.values.map(String) : []}
        errors={valuesErrors()}
        onChange={(event) => {
          const current = Array.isArray(node.values) ? node.values.map(String) : [];
          onChange({ ...node, values: event.target.checked ? [...current, event.target.value] : current.filter((value) => value !== event.target.value) });
        }}
      />
    ) : (
      <TextInput id={`${id}-values`} label={legend} hint="Separate values with commas. Each value is compared as literal text." value={Array.isArray(node.values) ? node.values.join(", ") : ""} errors={valuesErrors()} onChange={(event) => onChange({ ...node, values: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} />
    );

  switch (node.op) {
    case "equals":
      if (selector.type === "boolean") return <Select id={`${id}-value`} label="Value" value={String(node.value)} options={[{ value: "true", label: "true" }, { value: "false", label: "false" }]} errors={errorsFor(`${path}.value`)} onChange={(event) => onChange({ ...node, value: event.target.value === "true" })} />;
      if (selector.type === "number") return <TextInput id={`${id}-value`} label="Value" type="number" min={0} step={1} value={String(node.value ?? 0)} errors={errorsFor(`${path}.value`)} onChange={(event) => onChange({ ...node, value: wholeNumber(event.target.value) })} />;
      if (selector.choices) return <Select id={`${id}-value`} label="Value" value={String(node.value ?? "")} options={selector.choices.map((value) => ({ value, label: value }))} errors={errorsFor(`${path}.value`)} onChange={(event) => onChange({ ...node, value: event.target.value })} />;
      return <TextInput id={`${id}-value`} label="Value" value={String(node.value ?? "")} errors={errorsFor(`${path}.value`)} onChange={(event) => onChange({ ...node, value: event.target.value })} />;
    case "in":
      return valueList("Values");
    case "compare":
      return (
        <div className={styles.row}>
          <Select id={`${id}-comparator`} label="Comparison" value={String(node.comparator ?? "gte")} options={catalog.comparators.map((value) => ({ value, label: COMPARATOR_LABELS[value] ?? value }))} errors={errorsFor(`${path}.comparator`)} onChange={(event) => onChange({ ...node, comparator: event.target.value })} />
          <TextInput id={`${id}-value`} label="Number" type="number" min={0} step={1} value={String(node.value ?? 0)} errors={errorsFor(`${path}.value`)} onChange={(event) => onChange({ ...node, value: wholeNumber(event.target.value) })} />
        </div>
      );
    case "contains":
      return (
        <>
          <Select id={`${id}-mode`} label="Must contain" value={String(node.mode ?? "any")} options={catalog.containsModes.map((value) => ({ value, label: value === "all" ? "All of the values" : "Any of the values" }))} errors={errorsFor(`${path}.mode`)} onChange={(event) => onChange({ ...node, mode: event.target.value })} />
          {valueList("Values")}
        </>
      );
    case "semver_satisfies":
      return <TextInput id={`${id}-range`} label="Version range" hint="A semantic version range, such as >=18.0.0" value={String(node.range ?? "")} errors={errorsFor(`${path}.range`)} onChange={(event) => onChange({ ...node, range: event.target.value })} />;
    default:
      return null;
  }
}

function wholeNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function pick(node: Node, keys: readonly string[]): Node {
  return Object.fromEntries(keys.filter((key) => node[key] !== undefined).map((key) => [key, node[key]!]));
}

export function record(value: Json | undefined): Node {
  return value && typeof value === "object" && !Array.isArray(value) ? value : { op: "always" };
}
