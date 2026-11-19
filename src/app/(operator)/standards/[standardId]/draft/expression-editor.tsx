"use client";

import { Button } from "@/components/ui/button";
import { Checkbox, Select, TextInput } from "@/components/ui/form";
import { booleanLabel, humanize } from "@/components/ui/status";
import type { VocabularySelector, EditorVocabulary } from "../../vocabulary";
import { fieldProps } from "./fields";
import styles from "./editor.module.css";

/**
 * A structured builder for one expression node. Every choice comes from the
 * catalog: the kind of condition, the field, the operator, and literal values.
 * There is no way to type an expression, so nothing an operator enters is
 * ever code. Nesting is shown by indentation and a guide line.
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
  vocabulary: EditorVocabulary;
  idPrefix: string;
  errorsFor: (path: string) => string[];
  onChange: (next: Node) => void;
  /** Removes this node from its group; top-level expressions have none. */
  onRemove?: () => void;
}

/** The kind of builder a node needs. */
function kindOf(node: Node): string {
  const op = node.op;
  if (op === "always" || op === "all" || op === "any" || op === "not" || op === "every" || op === "some" || op === "count") return op;
  return "field";
}

export function defaultPredicate(vocabulary: EditorVocabulary, scope: string): Node {
  const selector = vocabulary.selectors.find((item) => item.scope === scope);
  if (!selector) return { op: "always" };
  return { op: "exists", selector: selector.id, ...(selector.parameter && { parameter: "" }) };
}

function defaultNode(vocabulary: EditorVocabulary, scope: string, kind: string, current: Node): Node {
  const collection = vocabulary.collections.find((item) => item.scope === scope);
  switch (kind) {
    case "always":
      return { op: "always" };
    case "all":
    case "any":
      // Switching between all and any keeps the conditions.
      return { op: kind, items: Array.isArray(current.items) ? current.items : [defaultPredicate(vocabulary, scope)] };
    case "not":
      return { op: "not", item: defaultPredicate(vocabulary, scope) };
    case "every":
    case "some":
      return collection ? { op: kind, collection: collection.id, condition: defaultPredicate(vocabulary, collection.item) } : { op: "always" };
    case "count":
      return collection ? { op: "count", collection: collection.id, comparator: "eq", value: 0 } : { op: "always" };
    default:
      return defaultPredicate(vocabulary, scope);
  }
}

export function ExpressionEditor({ node, scope, path, depth, label, vocabulary, idPrefix, errorsFor, onChange, onRemove }: ExpressionEditorProps) {
  const id = `${idPrefix}-${path.replace(/[^A-Za-z0-9]+/g, "-")}`;
  const kind = kindOf(node);
  const collections = vocabulary.collections.filter((item) => item.scope === scope);
  const kinds = ["always", "field", "all", "any", "not", ...(collections.length ? ["every", "some", "count"] : [])];
  const nodeErrors = [...errorsFor(path), ...errorsFor(`${path}.op`)];
  const child = (field: string) => `${path}.${field}`;

  return (
    <fieldset className={styles.node} data-depth={depth} data-issue-path={path}>
      <legend className={styles.nodeLegend}>{label}</legend>
      {onRemove && (
        <span className={styles.remove}>
          <Button variant="tertiary" size="sm" icon="trash" label={`Remove ${label.toLowerCase()}`} onClick={onRemove} />
        </span>
      )}
      <div className={styles.fields}>
        <Select
          id={`${id}-kind`}
          label="Condition type"
          size="sm"
          value={kind}
          options={kinds.map((value) => ({ value, label: KIND_LABELS[value]! }))}
          errors={nodeErrors}
          onChange={(event) => onChange(defaultNode(vocabulary, scope, event.target.value, node))}
        />
        {kind === "field" && <PredicateFields node={node} scope={scope} path={path} vocabulary={vocabulary} id={id} errorsFor={errorsFor} onChange={onChange} />}
        {(kind === "every" || kind === "some" || kind === "count") && <QuantifierFields node={node} scope={scope} path={path} vocabulary={vocabulary} id={id} errorsFor={errorsFor} onChange={onChange} />}
      </div>

      {kind === "field" && <OperandEditor node={node} scope={scope} path={path} vocabulary={vocabulary} id={id} errorsFor={errorsFor} onChange={onChange} />}

      {(kind === "all" || kind === "any") && <GroupEditor node={node} scope={scope} path={path} depth={depth} vocabulary={vocabulary} idPrefix={idPrefix} errorsFor={errorsFor} onChange={onChange} />}

      {kind === "not" && (
        <div className={styles.children}>
          <ExpressionEditor node={record(node.item)} scope={scope} path={child("item")} depth={depth + 1} label="The condition that must not hold" vocabulary={vocabulary} idPrefix={idPrefix} errorsFor={errorsFor} onChange={(item) => onChange({ ...node, item })} />
        </div>
      )}

      {(kind === "every" || kind === "some" || kind === "count") && <QuantifierChildren node={node} scope={scope} path={path} depth={depth} vocabulary={vocabulary} idPrefix={idPrefix} errorsFor={errorsFor} onChange={onChange} />}
    </fieldset>
  );
}

