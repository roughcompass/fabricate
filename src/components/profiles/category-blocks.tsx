import type { JsonObject, JsonValue } from "@repo-facts/contract";
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
import { Secondary, Table, Td, Th } from "@/components/ui/table";
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
      <div className={styles.dataTable}>
        <Panel flush>
          <Table
            label={definition.label}
            head={
              <>
                {block.columns.map((column, index) => (
                  <Th key={column} align={block.numeric[index] ? "numeric" : undefined}>
                    {column}
                  </Th>
                ))}
                {block.stepsColumn && <Th>{block.stepsColumn}</Th>}
                <Th align="actions">Evidence</Th>
              </>
            }
          >
            {block.rows.map((row) => (
              <tr key={row.id}>
                <RowCellsView row={row} columns={block.columns} numeric={block.numeric} unit={block.unit} span={span} context={context} />
                {block.stepsColumn && row.cells.kind === "cells" && (
                  <Td label={block.stepsColumn}>
                    {row.steps.length ? (
                      // The count and what the steps check, with the steps themselves one click away.
                      <div className={styles.quiet}>
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
                      </div>
                    ) : (
                      <span className={styles.muted}>None</span>
                    )}
                  </Td>
                )}
                <Td label="Evidence" align="actions">
                  <RowDetails title={row.cells.kind === "cells" ? (row.cells.cells[0]?.text ?? row.id) : row.id} held={row.held} evidence={row.evidence} context={context} reasoning={Boolean(row.reasoning && firstSentence(row.reasoning) !== row.reasoning)} />
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>
      {pagination}
    </Section>
  );
}

/** A reasoning's first sentence, or all of it when it's one sentence. */
function firstSentence(text: string): string {
  const end = text.search(/\.\s/);
  return end === -1 ? text : text.slice(0, end + 1);
}

function RowCellsView({ row, columns, numeric, unit, span, context }: { row: Row; columns: readonly string[]; numeric: readonly boolean[]; unit: string; span: number; context: EvidenceContext }) {
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
        <Td key={columns[index]} label={columns[index]} align={numeric[index] ? "numeric" : undefined}>
          {cell ? <CellView cell={cell} /> : null}
          {index === 0 && state}
          {index === 0 && reasoning}
          {index === 0 && row.occurrences > 1 && <Secondary>{countLabel(row.occurrences, unit)}</Secondary>}
        </Td>
      ))}
    </>
  );
}

export function CellView({ cell }: { cell: Cell }) {
  return (
    <>
      <span className={[cell.mono && styles.mono, cell.muted && styles.muted, cell.nowrap && styles.nowrap].filter(Boolean).join(" ") || undefined}>{cell.text}</span>
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
          <section className={styles.held}>
            <EvidenceBlock ids={[...evidence]} context={context} />
            <dl className={styles.heldFacts}>
              <dt>{held.length === 1 ? "Fact" : "Facts"}</dt>
              <dd>
                <span className={styles.mono}>{held.slice(0, MERGED_KEYS).map((entry) => entry.fact.key).join(", ")}</span>
                {held.length > MERGED_KEYS && <span className={styles.muted}>{` and ${held.length - MERGED_KEYS} more, each with this value`}</span>}
              </dd>
            </dl>
            <RawValue factKey={held[0]!.fact.key} value={held[0]!.fact.value} />
          </section>
        ) : (
          held.map((entry) => (
            <section key={`${entry.category}:${entry.fact.key}`} className={styles.held} aria-label={held.length > 1 ? (context.labels.get(entry.category) ?? entry.category) : undefined}>
              {held.length > 1 && <h3 className={styles.heldLabel}>{context.labels.get(entry.category) ?? entry.category}</h3>}
              <EvidenceBlock ids={entry.fact.evidence} context={context} />
              <dl className={styles.heldFacts}>
                <dt>Fact</dt>
                <dd className={styles.mono}>{entry.fact.key}</dd>
                {entry.rule && (
                  <>
                    <dt>Rule</dt>
                    <dd className={styles.mono}>{entry.rule}</dd>
                  </>
                )}
                {reasoning && entry.fact.reasoning && (
                  <>
                    <dt>Why</dt>
                    <dd>{entry.fact.reasoning}</dd>
                  </>
                )}
              </dl>
              <RawValue factKey={entry.fact.key} value={entry.fact.value} />
            </section>
          ))
        )}
      </div>
    </>
  );
}

/** A fact's locations under a label, each a link to its evidence record. */
function EvidenceBlock({ ids, context }: { ids: readonly string[]; context: EvidenceContext }) {
  return (
    <div className={styles.heldPart}>
      <span className={styles.heldPartLabel}>{ids.length === 1 ? "Location" : `${ids.length.toLocaleString("en-US")} locations`}</span>
      <EvidenceList ids={ids} records={context.records} assessmentId={context.assessmentId} source={false} />
    </div>
  );
}

