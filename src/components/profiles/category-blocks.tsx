import type { JsonObject } from "@repo-facts/contract";
import { Fragment } from "react";
import { EvidenceList } from "@/components/results/evidence";
import { NoValuePlaceholder } from "@/components/results/no-value";
import { countLabel, formatNumber } from "@/components/ui/count";
import { Disclosure } from "@/components/ui/disclosure";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Status, statusLabel } from "@/components/ui/status";
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import type { CandidateCells, Cell, CellItem } from "@/lib/profiles/layouts";
import { reasoningLead } from "@/lib/profiles/reasoning";
import type { CategoryBlock, CompactBlock, Heading, Row, SharedBlock, SharedCell, SharedRow } from "@/lib/profiles/view";
import { EvidencePanel } from "./evidence-panel";
import styles from "./profile.module.css";

/**
 * A detector's category description in the interface's words: detectors
 * describe what they read as "source-visible", and the interface never names
 * a Source, so the phrase reads as "visible in source".
 */
function inVocabulary(text: string): string {
  return text.replace(/\bSource-visible\b/g, "Visible in source").replace(/\bsource-visible\b/g, "visible in source");
}

/** What a cell needs to link evidence: the records, and the Run they belong to. */
export interface EvidenceContext {
  records: JsonObject;
  assessmentId: string;
  /** The Profile, whose rows' evidence panels load from it. */
  profileId: string;
}

/** A row's evidence panel, which loads the row's facts and locations when it's opened. */
function RowEvidence({ table, row, title, context }: { table: string; row: { id: string; evidence: readonly string[] }; title: string; context: EvidenceContext }) {
  const url = `/api/profiles/${context.profileId}/evidence?${new URLSearchParams({ table, row: row.id })}`;
  return <EvidencePanel url={url} title={title} count={row.evidence.length} first={row.evidence[0] ?? null} assessmentId={context.assessmentId} />;
}

/** A category with facts: its heading, its search and rule, and its facts in its own columns, a page at a time when there are many. */
export function CategoryTable({ block, context, pagination }: { block: CategoryBlock; context: EvidenceContext; pagination?: React.ReactNode }) {
  const { definition } = block.heading;
  const span = block.columns.length + (block.stepsColumn ? 1 : 0);
  return (
    <Section id={definition.id} level={3} title={definition.label} description={inVocabulary(definition.description)} actions={<Status state={block.heading.state} />}>
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
            {block.rows.map((row) =>
              row.cells.kind === "candidates" && row.cells.candidates.every((candidate) => candidate.cells) ? (
                <CandidateRows key={row.id} table={definition.id} row={row} candidates={row.cells.candidates} block={block} span={span} context={context} />
              ) : (
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
                    <RowEvidence table={definition.id} row={row} title={row.cells.kind === "cells" ? (row.cells.cells[0]?.text ?? row.id) : row.id} context={context} />
                  </Td>
                </tr>
              ),
            )}
          </Table>
        </Panel>
      </div>
      {pagination}
    </Section>
  );
}