function GroupEditor({ node, scope, path, depth, vocabulary, idPrefix, errorsFor, onChange }: Omit<ExpressionEditorProps, "label" | "onRemove">) {
  const items = Array.isArray(node.items) ? node.items.map(record) : [];
  const update = (next: Node[]) => onChange({ ...node, items: next });
  return (
    <div className={styles.children}>
      {items.map((item, index) => (
        <ExpressionEditor
          key={index}
          node={item}
          scope={scope}
          path={`${path}.items[${index}]`}
          depth={depth + 1}
          label={`Condition ${index + 1}`}
          vocabulary={vocabulary}
          idPrefix={idPrefix}
          errorsFor={errorsFor}
          onChange={(next) => update(items.map((existing, position) => (position === index ? next : existing)))}
          onRemove={() => update(items.filter((_, position) => position !== index))}
        />
      ))}
      {errorsFor(`${path}.items`).map((message) => (
        <p key={message} className={styles.fieldError}>
          {message}
        </p>
      ))}
      <div className={styles.toolbar}>
        <Button variant="tertiary" size="sm" icon="plus" disabled={items.length >= vocabulary.limits.items || depth >= vocabulary.limits.depth} onClick={() => update([...items, defaultPredicate(vocabulary, scope)])}>
          Add condition
        </Button>
      </div>
    </div>
  );
}

type FieldsProps = { node: Node; scope: string; path: string; vocabulary: EditorVocabulary; id: string; errorsFor: (path: string) => string[]; onChange: (next: Node) => void };

function collectionOf(node: Node, vocabulary: EditorVocabulary, scope: string) {
  const collections = vocabulary.collections.filter((item) => item.scope === scope);
  return { collections, collection: collections.find((item) => item.id === node.collection) ?? collections[0]! };
}

function QuantifierFields({ node, scope, path, vocabulary, id, errorsFor, onChange }: FieldsProps) {
  const field = fieldProps(id, path, errorsFor);
  const { collections, collection } = collectionOf(node, vocabulary, scope);
  return (
    <>
      <Select
        {...field("collection")}
        label="Items"
        size="sm"
        value={collection.id}
        options={collections.map((item) => ({ value: item.id, label: item.label }))}
        description={collection.description}
        onChange={(event) => {
          const next = collections.find((item) => item.id === event.target.value)!;
          const { where: _where, ...rest } = node;
          onChange({ ...rest, collection: next.id, ...(node.op !== "count" && { condition: defaultPredicate(vocabulary, next.item) }) });
        }}
      />
      {node.op === "count" && (
        <>
          <Select
            {...field("comparator")}
            label="The number of items is"
            size="sm"
            value={String(node.comparator ?? "eq")}
            options={vocabulary.comparators.map((value) => ({ value, label: COMPARATOR_LABELS[value] ?? value }))}
            onChange={(event) => onChange({ ...node, comparator: event.target.value })}
          />
          <TextInput {...field("value")} label="Count" size="sm" type="number" min={0} step={1} value={String(node.value ?? 0)} onChange={(event) => onChange({ ...node, value: wholeNumber(event.target.value) })} />
        </>
      )}
    </>
  );
}