/** A fact's value as the document stores it, one disclosure away, in a block that scrolls rather than widening the panel. */
function RawValue({ factKey, value }: { factKey: string; value: JsonValue }) {
  return (
    <div className={styles.quiet}>
      <Disclosure variant="plain" summary="Raw value">
        <pre className={styles.raw} aria-label={`Raw value of ${factKey}`}>
          {JSON.stringify(value, null, 2)}
        </pre>
      </Disclosure>
    </div>
  );
}

/** How many inputs searched before listing them stops, so a large repository's list stays short. */
const INPUTS_SHOWN = 100;

/** How far a category's search went, in one line: "Searched 40 inputs · complete". */
function searchSummary(heading: Heading): string | null {
  const { search } = heading;
  if (!search) return null;
  const outcome = search.skipped.length ? `${countLabel(search.skipped.length, "input")} skipped${heading.facts ? ", so this is partial" : ""}` : search.complete ? "complete" : "incomplete";
  return search.surface.length ? `Searched ${countLabel(search.surface.length, "input")} · ${outcome}` : `Search ${outcome}`;
}

/** The rules a category's facts came from and the inputs it searched, the same way for every category. */
function SearchDetails({ heading }: { heading: Heading }) {
  const { search, rules } = heading;
  const surface = search?.surface ?? [];
  return (
    <div className={styles.searchDetails}>
      {rules.length > 0 && (
        <p className={styles.searchPart}>
          {rules.length === 1 ? "Rule " : "Rules "}
          <code>{rules.join(", ")}</code>
        </p>
      )}
      {surface.length > 0 && (
        <ul className={`${styles.inputs} ${styles.mono}`} aria-label="Inputs searched">
          {surface.slice(0, INPUTS_SHOWN).map((path) => (
            <li key={path}>{path || "(repository)"}</li>
          ))}
          {surface.length > INPUTS_SHOWN && <li className={styles.muted}>{`and ${(surface.length - INPUTS_SHOWN).toLocaleString("en-US")} more`}</li>}
        </ul>
      )}
    </div>
  );
}

/** A category's search, as every category shows it: the one-line summary, then its rules and inputs one disclosure away. */
export function SearchLine({ heading }: { heading: Heading }) {
  const summary = searchSummary(heading);
  if (!summary) return null;
  return (
    <div className={styles.search}>
      <span>{summary}</span>
      {(heading.rules.length > 0 || (heading.search?.surface.length ?? 0) > 0) && (
        <Disclosure variant="plain" summary="How this was found">
          <SearchDetails heading={heading} />
        </Disclosure>
      )}
    </div>
  );
}

export const SHARED_TITLES: Record<SharedBlock["kind"], { title: string; description: string }> = {
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
export function SharedTable({ block, context, filters, pagination, level = 3 }: { block: SharedBlock; context: EvidenceContext; filters?: React.ReactNode; pagination?: React.ReactNode; level?: 2 | 3 }) {
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
    <Section id={first!.definition.id} level={level} title={title} description={description} actions={<Status state={first!.state} />}>
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
      <div className={styles.search}>
        <span>{block.sources.map((source) => searchSummary(source)).filter(Boolean)[0]}</span>
        <Disclosure variant="plain" summary="How these were found">
          <ul className={styles.sources} aria-label={`Categories in ${title}`}>
            {block.sources.map((source) => (
              <li key={source.definition.id}>
                <span className={styles.sourceHeading}>
                  <span className={styles.sourceLabel}>{source.definition.label}</span>
                  <Status state={source.state} size="sm" />
                  <span>{searchSummary(source)}</span>
                </span>
                <SearchDetails heading={source} />
              </li>
            ))}
          </ul>
        </Disclosure>
      </div>
      {filters}
      <div className={`${styles.anchoredTable} ${styles.dataTable}`}>
        <Panel flush>
          <Table
            label={title}
            head={
              <>
                {shown.map(({ column }) => (
                  <Th key={column.label} id={anchorOf(column.category)}>
                    <span className={styles.header}>
                      {column.label}
                      {/* The table's own state is in its heading; a column from another category shows that category's. */}
                      {column.category && column.category !== first!.definition.id && <Status state={sourceOf(column.category)!.state} size="sm" />}
                    </span>
                  </Th>
                ))}
                <Th align="actions">Evidence</Th>
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
          <Td label="Evidence" align="actions">
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

/**
 * A category with no facts, headed like every other category: its title,
 * description, and state, then why it has none in one line where a table
 * would be.
 */
export function EmptyCategory({ definition, value }: { definition: CompactBlock["items"][number]["definition"]; value: CompactBlock["items"][number]["value"] }) {
  return (
    <Section id={definition.id} level={3} title={definition.label} description={definition.description} actions={<Status state={value.state} />}>
      <p className={styles.search}>{value.reason}</p>
    </Section>
  );
}
