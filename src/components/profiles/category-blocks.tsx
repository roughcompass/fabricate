import type { JsonObject } from "@repo-facts/contract";
import { useId } from "react";
import { EvidenceList } from "@/components/results/evidence";
import { NoValuePlaceholder } from "@/components/results/no-value";
import { buttonProps } from "@/components/ui/button-content";
import { countLabel } from "@/components/ui/count";
import { Disclosure } from "@/components/ui/disclosure";
import { Icon } from "@/components/ui/icon";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import type { Cell } from "@/lib/profiles/layouts";
import type { CategoryBlock, CompactBlock, Heading, HeldFact, Row, SharedBlock, SharedCell, SharedRow } from "@/lib/profiles/view";
import styles from "./profile.module.css";

/** How many fact keys a merged row's evidence panel names before counting the rest. */
const MERGED_KEYS = 20;

/** What a cell needs to link evidence: the records, and the Run they belong to. */
export interface EvidenceContext {
  records: JsonObject;
  assessmentId: string;
  /** Category labels by id, to name each fact a row holds. */
  labels: ReadonlyMap<string, string>;
}

/** A category with facts: its heading, its search and rule, and its facts in its own columns, a page at a time when there are many. */
export function CategoryTable({ block, context, pagination }: { block: CategoryBlock; context: EvidenceContext; pagination?: React.ReactNode }) {
  const { definition } = block.heading;
  const span = block.columns.length + (block.stepsColumn ? 1 : 0);
  return (
    <Section id={definition.id} level={3} title={definition.label} description={definition.description} actions={<Status state={block.heading.state} />}>
      <SearchLine heading={block.heading} />
      <Panel flush>
        <Table
          label={definition.label}
          head={
            <>
              {block.columns.map((column) => (
                <Th key={column}>{column}</Th>
              ))}
              {block.stepsColumn && <Th>{block.stepsColumn}</Th>}
              <Th>Evidence</Th>
            </>
          }
        >
          {block.rows.map((row) => (
            <tr key={row.id}>
              <RowCellsView row={row} columns={block.columns} span={span} context={context} />
              {block.stepsColumn && row.cells.kind === "cells" && (
                <Td label={block.stepsColumn}>
                  {row.steps.length ? (
                    // The count and what the steps check, with the steps themselves one click away.
                    <Disclosure variant="plain" summary={[countLabel(row.steps.length, "step"), row.checks.length ? `checks ${row.checks.join(", ").toLowerCase()}` : null].filter(Boolean).join(" · ")}>
                      <ol className={styles.steps}>
                        {row.steps.map((step, index) => (
                          <li key={index} className={styles.step}>
                            <span className={styles.stepCommand}>{step.text}</span>
                            {step.secondary && <Secondary>{step.secondary}</Secondary>}
                          </li>
                        ))}
                      </ol>
                    </Disclosure>
                  ) : (
                    <span className={styles.muted}>None</span>
                  )}
                </Td>
              )}
              <Td label="Evidence">
                <RowDetails title={row.cells.kind === "cells" ? (row.cells.cells[0]?.text ?? row.id) : row.id} held={row.held} evidence={row.evidence} context={context} reasoning={Boolean(row.reasoning && firstSentence(row.reasoning) !== row.reasoning)} />
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
      {pagination}
    </Section>
  );
}

/** A reasoning's first sentence, or all of it when it's one sentence. */
function firstSentence(text: string): string {
  const end = text.search(/\.\s/);
  return end === -1 ? text : text.slice(0, end + 1);
}

function RowCellsView({ row, columns, span, context }: { row: Row; columns: readonly string[]; span: number; context: EvidenceContext }) {
  const state = row.state && <Status state={row.state} size="sm" />;
  // A long reasoning shows its first sentence here and in full in the row's evidence panel.
  const reasoning = row.reasoning && <Secondary>{firstSentence(row.reasoning)}</Secondary>;
  if (row.cells.kind === "whole") {
    return (
      <Td label="Value" span={span}>
        {row.cells.text} {state}
        {reasoning}
      </Td>
    );
  }
  if (row.cells.kind === "candidates") {
    return (
      <Td label="Value" span={span}>
        <Status state="conflicting" size="sm" />
        <ul className={styles.candidates} aria-label="Candidates">
          {row.cells.candidates.map((candidate, index) => (
            <li key={index}>
              {candidate.text} <EvidenceList ids={candidate.evidence} records={context.records} assessmentId={context.assessmentId} source={false} />
            </li>
          ))}
        </ul>
      </Td>
    );
  }
  return (
    <>
      {row.cells.cells.map((cell, index) => (
        <Td key={columns[index]} label={columns[index]}>
          {cell ? <CellView cell={cell} /> : null}
          {index === 0 && state}
          {index === 0 && reasoning}
          {index === 0 && row.occurrences > 1 && <Secondary>{`${row.occurrences.toLocaleString("en-US")} occurrences`}</Secondary>}
        </Td>
      ))}
    </>
  );
}

export function CellView({ cell }: { cell: Cell }) {
  return (
    <>
      <span className={[cell.mono && styles.mono, cell.muted && styles.muted].filter(Boolean).join(" ") || undefined}>{cell.text}</span>
      {cell.secondary && <Secondary>{cell.secondary}</Secondary>}
    </>
  );
}

/**
 * A row's evidence as a count that opens a panel beside the page, wide enough
 * to read: each fact's locations, key, and raw value, and its rule when the
 * category has several. It's a native popover, so it opens and closes without
 * JavaScript, and Escape or a click outside closes it. A category row shows
 * its reasoning beside its value, so only a shared row's panel repeats it.
 */
function RowDetails({ title, held, evidence, context, reasoning = true }: { title: string; held: readonly HeldFact[]; evidence: readonly string[]; context: EvidenceContext; reasoning?: boolean }) {
  const id = `evidence-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  // A row that stands for several facts of one category with the same value lists their locations once, then the facts' keys and the value they share.
  const repeated = held.length > 1 && held.every((entry) => entry.category === held[0]!.category);
  return (
    <>
      <button type="button" popoverTarget={id} className={styles.evidenceTrigger}>
        {`Show ${countLabel(evidence.length, "location")}`}
      </button>
      <div id={id} popover="auto" role="dialog" aria-label={`Evidence for ${title}`} className={styles.sheet}>
        <div className={styles.sheetHeader}>
          <span className={styles.sheetTitle}>{title}</span>
          <button type="button" popoverTarget={id} popoverTargetAction="hide" {...buttonProps("tertiary", "sm", true)} aria-label="Close evidence" title="Close evidence">
            <Icon name="x" size={14} />
          </button>
        </div>
        {repeated ? (
          <div className={styles.held}>
            <EvidenceList ids={[...evidence]} records={context.records} assessmentId={context.assessmentId} source={false} />
            <span className={styles.secondary}>
              {`${countLabel(held.length, "fact")} with this value: `}
              <span className={styles.mono}>{held.slice(0, MERGED_KEYS).map((entry) => entry.fact.key).join(", ")}</span>
              {held.length > MERGED_KEYS && `, and ${held.length - MERGED_KEYS} more`}
            </span>
            <pre className={styles.raw} aria-label={`Raw value of ${held[0]!.fact.key}`}>
              {JSON.stringify(held[0]!.fact.value, null, 2)}
            </pre>
          </div>
        ) : held.map((entry) => (
          <div key={`${entry.category}:${entry.fact.key}`} className={styles.held}>
            {held.length > 1 && <span className={styles.heldLabel}>{context.labels.get(entry.category) ?? entry.category}</span>}
            <EvidenceList ids={entry.fact.evidence} records={context.records} assessmentId={context.assessmentId} source={false} />
            <span className={styles.secondary}>
              Fact <span className={styles.mono}>{entry.fact.key}</span>
              {entry.rule && (
                <>
                  {" · rule "}
                  <span className={styles.mono}>{entry.rule}</span>
                </>
              )}
            </span>
            {reasoning && entry.fact.reasoning && <span className={styles.secondary}>{entry.fact.reasoning}</span>}
            <pre className={styles.raw} aria-label={`Raw value of ${entry.fact.key}`}>
              {JSON.stringify(entry.fact.value, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </>
  );
}

/** How far a category's search went and which rule its facts came from. */
export function SearchLine({ heading }: { heading: Heading }) {
  const { search, rules } = heading;
  if (!search) return null;
  const outcome = search.skipped.length ? `${countLabel(search.skipped.length, "input")} skipped` : search.complete ? "complete" : "incomplete";
  const parts = search.surface.length ? [`Searched ${countLabel(search.surface.length, "input")}`, outcome] : [`Search ${outcome}`];
  return (
    <div className={styles.search}>
      <span>{parts.join(" · ")}</span>
      {rules.length === 1 && (
        <span>
          Rule <code>{rules[0]}</code>
        </span>
      )}
      {rules.length > 1 && (
        <Disclosure variant="plain" summary={countLabel(rules.length, "rule")}>
          <ul className={`${styles.inputs} ${styles.mono}`}>
            {rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </Disclosure>
      )}
      {search.surface.length > 0 && (
        <Disclosure variant="plain" summary="Inputs searched">
          <ul className={`${styles.inputs} ${styles.mono}`}>
            {search.surface.map((path) => (
              <li key={path}>{path || "(repository)"}</li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

const SHARED_TITLES: Record<SharedBlock["kind"], { title: string; description: string }> = {
  dependencies: { title: "Dependencies", description: "Direct dependencies by manifest, with their declared ranges, the versions lockfiles resolve, and whether they're internal" },
  scripts: { title: "Package scripts", description: "Scripts declared in package manifests, with what each one checks (never run)" },
};

/**
 * A table that several categories share. Its columns carry their categories'
 * states, and the first column of each further category holds that
 * category's anchor. A category with no facts adds no column of identical
 * placeholders: one line above the table says what its search found. How each
 * category was searched sits in one disclosure, since the states say whether
 * to look.
 */
export function SharedTable({ block, context, filters, pagination }: { block: SharedBlock; context: EvidenceContext; filters?: React.ReactNode; pagination?: React.ReactNode }) {
  const [first] = block.sources;
  const { title, description } = SHARED_TITLES[block.kind];
  const rows = block.groups.reduce((sum, group) => sum + group.rows.length, 0);
  const sourceOf = (category: string | null) => block.sources.find((source) => source.definition.id === category);
  const shown = block.columns.map((column, index) => ({ column, index })).filter(({ column }) => !column.category || sourceOf(column.category)!.facts > 0);
  const empty = block.sources.filter((source) => source.facts === 0);
  // The first source's anchor is the section; each other source's is its first column, or its line when it has none.
  const anchored = new Set<string>([first!.definition.id]);
  const anchorOf = (category: string | null) => {
    if (!category || anchored.has(category)) return undefined;
    anchored.add(category);
    return category;
  };
  return (
    <Section id={first!.definition.id} level={3} title={title} description={description}>
      {empty.length > 0 && (
        <ul className={styles.notes} aria-label={`Not shown in ${title}`}>
          {empty.map((source) => (
            <li key={source.definition.id} id={anchorOf(source.definition.id)}>
              <Status state={source.state} size="sm" />
              <span>
                <span className={styles.sourceLabel}>{`${source.definition.label} aren't shown.`}</span> <span className={styles.attentionReason}>{source.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Disclosure variant="plain" summary="How these were found">
        <ul className={styles.sources} aria-label={`Categories in ${title}`}>
          {block.sources.map((source) => (
            <li key={source.definition.id}>
              <span className={styles.sourceLabel}>{source.definition.label}</span>
              <Status state={source.state} size="sm" />
              <SearchLine heading={source} />
            </li>
          ))}
        </ul>
      </Disclosure>
      {filters}
      <div className={styles.anchoredTable}>
        <Panel flush>
          <Table
            label={title}
            head={
              <>
                {shown.map(({ column }) => (
                  <Th key={column.label} id={anchorOf(column.category)}>
                    <span className={styles.header}>
                      {column.label}
                      {column.category && <Status state={sourceOf(column.category)!.state} size="sm" />}
                    </span>
                  </Th>
                ))}
                <Th>Evidence</Th>
              </>
            }
          >
            {block.groups.map((group) => (
              <SharedGroup key={group.manifest ?? ""} kind={block.kind} manifest={group.manifest} total={group.total} rows={group.rows} columns={shown.map(({ column, index }) => ({ label: column.label, index }))} context={context} />
            ))}
            {rows === 0 && (
              <tr>
                <Td span={shown.length + 1}>
                  <span className={styles.muted}>No row matches the filters.</span>
                </Td>
              </tr>
            )}
          </Table>
        </Panel>
      </div>
      {pagination}
    </Section>
  );
}

function SharedGroup({ kind, manifest, total, rows, columns, context }: { kind: SharedBlock["kind"]; manifest: string | null; total?: number; rows: readonly SharedRow[]; columns: readonly { label: string; index: number }[]; context: EvidenceContext }) {
  if (!rows.length) return null;
  const label = manifest ?? (kind === "dependencies" ? "Other packages consumed" : "Other declared commands");
  return (
    <>
      <tr className={styles.groupRow}>
        <Td span={columns.length + 1}>
          <span className={manifest ? styles.mono : undefined}>{label}</span> <span className={styles.count}>{`(${total ?? rows.length})`}</span>
        </Td>
      </tr>
      {rows.map((row) => (
        <tr key={row.id}>
          {columns.map(({ label: column, index }) => (
            <Td key={column} label={column}>
              <SharedCellView cell={row.cells[index]!} />
            </Td>
          ))}
          <Td label="Evidence">
            <RowDetails title={row.manifest ? `${row.name} · ${row.manifest}` : row.name} held={row.held} evidence={row.evidence} context={context} />
          </Td>
        </tr>
      ))}
    </>
  );
}

function SharedCellView({ cell }: { cell: SharedCell }) {
  if (cell.kind === "none") return <NoValuePlaceholder value={cell.value} />;
  if (cell.kind === "whole") return <span>{cell.text}</span>;
  return (
    <>
      <CellView cell={cell.cell} />
      {cell.state && <Status state={cell.state} size="sm" />}
    </>
  );
}

/** The categories of a group that have no facts: one compact row each, with its state and reason. */
export function CompactList({ block }: { block: CompactBlock }) {
  return (
    <Panel flush>
      <ul className={styles.compact} aria-label={`${block.group} categories without facts`}>
        {block.items.map(({ definition, value }) => (
          <li key={definition.id} id={definition.id} className={styles.compactRow}>
            <div className={styles.compactName}>
              <Primary>{definition.label}</Primary>
              <Secondary>{value.reason}</Secondary>
            </div>
            <Status state={value.state} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