function QuantifierChildren({ node, scope, path, depth, vocabulary, idPrefix, errorsFor, onChange }: Omit<ExpressionEditorProps, "label" | "onRemove">) {
  const { collection } = collectionOf(node, vocabulary, scope);
  const hasWhere = node.where !== undefined && node.where !== null;
  const id = `${idPrefix}-${path.replace(/[^A-Za-z0-9]+/g, "-")}`;
  return (
    <>
      <Checkbox
        id={`${id}-where`}
        label="Only include items that match a condition"
        checked={hasWhere}
        onChange={(event) => {
          const { where: _where, ...rest } = node;
          onChange(event.target.checked ? { ...node, where: defaultPredicate(vocabulary, collection.item) } : rest);
        }}
      />
      {(hasWhere || node.op !== "count") && (
        <div className={styles.children}>
          {hasWhere && <ExpressionEditor node={record(node.where)} scope={collection.item} path={`${path}.where`} depth={depth + 1} label="Items to include" vocabulary={vocabulary} idPrefix={idPrefix} errorsFor={errorsFor} onChange={(where) => onChange({ ...node, where })} />}
          {node.op !== "count" && (
            <ExpressionEditor
              node={record(node.condition)}
              scope={collection.item}
              path={`${path}.condition`}
              depth={depth + 1}
              label={node.op === "every" ? "Condition every item must meet" : "Condition at least one item must meet"}
              vocabulary={vocabulary}
              idPrefix={idPrefix}
              errorsFor={errorsFor}
              onChange={(condition) => onChange({ ...node, condition })}
            />
          )}
        </div>
      )}
    </>
  );
}

function selectorOf(node: Node, vocabulary: EditorVocabulary, scope: string) {
  const selectors = vocabulary.selectors.filter((item) => item.scope === scope);
  const selector: VocabularySelector | undefined = selectors.find((item) => item.id === node.selector);
  const operators = selector ? (vocabulary.operatorsByType[selector.type] ?? []) : [];
  const op = typeof node.op === "string" && operators.includes(node.op) ? node.op : (operators[0] ?? "exists");
  return { selectors, selector, operators, op };
}

function PredicateFields({ node, scope, path, vocabulary, id, errorsFor, onChange }: FieldsProps) {
  const field = fieldProps(id, path, errorsFor);
  const { selectors, selector, operators, op } = selectorOf(node, vocabulary, scope);
  const choose = (selectorId: string) => {
    const next = selectors.find((item) => item.id === selectorId)!;
    const nextOperators = vocabulary.operatorsByType[next.type] ?? [];
    onChange(operands({ op: nextOperators.includes(op) ? op : nextOperators[0]!, selector: next.id, ...(next.parameter && { parameter: typeof node.parameter === "string" ? node.parameter : "" }) }, next));
  };
  return (
    <>
      <Select
        {...field("selector")}
        label="Field"
        size="sm"
        value={selector?.id ?? ""}
        options={[...(selector ? [] : [{ value: "", label: "Choose a field" }]), ...selectors.map((item) => ({ value: item.id, label: item.label }))]}
        description={selector?.description}
        onChange={(event) => choose(event.target.value)}
      />
      {selector && (
        <Select
          id={`${id}-operator`}
          label="Operator"
          size="sm"
          value={op}
          options={operators.map((value) => ({ value, label: OPERATOR_LABELS[value] ?? value }))}
          onChange={(event) => onChange(operands({ ...pick(node, ["selector", "parameter"]), op: event.target.value }, selector))}
        />
      )}
      {selector?.parameter && (
        <TextInput {...field("parameter")} label={selector.parameter.label} size="sm" description={selector.parameter.description} value={String(node.parameter ?? "")} onChange={(event) => onChange({ ...node, parameter: event.target.value })} />
      )}
    </>
  );
}

