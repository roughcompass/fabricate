import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ButtonLink, Button } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-content";
import { CodeBlock } from "@/components/ui/code-block";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { FilterRail } from "@/components/ui/filter-rail";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Checkbox, ChoiceGroup, FormFooter, FormSection, Select, TextArea, TextInput } from "@/components/ui/form";
import { MediaCard } from "@/components/ui/media-card";
import { Menu, MenuAction, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { type Outcome, OutcomeToast, param } from "@/components/ui/outcome-toast";
import { PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RelativeTime } from "@/components/ui/relative-time";
import { SearchField } from "@/components/ui/search-field";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { StatGroup } from "@/components/ui/stat-group";
import { Severity, Status } from "@/components/ui/status";
import { EmptyRow, Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { ShortValue, Tag, TagList } from "@/components/ui/tag";
import { Tooltip } from "@/components/ui/tooltip";
import { confirmDemo, noopDemo, validateDemo } from "./actions";
import { AlertDemo, FocusDemo, IndeterminateCheckbox, InjectedError, ToastDemo } from "./demos";
import { Row, Specimen } from "./specimen";
import styles from "./design-system.module.css";

export const metadata: Metadata = { title: "Design system" };

const DIGEST = "4807ba9e52ea3f1c9d0b7a6e5f4c3b2a1908f7e6d5c4b3a291807f6e5d4c3b2a";
const HOUR = 3_600_000;

/** A sample time relative to the request, for the relative-time specimens. */
function ago(milliseconds: number): Date {
  return new Date(Date.now() - milliseconds);
}

const OUTCOMES: Record<string, Omit<Outcome, "id">> = {
  demo: { tone: "success", title: "The demo action finished." },
  confirmed: { tone: "success", title: "The confirmed action ran." },
};

/**
 * Every shared component in every variant and state, in both themes. Available
 * in development and test environments only.
 */
export default async function DesignSystemPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const tone = param(query, "tone") ?? "";
  const kinds = [query.kind].flat().filter((value): value is string => typeof value === "string");
  const code = param(query, "notice");
  const outcome = code && Object.hasOwn(OUTCOMES, code) ? { id: code, ...OUTCOMES[code]! } : undefined;

  const sections: [id: string, title: string][] = [
    ["buttons", "Buttons"],
    ["form-controls", "Form controls"],
    ["search-field", "Search field"],
    ["status", "Status and severity"],
    ["tags", "Tags and copy"],
    ["sections", "Section and panel"],
    ["description-list", "Description list"],
    ["stat-group", "Stat group"],
    ["media-card", "Media card"],
    ["empty-state", "Empty state"],
    ["disclosure", "Disclosure"],
    ["code-block", "Code block"],
    ["table", "Table"],
    ["tabs", "Tabs and breadcrumbs"],
    ["menu", "Menu"],
    ["tooltip", "Tooltip and relative time"],
    ["progress", "Progress and skeleton"],
    ["filter-bar", "Filter bar"],
    ["filter-rail", "Filter rail"],
    ["feedback", "Toast"],
    ["alert", "Alert"],
    ["dialog", "Confirmation dialog"],
    ["form-feedback", "Form feedback"],
    ["page-header", "Page header"],
  ];

  return (
    <div className={styles.gallery}>
      <PageHeader
        title="Design system"
        description="Every shared component in its variants and states, in the light and dark themes. docs/design-system.md describes when to use each one."
        alerts={<OutcomeToast outcome={outcome} />}
      />
      <ul className={styles.index} aria-label="Components">
        {sections.map(([id, title]) => (
          <li key={id}>
            <a href={`#${id}`}>{title}</a>
          </li>
        ))}
      </ul>
      {param(query, "inject") === "pageerror" && <InjectedError />}

      <Specimen
        id="buttons"
        title="Buttons"
        description="Primary for the one main action, secondary for others, tertiary for quiet actions, and danger only to confirm a destructive action."
        render={(theme) => (
          <>
            <Row label="Variants">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="tertiary">Tertiary</Button>
              <Button variant="danger">Danger</Button>
            </Row>
            <Row label="Sizes">
              <Button size="sm" data-size-sample={theme === "light" ? "sm" : undefined}>
                Small
              </Button>
              <Button data-size-sample={theme === "light" ? "md" : undefined}>Medium</Button>
              <Button size="lg">Large</Button>
            </Row>
            <Row label="With icons">
              <Button variant="primary" icon="plus">
                New Initiative
              </Button>
              <ButtonLink href="#buttons" icon="edit">
                Edit
              </ButtonLink>
              <Button icon="more" label="More actions" size="sm" />
              <Button icon="copy" label="Copy" variant="tertiary" />
            </Row>
            <Row label="States">
              <Button disabled>Disabled</Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
              <button type="button" className={buttonClass("primary")} data-pending aria-busy>
                Pending
              </button>
              <button type="button" className={buttonClass("secondary")} data-pending aria-busy>
                Pending
              </button>
            </Row>
          </>
        )}
      />

      <Specimen
        id="form-controls"
        title="Form controls"
        description="Label, control, then description or error. Every control shares one boundary, fill, and focus ring."
        render={(theme) => (
          <div className={styles.stack}>
            <FormSection title="Section" description="A titled group of fields.">
              <TextInput id={`${theme}-name`} label="Name" description="A display name." defaultValue="orders" />
              <TextInput id={`${theme}-url`} label="Clone URL" mono placeholder="https://git.example.com/acme/orders.git" />
              <TextInput id={`${theme}-invalid`} label="Reference" optional mono defaultValue="--upload-pack" errors={["A reference cannot start with a hyphen."]} />
              <TextInput id={`${theme}-disabled`} label="Disabled" disabled defaultValue="Cannot change" />
              <TextArea id={`${theme}-objective`} label="Objective" optional rows={2} defaultValue="Assess the fleet" />
              <Select
                id={`${theme}-severity`}
                label="Severity"
                defaultValue="medium"
                options={[
                  { value: "critical", label: "Critical" },
                  { value: "medium", label: "Medium" },
                ]}
              />
              <Select id={`${theme}-small`} label="Small select" size="sm" options={[{ value: "", label: "Any outcome" }]} />
            </FormSection>
            <Row label="Check boxes">
              <Checkbox id={`${theme}-check`} label="Checked" defaultChecked />
              <Checkbox id={`${theme}-uncheck`} label="Unchecked" />
              <IndeterminateCheckbox id={`${theme}-indeterminate`} />
              <Checkbox id={`${theme}-check-disabled`} label="Disabled" disabled defaultChecked />
            </Row>
            <ChoiceGroup
              id={`${theme}-scope`}
              name={`${theme}-scope`}
              legend="Repository scope"
              type="radio"
              columns
              selected={["all_enabled"]}
              choices={[
                { value: "all_enabled", label: "All enabled Sources", description: "Every Source enabled when an Assessment starts." },
                { value: "explicit", label: "Selected Sources", description: "Exactly the Sources chosen below." },
              ]}
            />
            <ChoiceGroup
              id={`${theme}-releases`}
              name={`${theme}-releases`}
              legend="Standard Releases"
              type="checkbox"
              optional
              selected={["one"]}
              errors={theme === "light" ? undefined : ["Choose at least one Release."]}
              choices={[
                { value: "one", label: "Engineering baseline v2", description: "5 Controls" },
                { value: "two", label: "Service readiness v1", description: "3 Controls" },
                { value: "three", label: "Unavailable", description: "Not published", disabled: true },
              ]}
            />
            <FormFooter>
              <Button>Cancel</Button>
              <Button variant="primary">Save changes</Button>
            </FormFooter>
          </div>
        )}
      />

      <Specimen
        id="search-field"
        title="Search field"
        description="A search icon, the input, and a clear control while it has a value. It submits with its form, so it works without JavaScript."
        render={(theme) => (
          <div className={styles.stack}>
            <SearchField id={`${theme}-search-sm`} label="Small" size="sm" placeholder="Search by name or clone URL" />
            <SearchField id={`${theme}-search-md`} label="Medium" placeholder="Search templates" defaultValue="onboarding" clearHref="/design-system#search-field" />
            <SearchField id={`${theme}-search-lg`} label="Large" size="lg" placeholder="Search templates" description="Matches titles, descriptions, tags, and authors." />
            <SearchField id={`${theme}-search-disabled`} label="Disabled" disabled defaultValue="Cannot change" />
          </div>
        )}
      />

      <Specimen
        id="status"
        title="Status and severity"
        description="A colored dot and a label, never color alone. In-progress states pulse."
        render={() => (
          <>
            <Row label="Tones">
              <Status state="queued" />
              <Status state="analyzing" />
              <Status state="complete" />
              <Status state="complete_with_issues" />
              <Status state="failed" />
              <Status state="canceling" />
            </Row>
            <Row label="Outcomes">
              <Status state="meets" />
              <Status state="gap" />
              <Status state="indeterminate" />
              <Status state="not_applicable" />
            </Row>
            <Row label="Severity">
              <Severity value="critical" />
              <Severity value="high" />
              <Severity value="medium" />
              <Severity value="low" />
              <Severity value="info" />
            </Row>
          </>
        )}
      />

      <Specimen
        id="tags"
        title="Tags and copy"
        description="Identifiers, digests, commits, and URLs in the monospace face; long values are shortened with the whole value on hover and in the copy control."
        render={(theme) => (
          <>
            <Row label="Tags">
              <Tag>ini_hwfgmbqcnlhcyfs2</Tag>
              <Tag copy label="clone URL">
                https://git.example.com/acme/orders.git
              </Tag>
              <span data-copy-sample={theme === "light" ? "" : undefined}>
                <ShortValue value={DIGEST} label="digest" />
              </span>
            </Row>
            <Row label="Tag list">
              <TagList values={["Engineering baseline v1", "Service readiness v1"]} />
              <TagList values={[]} />
            </Row>
            <Row label="Copy button">
              <CopyButton value="asm_g81g3vozhwqqr8cu" label="Copy ID" />
            </Row>
          </>
        )}
      />

      <Specimen
        id="sections"
        title="Section and panel"
        description="Sections separate a page with headings and spacing. Panels are bordered containers for tables, forms, lists, and code, and never nest."
        render={() => (
          <>
            <Section title="Section heading" description="One sentence at most." actions={<Button size="sm">Action</Button>}>
              <p>Section content has no border of its own.</p>
            </Section>
            <Panel title="Panel" description="With a header, a body, and a footer." actions={<Button size="sm">Action</Button>} footer={<Button size="sm" variant="primary">Save changes</Button>}>
              <p>Panel content.</p>
            </Panel>
            <Panel title="Danger zone" tone="danger" footer={<Button size="sm" variant="danger" icon="trash">Delete Initiative</Button>}>
              <p>Only Initiatives without Assessments can be deleted.</p>
            </Panel>
          </>
        )}
      />

      <Specimen
        id="description-list"
        title="Description list"
        description="Rows put each term beside its value; columns put terms above values, for overviews."
        render={() => (
          <>
            <DescriptionList
              items={[
                ["Repositories", "6 selected Sources"],
                ["Commit", <ShortValue key="commit" value={DIGEST} label="commit" />],
                ["Finished", null],
              ]}
            />
            <DescriptionList
              layout="columns"
              items={[
                ["Scope", "6 Sources"],
                ["Detector release", <Tag key="release">0.1.0</Tag>],
                ["Started", <RelativeTime key="started" value={ago(2 * HOUR)} />],
              ]}
            />
          </>
        )}
      />

      <Specimen
        id="stat-group"
        title="Stat group"
        description="Key figures in one row, divided rather than boxed individually."
        render={() => (
          <StatGroup
            label="Outcomes"
            stats={[
              { label: "Gap", value: 16 },
              { label: "Indeterminate", value: 8 },
              { label: "Meets", value: 8, hint: "Across 2 Releases" },
              { label: "Relationship Map", value: "View", href: "#stat-group" },
            ]}
          />
        )}
      />

      <Specimen
        id="media-card"
        title="Media card"
        description="The title, two lines of description, and tags above an angled preview cropped by the card's edge. The title link covers the card."
        render={(theme) => (
          <div className={styles.cards}>
            <MediaCard
              title="Market watch"
              description="Follow instruments on a watchlist, chart prices, place orders, and track trades in J.P. Morgan Markets."
              image={{ src: "/demo/previews/placeholder-markets.svg", alt: "Preview of a markets portal" }}
              href={`/design-system?card=${theme}#media-card`}
              footer={
                <>
                  <Tag sans>Markets</Tag>
                  <Tag sans>DE Web</Tag>
                </>
              }
            />
            <MediaCard
              title="Unavailable card with a much longer title that wraps"
              description="Shown when a record cannot be opened. The description stays at two lines even when the text is long enough to need three or more lines to show in full."
              image={{ src: "/demo/previews/placeholder-other.svg", alt: "Preview of a workplace portal" }}
            />
          </div>
        )}
      />

      <Specimen
        id="empty-state"
        title="Empty state"
        description="A title, one sentence, and the action that fills the area."
        render={() => (
          <Panel flush>
            <EmptyState title="No Sources yet" icon="git" action={<Button variant="primary" icon="plus">Add Source</Button>}>
              Register a Git repository or import a local directory.
            </EmptyState>
          </Panel>
        )}
      />

      <Specimen
        id="disclosure"
        title="Disclosure"
        description="Content that expands in place, as a panel or as a quiet toggle for secondary details."
        render={() => (
          <>
            <Disclosure summary="Runs continuous integration" aside={<span>3 Gap · 2 Meets</span>} defaultOpen>
              <p>Six Findings, one per repository.</p>
            </Disclosure>
            <Disclosure summary="Details" variant="plain">
              <p>Detector release, digests, and IDs.</p>
            </Disclosure>
          </>
        )}
      />

      <Specimen
        id="code-block"
        title="Code block"
        description="Cited lines with their numbers and a copy control; long lines wrap."
        render={() => <CodeBlock label="package.json" firstLine={3} code={'  "name": "orders",\n  "version": "1.0.0",\n  "packageManager": "pnpm@9.12.0+sha512.a-very-long-integrity-string-that-wraps-rather-than-scrolls"'} />}
      />

      <Specimen
        id="table"
        title="Table"
        description="A quiet header, a linked primary cell, row actions in a menu that keeps rows one height, and stacked rows on narrow screens."
        render={(theme) => (
          <>
            <Panel flush>
              <Table
                label={`Sources, ${theme}`}
                head={
                  <>
                    <Th>Name</Th>
                    <Th>Status</Th>
                    <Th align="numeric">Assessments</Th>
                    <Th align="actions" hidden>
                      Actions
                    </Th>
                  </>
                }
              >
                <tr data-row-sample={theme === "light" ? "actions" : undefined}>
                  <Td label="Name">
                    <Primary>
                      <a href="#table">orders</a>
                    </Primary>
                    <Secondary mono>https://git.example.com/acme/orders.git</Secondary>
                  </Td>
                  <Td label="Status">
                    <Status state="enabled" />
                  </Td>
                  <Td label="Assessments" align="numeric">
                    3
                  </Td>
                  <Td align="actions">
                    <RowActions>
                      <Menu label="Actions for orders">
                        <MenuItem href="#table" icon="edit">
                          Edit
                        </MenuItem>
                        <MenuAction action={noopDemo}>Disable</MenuAction>
                      </Menu>
                    </RowActions>
                  </Td>
                </tr>
                <tr data-row-sample={theme === "light" ? "plain" : undefined}>
                  <Td label="Name">
                    <Primary>
                      <a href="#table">billing</a>
                    </Primary>
                    <Secondary mono>https://git.example.com/acme/billing.git</Secondary>
                  </Td>
                  <Td label="Status">
                    <Status state="disabled" />
                  </Td>
                  <Td label="Assessments" align="numeric">
                    0
                  </Td>
                  <Td align="actions" />
                </tr>
              </Table>
            </Panel>
            <Panel flush>
              <Table label={`Empty table, ${theme}`} head={<Th>Name</Th>}>
                <EmptyRow columns={1}>
                  <EmptyState title="No disabled Sources">Every Source is enabled.</EmptyState>
                </EmptyRow>
              </Table>
            </Panel>
            <Panel flush>
              <Table
                label={`Wide table, ${theme}`}
                scroll
                head={
                  <>
                    <Th>Release</Th>
                    {["Gap", "Indeterminate", "Meets", "Not applicable", "Total findings"].map((column) => (
                      <Th key={column} align="numeric">
                        {column}
                      </Th>
                    ))}
                    <Th align="actions" hidden>
                      Actions
                    </Th>
                  </>
                }
              >
                <tr>
                  <Td label="Release">
                    <Primary>Engineering baseline v1 with a deliberately long name</Primary>
                  </Td>
                  {([["Gap", 13], ["Indeterminate", 7], ["Meets", 5], ["Not applicable", 5], ["Total findings", 30]] as const).map(([column, count]) => (
                    <Td key={column} label={column} align="numeric">
                      {count}
                    </Td>
                  ))}
                  <Td align="actions">
                    <RowActions>
                      <Menu label={`Actions in a scrolling table, ${theme}`}>
                        <MenuItem href="#table">Open Release</MenuItem>
                        <MenuSeparator />
                        <MenuAction action={noopDemo} tone="danger" icon="trash">
                          Remove
                        </MenuAction>
                      </Menu>
                    </RowActions>
                  </Td>
                </tr>
              </Table>
            </Panel>
          </>
        )}
      />

      <Specimen
        id="tabs"
        title="Tabs and breadcrumbs"
        description="Tabs switch views of one page and show counts; a toggle group picks one of a few choices; breadcrumbs link a record's ancestors."
        render={() => (
          <>
            <Tabs label="Filter Sources">
              <TabLink href="#tabs" active count={7}>
                All
              </TabLink>
              <TabLink href="#tabs" active={false} count={6}>
                Enabled
              </TabLink>
              <TabLink href="#tabs" active={false} count={1}>
                Disabled
              </TabLink>
            </Tabs>
            <ToggleGroup
              action="/design-system"
              label="Device"
              name="device"
              selected="tablet"
              options={[
                { value: "mobile", label: "Mobile", icon: "smartphone" },
                { value: "tablet", label: "Tablet", icon: "tablet" },
                { value: "desktop", label: "Desktop", icon: "monitor" },
              ]}
            />
            <Breadcrumbs
              items={[
                { href: "#tabs", label: "Initiatives" },
                { href: "#tabs", label: "Checkout platform migration" },
                { href: "#tabs", label: "Assessment #1" },
              ]}
            />
          </>
        )}
      />

      <Specimen
        id="menu"
        title="Menu"
        description="Actions in a popover; it opens without JavaScript, closes on Escape, an outside click, or a choice."
        render={(theme) => (
          <Row label="Triggers">
            <Menu label={`Row actions, ${theme}`}>
              <MenuItem href="#menu" icon="edit">
                Edit
              </MenuItem>
              <MenuAction action={noopDemo}>Disable</MenuAction>
            </Menu>
            <Menu label={`More actions, ${theme}`} triggerText="More" variant="secondary" size="md" align="start">
              <MenuItem href="#menu">Import directory</MenuItem>
              <MenuItem href="#menu">Edit name and purpose</MenuItem>
            </Menu>
          </Row>
        )}
      />

      <Specimen
        id="tooltip"
        title="Tooltip and relative time"
        description="Tooltips appear on hover and keyboard focus. Times read relatively within a week, with the full UTC time in the tooltip."
        render={() => (
          <>
            <Row label="Tooltip">
              <Tooltip content="Explains the control">
                <Button size="sm">Hover or focus</Button>
              </Tooltip>
            </Row>
            <Row label="Relative time">
              <RelativeTime value={ago(90_000)} />
              <RelativeTime value={ago(3 * HOUR)} />
              <RelativeTime value={ago(30 * HOUR)} />
              <RelativeTime value={new Date("2025-08-26T09:30:00Z")} />
              <RelativeTime value={null} />
            </Row>
          </>
        )}
      />

      <Specimen
        id="progress"
        title="Progress and skeleton"
        description="Progress shows finished work out of the total; skeletons hold the layout while a page loads."
        render={() => (
          <>
            <ProgressBar value={3} max={6} label="3 of 6 repositories finished" />
            <div className={styles.stack}>
              <Skeleton width="short" height="title" />
              <Skeleton width="long" />
              <Skeleton height="control" />
            </div>
          </>
        )}
      />

      <Specimen
        id="filter-bar"
        title="Filter bar"
        description="Filters above their results; a change applies immediately, or with Apply when JavaScript is off."
        single
        render={() => (
          <div className={styles.stack}>
            <FilterBar key={tone} action="/design-system" label="Filter demo" filtered={Boolean(tone)} clearHref="/design-system#filter-bar">
              <Select
                id="filter-tone"
                name="tone"
                label="Tone"
                size="sm"
                defaultValue={tone}
                options={[
                  { value: "", label: "Any tone" },
                  { value: "success", label: "Success" },
                  { value: "error", label: "Error" },
                ]}
              />
            </FilterBar>
            <p role="status">{tone ? `Filtered to ${tone}` : "No filter"}</p>
          </div>
        )}
      />

      <Specimen
        id="filter-rail"
        title="Filter rail"
        description="A heading with Clear, collapsible groups that show how many options are checked, and tinted option rows with counts; a disclosure above the results on narrow screens."
        single
        render={() => (
          <div className={styles.railDemo}>
            <FilterRail
              key={kinds.join(",")}
              action="/design-system"
              label="Filter rail demo"
              title="Filter records"
              headingLevel={3}
              groups={[
                {
                  name: "kind",
                  legend: "Kind",
                  options: [
                    { value: "policy", label: "Policy", count: 4 },
                    { value: "plugin", label: "Plugin", count: 2 },
                    { value: "retired", label: "Retired", count: 0, disabled: true },
                  ],
                },
              ]}
              selected={{ kind: kinds }}
              activeCount={kinds.length}
              filtered={kinds.length > 0}
              clearHref="/design-system#filter-rail"
            />
            <p role="status">{kinds.length ? `Filtered to ${kinds.join(" and ")}` : "No filter"}</p>
          </div>
        )}
      />

      <Specimen
        id="feedback"
        title="Toast"
        description="The outcome of a completed action, once. Success and info dismiss themselves; warnings and errors stay until dismissed."
        single
        render={() => <ToastDemo />}
      />

      <Specimen
        id="alert"
        title="Alert"
        description="A condition of this record that needs attention, in the slot below the page header; one per condition."
        render={(theme) => (
          <>
            <Alert tone="warning" title="1 of 6 repositories could not be assessed">
              billing could not be reached. Its relationships are missing from the map, and Evaluations treat what it could contain as unknown.
            </Alert>
            <Alert tone="info" title="This is a historical Profile" actions={<Button size="sm">View the newest Profile</Button>}>
              A newer Profile of this repository exists.
            </Alert>
            <Alert tone="error" title="The Evaluation failed">
              The Release reads a Profile schema this Assessment does not have.
            </Alert>
            {theme === "light" && (
              <Row label="Raised by a client component">
                <AlertDemo />
              </Row>
            )}
          </>
        )}
      />

      <Specimen
        id="dialog"
        title="Confirmation dialog"
        description="Destructive and irreversible actions are confirmed in the interface: the action, its consequence once, Cancel, and the verb."
        single
        render={() => (
          <Row label="Triggers">
            <ConfirmDialog action={confirmDemo} trigger={{ label: "Cancel Assessment", icon: "slash" }} title="Cancel Assessment #3?" confirmLabel="Cancel Assessment" tone="danger">
              <p>Repositories that have not finished stop at their next check. Completed Profiles are kept.</p>
            </ConfirmDialog>
            <ConfirmDialog action={confirmDemo} trigger={{ label: "Publish v2", icon: "lock", variant: "primary" }} title="Publish Engineering baseline v2?" confirmLabel="Publish v2">
              <p>Release v2 will be published from draft version 7. A published Release can never be edited or deleted.</p>
            </ConfirmDialog>
          </Row>
        )}
      />

      <Specimen
        id="form-feedback"
        title="Form feedback"
        description="A rejected submission shows each field error once, under its field, and moves focus to the first invalid field or to the form alert."
        single
        render={() => (
          <div className={styles.narrow}>
            <FocusDemo action={validateDemo} />
          </div>
        )}
      />

      <Specimen
        id="page-header"
        title="Page header"
        description="Breadcrumbs, the title and status, a meta line, one sentence, and the actions: one primary, with secondary links in a menu on narrow screens."
        render={() => (
          <>
            <PageHeader
              alerts={false}
              headingLevel={3}
              breadcrumbs={[
                { href: "#page-header", label: "Initiatives" },
                { href: "#page-header", label: "Checkout platform migration" },
              ]}
              title="Assessment #3"
              status={<Status state="complete_with_issues" />}
              meta={[<span key="scope">6 Sources</span>, <RelativeTime key="started" value={ago(2 * HOUR)} />, <Tag key="release">0.1.0</Tag>]}
              description="Each repository is pinned to a commit and analyzed without running its code."
              secondaryActions={[{ href: "#page-header", label: "Edit", icon: "edit" }]}
              primaryAction={
                <Button variant="primary" icon="play">
                  Start Assessment
                </Button>
              }
            />
            <PageHeader
              alerts={false}
              headingLevel={3}
              title="Sources"
              secondaryActions={[{ href: "#page-header", label: "Import directory", icon: "folder" }]}
              primaryAction={
                <Button variant="primary" icon="plus">
                  New Source
                </Button>
              }
            />
          </>
        )}
      />
    </div>
  );
}
