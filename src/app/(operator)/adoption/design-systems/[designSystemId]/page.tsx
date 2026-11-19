import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalysisTemplate } from "@/components/templates/analysis-template";
import { BarChart, type BarSeries } from "@/components/ui/bar-chart";
import { countLabel, formatNumber } from "@/components/ui/count";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { SearchField } from "@/components/ui/search-field";
import { StatGroup } from "@/components/ui/stat-group";
import { EmptyRow, Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { buttonProps } from "@/components/ui/button-content";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { formatDate } from "@/components/ui/time";
import { type Coverage, designSystemCoverage } from "@/lib/adoption/fleet";
import { type ComponentUse, type DesignSystemAdoption, designSystemAdoption, packageAdoption, replaceableHtml, tokenUse } from "@/lib/adoption/queries";
import { compareSnapshots, latestSnapshot, snapshotsOf } from "@/lib/adoption/snapshots";
import type { TrackedDesignSystem } from "@/lib/adoption/tracked";
import { catalogConfiguration } from "@/lib/catalog/configuration";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { oneOf, pageNumber, pageQuery, param, searchTerm } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { CoverageAlert, RepositoryLinks, changeSince, describedDesignSystems, hint, publishedAsOf, shareCounts, shareLabel, thingName } from "../../shared";
import styles from "../../adoption.module.css";

const VIEWS = ["components", "html", "versions", "snapshots"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = { components: "Components", html: "Replaceable HTML", versions: "Versions", snapshots: "Snapshots" };

const USAGE_FILTERS = ["most", "rarely", "unused"] as const;
type UsageFilter = (typeof USAGE_FILTERS)[number];
const USAGE_LABELS: Record<UsageFilter, string> = { most: "Most used", rarely: "Rarely used", unused: "Unused" };

/** Rows per page of the components table. */
const PAGE_SIZE = 50;

/** App, stories, and tests, apart: data, so neutral, told apart by pattern. */
const SCOPES: BarSeries[] = [
  { id: "app", label: "App", tone: "neutral", pattern: "solid" },
  { id: "stories", label: "Stories", tone: "neutral", pattern: "stripes" },
  { id: "tests", label: "Tests", tone: "neutral", pattern: "dots" },
];

const described = (designSystemId: string) => catalogConfiguration(getConfig()).things.find((thing) => thing.kind === "design_system" && thing.id === designSystemId);

export async function generateMetadata({ params }: PageProps<"/adoption/design-systems/[designSystemId]">): Promise<Metadata> {
  const { designSystemId } = await params;
  const system = describedDesignSystems(getDb(), getConfig()).find(({ thing }) => thing.id === designSystemId);
  return { title: system ? `${system.tracked?.name ?? thingName(system.thing)} · Adoption` : "Design system not found" };
}

/**
 * A design system's adoption (adoption-analytics spec), on the Analysis
 * template: key figures with their change since the previous snapshot, then
 * one view at a time: its components, filtered by usage, with the most used
 * charted and a table that opens each component; the raw HTML its components
 * replace; the versions of its packages; and any two snapshots compared.
 */
export default async function DesignSystemAdoptionPage({ params, searchParams }: PageProps<"/adoption/design-systems/[designSystemId]">) {
  const [{ designSystemId }, query] = await Promise.all([params, searchParams]);
  const thing = described(designSystemId);
  if (!thing) notFound();
  const db = getDb();
  const config = getConfig();
  const tracked = describedDesignSystems(db, config).find((system) => system.thing.id === designSystemId)?.tracked;
  const coverage = designSystemCoverage(db);
  const view = oneOf(query, "view", VIEWS) ?? "components";
  const name = tracked?.name ?? thingName(thing);
  const base = (target: View) => routes.adoptionDesignSystem(designSystemId, { view: target === "components" ? null : target });

  if (!tracked) {
    return (
      <AnalysisTemplate
        header={{ breadcrumbs: [{ href: routes.adoption, label: "Adoption" }], title: name }}
        empty={{ title: "No Reference Catalog entry yet", icon: "clock", children: `${name}'s figures appear once an entry of a version Repositories use is built.` }}
      />
    );
  }

  const adoption = designSystemAdoption(db, coverage, tracked, { rarelyUsedPercentile: config.adoption.rarelyUsedPercentile });
  const tokens = tokenUse(coverage, designSystemId);
  const change = latestSnapshot(db, "design_system", designSystemId);
  const asOf = publishedAsOf(tracked);
  const header = {
    breadcrumbs: [{ href: routes.adoption, label: "Adoption" }],
    title: name,
    meta: [
      `Covers ${formatNumber(coverage.covered.length)} of ${countLabel(coverage.registered, "Repository", "Repositories")}`,
      `${name} ${tracked.entry.version} entry`,
      ...(asOf ? [`Published data as of ${asOf}`] : []),
    ],
    tabs: (
      <Tabs label={`${name} views`}>
        {VIEWS.map((target) => (
          <TabLink key={target} href={base(target)} active={view === target}>
            {VIEW_LABELS[target]}
          </TabLink>
        ))}
      </Tabs>
    ),
  };
  const figures = (
    <StatGroup
      label={`${name} adoption`}
      stats={[
        { label: "Components used", value: formatNumber(adoption.componentsUsed), hint: hint(`of ${formatNumber(adoption.componentsTracked)} tracked`, changeSince(change, "components_used")) },
        { label: "Usages in app code", value: formatNumber(adoption.usages.app), hint: hint(`${formatNumber(adoption.usages.stories)} in stories, ${formatNumber(adoption.usages.tests)} in tests`, changeSince(change, "usages")) },
        { label: "Repositories using it", value: formatNumber(adoption.repositories.length), hint: hint(`of ${formatNumber(coverage.covered.length)} covered`, changeSince(change, "repositories")) },
        { label: "Unused components", value: formatNumber(adoption.unused.length), href: routes.adoptionDesignSystem(designSystemId, { usage: "unused" }), hint: changeSince(change, "components_unused") },
        { label: "Token use", value: shareLabel(tokens), hint: shareCounts(tokens, "token-capable declarations") },
      ]}
    />
  );
  const alerts = <CoverageAlert coverage={coverage} />;

  if (view === "html") return <ReplaceableHtmlView header={header} alerts={alerts} figures={figures} tracked={tracked} coverage={coverage} />;
  if (view === "versions") return <VersionsView header={header} alerts={alerts} figures={figures} packages={[thing.package, thing.tokens, thing.icons].filter((item): item is string => Boolean(item))} />;
  if (view === "snapshots") return <SnapshotsView header={header} alerts={alerts} designSystemId={designSystemId} query={query} />;
  return <ComponentsView header={header} alerts={alerts} figures={figures} tracked={tracked} adoption={adoption} query={query} />;
}

type Header = React.ComponentProps<typeof AnalysisTemplate>["header"];
type Query = Record<string, string | string[] | undefined>;

/** The components, filtered by usage and name, the most used charted, and a table whose rows open each component. */
function ComponentsView({ header, alerts, figures, tracked, adoption, query }: { header: Header; alerts: React.ReactNode; figures: React.ReactNode; tracked: TrackedDesignSystem; adoption: DesignSystemAdoption; query: Query }) {
  const usage = oneOf(query, "usage", USAGE_FILTERS) ?? null;
  const search = searchTerm(query);
  const listed = usage === "most" ? adoption.mostUsed : usage === "rarely" ? adoption.rarelyUsed : usage === "unused" ? adoption.unused : adoption.components;
  const matching = search ? listed.filter((component) => component.name.toLowerCase().includes(search.toLowerCase())) : listed;
  const { page, pages } = pageNumber(param(query, "page"), matching.length, PAGE_SIZE);
  const shown = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const href = (filters: { usage?: UsageFilter | null; q?: string; page?: number }) => routes.adoptionDesignSystem(tracked.id, { usage: filters.usage, q: filters.q, page: pageQuery(filters.page ?? 1) });
  const applied = [usage && USAGE_LABELS[usage].toLowerCase(), search && `named like “${search}”`].filter(Boolean).join(", ");
  return (
    <AnalysisTemplate
      header={header}
      alerts={alerts}
      figures={figures}
      filters={
        <>
          <FilterBar key={`${usage}:${search}`} action={routes.adoptionDesignSystem(tracked.id)} label="Filter components" filtered={Boolean(usage || search)} clearHref={href({})}>
            <Select id="usage-filter" name="usage" label="Usage" hideLabel size="sm" defaultValue={usage ?? ""} options={[{ value: "", label: "All components" }, ...USAGE_FILTERS.map((value) => ({ value, label: USAGE_LABELS[value] }))]} />
            <SearchField id="component-search" name="q" label="Search components" hideLabel size="sm" placeholder="Search by name" defaultValue={search} clearHref={href({ usage })} />
          </FilterBar>
          <p className={styles.muted} role="status">
            {`Showing ${countLabel(matching.length, "component")}${applied ? `, ${applied}` : ""}, of ${formatNumber(adoption.components.length)}.`}
          </p>
        </>
      }
      chart={
        <Panel title="Most used" description="Usages of the ten most used components, by where they're used.">
          <BarChart
            id="most-used"
            label={`Usages of the most used ${tracked.name} components`}
            groupLabel="Component"
            series={SCOPES}
            groups={adoption.mostUsed.map((component) => ({ label: component.name, values: { ...component.usages } }))}
            empty="No component is used in app code yet."
          />
        </Panel>
      }
    >
      <Panel flush>
        <ComponentsTable designSystemId={tracked.id} components={shown} />
      </Panel>
      <Pagination label="Component pages" page={page} pages={pages} href={(number) => href({ usage, q: search, page: number })} />
    </AnalysisTemplate>
  );
}

function ComponentsTable({ designSystemId, components }: { designSystemId: string; components: readonly ComponentUse[] }) {
  return (
    <Table
      label="Components"
      head={
        <>
          <Th>Component</Th>
          <Th align="numeric">Repositories</Th>
          <Th align="numeric">App</Th>
          <Th align="numeric">Stories</Th>
          <Th align="numeric">Tests</Th>
          <Th align="numeric">Customized</Th>
        </>
      }
    >
      {components.length === 0 && <EmptyRow columns={6}>No component matches.</EmptyRow>}
      {components.map((component) => (
        <tr key={component.name}>
          <Td label="Component">
            <Primary>
              <Link href={routes.adoptionComponent(designSystemId, component.name)}>{component.name}</Link>
            </Primary>
            {!component.tracked && <Secondary>Not in the current entry</Secondary>}
          </Td>
          <Td label="Repositories" align="numeric">
            {formatNumber(component.repositories)}
          </Td>
          <Td label="App" align="numeric">
            {formatNumber(component.usages.app)}
          </Td>
          <Td label="Stories" align="numeric">
            {formatNumber(component.usages.stories)}
          </Td>
          <Td label="Tests" align="numeric">
            {formatNumber(component.usages.tests)}
          </Td>
          <Td label="Customized" align="numeric">
            {component.customized.of > 0 ? `${shareLabel(component.customized)} (${formatNumber(component.customized.count)})` : "None"}
          </Td>
        </tr>
      ))}
    </Table>
  );
}

/** Raw HTML elements one of the design system's components replaces, with their usages and the Repositories that write them. */
function ReplaceableHtmlView({ header, alerts, figures, tracked, coverage }: { header: Header; alerts: React.ReactNode; figures: React.ReactNode; tracked: TrackedDesignSystem; coverage: Coverage }) {
  const elements = replaceableHtml(getDb(), coverage, tracked.id);
  return (
    <AnalysisTemplate
      header={header}
      alerts={alerts}
      figures={figures}
      chart={
        <Panel title="Raw HTML in app code" description={`Elements a ${tracked.name} component could replace, by usages.`}>
          <BarChart id="replaceable-html" label="Usages of raw HTML elements" groupLabel="Element" series={[SCOPES[0]!]} groups={elements.slice(0, 10).map((element) => ({ label: element.tag, values: { app: element.usages } }))} empty="No Repository writes raw HTML a component replaces." />
        </Panel>
      }
    >
      <Panel flush>
        <Table
          label="Replaceable HTML"
          head={
            <>
              <Th>Element</Th>
              <Th>Replaced by</Th>
              <Th align="numeric">Usages</Th>
              <Th>Repositories</Th>
            </>
          }
        >
          {elements.length === 0 && <EmptyRow columns={4}>No Repository writes raw HTML a component replaces.</EmptyRow>}
          {elements.map((element) => (
            <tr key={element.tag}>
              <Td label="Element">
                <code>{element.tag}</code>
              </Td>
              <Td label="Replaced by">
                <Link href={routes.adoptionComponent(tracked.id, element.replacement)}>{element.replacement}</Link>
              </Td>
              <Td label="Usages" align="numeric">
                {formatNumber(element.usages)}
              </Td>
              <Td label="Repositories">
                {countLabel(element.repositories.length, "Repository", "Repositories")}
                <Secondary>
                  <RepositoryLinks repositories={element.repositories} />
                </Secondary>
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </AnalysisTemplate>
  );
}

/** The versions of the design system's packages Repositories resolve. */
function VersionsView({ header, alerts, figures, packages }: { header: Header; alerts: React.ReactNode; figures: React.ReactNode; packages: readonly string[] }) {
  const adoptions = packages.map((name) => packageAdoption(getDb(), name));
  const core = adoptions[0];
  return (
    <AnalysisTemplate
      header={header}
      alerts={alerts}
      figures={figures}
      chart={
        core && (
          <Panel title={core.name} description="Repositories on each version their lockfile resolves.">
            <BarChart id="core-versions" label={`Repositories on each version of ${core.name}`} groupLabel="Version" series={[{ id: "repositories", label: "Repositories", tone: "neutral", pattern: "solid" }]} groups={core.versions.map((version) => ({ label: version.version, values: { repositories: version.repositories } }))} empty="No Repository's lockfile resolves it." />
          </Panel>
        )
      }
    >
      <Panel flush>
        <Table
          label="Packages"
          head={
            <>
              <Th>Package</Th>
              <Th align="numeric">Declared by</Th>
              <Th>Newest resolved</Th>
              <Th align="numeric">Versions in use</Th>
            </>
          }
        >
          {adoptions.map((adoption) => {
            const newest = adoption.versions.find((version) => version.newest);
            return (
              <tr key={adoption.name}>
                <Td label="Package">
                  <Primary>
                    <Link href={routes.adoptionPackage(adoption.name)}>{adoption.name}</Link>
                  </Primary>
                </Td>
                <Td label="Declared by" align="numeric">
                  {countLabel(adoption.repositories.length, "Repository", "Repositories")}
                </Td>
                <Td label="Newest resolved">{newest ? <code>{newest.version}</code> : <Secondary>None</Secondary>}</Td>
                <Td label="Versions in use" align="numeric">
                  {formatNumber(adoption.versions.length)}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </AnalysisTemplate>
  );
}

/** Any two snapshots of the design system compared, figure by figure. */
function SnapshotsView({ header, alerts, designSystemId, query }: { header: Header; alerts: React.ReactNode; designSystemId: string; query: Query }) {
  const db = getDb();
  const snapshots = snapshotsOf(db, "design_system", designSystemId);
  if (snapshots.length === 0) {
    return <AnalysisTemplate header={header} alerts={alerts} empty={{ title: "No snapshots yet", icon: "history", children: "A snapshot of these figures is taken on a fixed schedule; two are needed to compare." }} />;
  }
  const ids = snapshots.map((snapshot) => snapshot.id);
  const chosen = (name: string, fallback: number) => {
    const value = Number(param(query, name));
    return ids.includes(value) ? value : fallback;
  };
  const from = chosen("from", snapshots.at(-2)?.id ?? snapshots[0]!.id);
  const to = chosen("to", snapshots.at(-1)!.id);
  const comparison = compareSnapshots(db, from, to);
  const options = snapshots.map((snapshot) => ({ value: String(snapshot.id), label: formatDate(snapshot.takenAt) }));
  return (
    <AnalysisTemplate
      header={header}
      alerts={alerts}
      filters={
        <form action={routes.adoptionDesignSystem(designSystemId)} className={styles.compare} aria-label="Compare snapshots">
          <input type="hidden" name="view" value="snapshots" />
          <Select id="snapshot-from" name="from" label="From" size="sm" defaultValue={String(from)} options={options} />
          <Select id="snapshot-to" name="to" label="To" size="sm" defaultValue={String(to)} options={options} />
          <button type="submit" {...buttonProps("secondary", "sm")}>
            Compare
          </button>
        </form>
      }
    >
      <Panel flush>
        <Table
          label="Snapshot comparison"
          head={
            <>
              <Th>Figure</Th>
              <Th align="numeric">{formatDate(comparison.earlier?.takenAt ?? comparison.later.takenAt)}</Th>
              <Th align="numeric">{formatDate(comparison.later.takenAt)}</Th>
              <Th align="numeric">Change</Th>
            </>
          }
        >
          {Object.entries(comparison.later.figures).map(([figure, value]) => {
            const change = comparison.figures[figure];
            return (
              <tr key={figure}>
                <Td label="Figure">{FIGURE_LABELS[figure] ?? figure.replaceAll("_", " ")}</Td>
                <Td label="Earlier" align="numeric">
                  {comparison.earlier ? formatNumber(comparison.earlier.figures[figure] ?? 0) : "None"}
                </Td>
                <Td label="Later" align="numeric">
                  {formatNumber(value)}
                </Td>
                <Td label="Change" align="numeric">
                  {change === null || change === undefined ? "None" : change > 0 ? `+${formatNumber(change)}` : change < 0 ? `−${formatNumber(-change)}` : "0"}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </AnalysisTemplate>
  );
}

/** A snapshot's figures, as the page names them. */
const FIGURE_LABELS: Record<string, string> = {
  registered: "Registered Repositories",
  covered: "Covered Repositories",
  repositories: "Repositories using it",
  components_tracked: "Components tracked",
  components_used: "Components used",
  components_rarely_used: "Components rarely used",
  components_unused: "Components unused",
  usages: "Usages in app code",
  usages_in_stories: "Usages in stories",
  usages_in_tests: "Usages in tests",
  tokenized_declarations: "Declarations using tokens",
  token_capable_declarations: "Token-capable declarations",
};