/** The operands an operator needs for +selector+, with defaults. */
function operands(node: Node, selector: VocabularySelector): Node {
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

function OperandEditor({ node, scope, path, vocabulary, id, errorsFor, onChange }: FieldsProps) {
  const field = fieldProps(id, path, errorsFor);
  const { selector, op } = selectorOf(node, vocabulary, scope);
  if (!selector) return null;
  const current = { ...node, op };
  const valuesErrors = () => [...errorsFor(`${path}.values`), ...Object.keys(Array.isArray(node.values) ? node.values : []).flatMap((index) => errorsFor(`${path}.values[${index}]`))];
  const valueList = (legend: string) =>
    selector.choices ? (
      <fieldset key={`${selector.id}-${op}`} className={styles.values} data-issue-path={`${path}.values`}>
        <legend className={styles.valuesLegend}>{legend}</legend>
        <div className={styles.valueList}>
          {selector.choices.map((value) => {
            const selected = Array.isArray(node.values) ? node.values.map(String) : [];
            return (
              <Checkbox
                key={value}
                id={`${id}-values-${value.replace(/[^A-Za-z0-9_-]/g, "_")}`}
                label={humanize(value)}
                checked={selected.includes(value)}
                onChange={(event) => onChange({ ...current, values: event.target.checked ? [...selected, value] : selected.filter((existing) => existing !== value) })}
              />
            );
          })}
        </div>
        {valuesErrors().length > 0 && <p className={styles.fieldError}>{valuesErrors().join(" ")}</p>}
      </fieldset>
    ) : (
      <TextInput
        id={`${id}-values`}
        label={legend}
        size="sm"
        description="Separate values with commas. Each value is compared as literal text."
        value={Array.isArray(node.values) ? node.values.join(", ") : ""}
        errors={valuesErrors()}
        onChange={(event) => onChange({ ...current, values: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })}
      />
    );

  const row = (children: React.ReactNode) => <div className={styles.fields}>{children}</div>;
  switch (op) {
    case "equals":
      if (selector.type === "boolean")
        return row(
          <Select
            {...field("value")}
            label="Value"
            size="sm"
            value={String(node.value)}
            options={[true, false].map((value) => ({ value: String(value), label: booleanLabel(value) }))}
            onChange={(event) => onChange({ ...current, value: event.target.value === "true" })}
          />,
        );
      if (selector.type === "number") return row(<TextInput {...field("value")} label="Value" size="sm" type="number" min={0} step={1} value={String(node.value ?? 0)} onChange={(event) => onChange({ ...current, value: wholeNumber(event.target.value) })} />);
      if (selector.choices)
        return row(
          <Select
            {...field("value")}
            label="Value"
            size="sm"
            value={String(node.value ?? "")}
            options={selector.choices.map((value) => ({ value, label: humanize(value) }))}
            onChange={(event) => onChange({ ...current, value: event.target.value })}
          />,
        );
      return row(<TextInput {...field("value")} label="Value" size="sm" value={String(node.value ?? "")} onChange={(event) => onChange({ ...current, value: event.target.value })} />);
    case "in":
      return valueList("Values");
    case "compare":
      return row(
        <>
          <Select
            {...field("comparator")}
            label="Comparison"
            size="sm"
            value={String(node.comparator ?? "gte")}
            options={vocabulary.comparators.map((value) => ({ value, label: COMPARATOR_LABELS[value] ?? value }))}
            onChange={(event) => onChange({ ...current, comparator: event.target.value })}
          />
          <TextInput {...field("value")} label="Number" size="sm" type="number" min={0} step={1} value={String(node.value ?? 0)} onChange={(event) => onChange({ ...current, value: wholeNumber(event.target.value) })} />
        </>,
      );
    case "contains":
      return (
        <>
          {row(
            <Select
              {...field("mode")}
              label="Must contain"
              size="sm"
              value={String(node.mode ?? "any")}
              options={vocabulary.containsModes.map((value) => ({ value, label: value === "all" ? "All of the values" : "Any of the values" }))}
              onChange={(event) => onChange({ ...current, mode: event.target.value })}
            />,
          )}
          {valueList("Values")}
        </>
      );
    case "semver_satisfies":
      return row(<TextInput {...field("range")} label="Version range" size="sm" description="A semantic version range, such as >=18.0.0" value={String(node.range ?? "")} onChange={(event) => onChange({ ...current, range: event.target.value })} />);
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