function RowCellsView({ row, columns, numeric, unit, span, context }: { row: Row; columns: readonly string[]; numeric: readonly boolean[]; unit: string; span: number; context: EvidenceContext }) {
  const state = row.state && <Status state={row.state} size="sm" />;
  // A long reasoning shows its statement here, and its examples in the row's evidence panel.
  const reasoning = row.reasoning && <Secondary>{reasoningLead(row.reasoning)}</Secondary>;
  if (row.cells.kind === "whole") {
    return (
      <Td label="Value" span={span}>
        <span className={styles.breakable}>{row.cells.text}</span> {state}
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

/**
 * A conflict whose candidates fit the category's columns: a group row with
 * its state and its evidence, then one row per candidate in the columns, each
 * with its own location, so the candidates compare side by side.
 */
function CandidateRows({ table, row, candidates, block, span, context }: { table: string; row: Row; candidates: readonly CandidateCells[]; block: CategoryBlock; span: number; context: EvidenceContext }) {
  return (
    <>
      <tr className={styles.groupRow}>
        <Td span={span}>
          <Status state="conflicting" size="sm">
            <span>{statusLabel("conflicting")}</span>
            <span className={styles.count}>{`${countLabel(candidates.length, "candidate")} disagree`}</span>
          </Status>
        </Td>
        <Td label="Evidence" align="actions">
          <RowEvidence table={table} row={row} title={candidates[0]?.cells?.[0]?.text ?? row.id} context={context} />
        </Td>
      </tr>
      {candidates.map((candidate, index) => (
        <tr key={index}>
          {candidate.cells!.map((cell, column) => (
            <Td key={block.columns[column]} label={block.columns[column]} align={block.numeric[column] ? "numeric" : undefined}>
              {cell ? <CellView cell={cell} /> : null}
              {column === 0 && (
                <div className={styles.candidateLocation}>
                  <EvidenceList ids={candidate.evidence} records={context.records} assessmentId={context.assessmentId} source={false} />
                </div>
              )}
            </Td>
          ))}
          {/* The group row holds the evidence; these cells keep the columns, unlabeled, so a stacked row doesn't name an empty one. */}
          {block.stepsColumn && <Td />}
          <Td align="actions" />
        </tr>
      ))}
    </>
  );
}

/** How many of a cell's entries show before the rest move into a disclosure; one more never hides alone. */
const ITEMS_SHOWN = 5;

function CellView({ cell }: { cell: Cell }) {
  const items = cell.items ?? [];
  const shown = items.length > ITEMS_SHOWN + 1 ? items.slice(0, ITEMS_SHOWN) : items;
  const rest = items.slice(shown.length);
  return (
    <>
      {cell.text && <span className={[cell.mono && styles.mono, cell.muted && styles.muted, cell.nowrap && styles.nowrap, cell.breakable && styles.breakable].filter(Boolean).join(" ") || undefined}>{cell.text}</span>}
      {cell.secondary && <Secondary>{cell.secondary}</Secondary>}
      {shown.length > 0 && <CellItems items={shown} muted={cell.muted} />}
      {rest.length > 0 && (
        <div className={styles.quiet}>
          <Disclosure variant="plain" summary={`${rest.length} more`}>
            <CellItems items={rest} muted={cell.muted} />
          </Disclosure>
        </div>
      )}
    </>
  );
}

/**
 * A cell's entries, one per line, each with its secondary text beside it. A
 * name such as a module path breaks after a slash rather than anywhere, so a
 * column of them keeps a readable width without a minimum of its own.
 */
function CellItems({ items, muted }: { items: readonly CellItem[]; muted?: boolean }) {
  return (
    <ul className={muted ? `${styles.items} ${styles.muted}` : styles.items}>
      {items.map((item, index) => (
        <li key={index}>
          <span className={item.mono ? styles.itemName : undefined}>
            {item.mono
              ? item.text.split(/(?<=\/)/).map((part, at) => (
                  <Fragment key={at}>
                    {at > 0 && <wbr />}
                    {part}
                  </Fragment>
                ))
              : item.text}
          </span>
          {item.secondary && <span className={styles.itemSecondary}>{item.secondary}</span>}
        </li>
      ))}
    </ul>
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
          {surface.length > INPUTS_SHOWN && <li className={styles.muted}>{`and ${formatNumber(surface.length - INPUTS_SHOWN)} more`}</li>}
        </ul>
      )}
    </div>
  );
}

/** A category's search, as every category shows it: the one-line summary, then its rules and inputs one disclosure away. */
function SearchLine({ heading }: { heading: Heading }) {
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
              <Status state={source.state} size="sm">
                <span>{statusLabel(source.state)}</span>
                <span className={styles.sourceLabel}>{`${source.definition.label} aren't shown.`}</span>
                <span className={styles.attentionReason}>{source.reason}</span>
              </Status>
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
            <RowEvidence table={kind} row={row} title={row.manifest ? `${row.name} · ${row.manifest}` : row.name} context={context} />
          </Td>
        </tr>
      ))}
    </>
  );
}

function SharedCellView({ cell }: { cell: SharedCell }) {
  if (cell.kind === "none") return <NoValuePlaceholder value={cell.value} />;
  if (cell.kind === "whole") return <span className={styles.breakable}>{cell.text}</span>;
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
    <Section id={definition.id} level={3} title={definition.label} description={inVocabulary(definition.description)} actions={<Status state={value.state} />}>
      <p className={styles.search}>{value.reason}</p>
    </Section>
  );
}
