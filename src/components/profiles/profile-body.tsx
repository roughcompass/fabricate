import type { JsonObject } from "@repo-facts/contract";
import { cache } from "react";
import { NeedsAttention } from "@/components/profiles/attention";
import { CategoryTable, EmptyCategory, type EvidenceContext, SharedTable } from "@/components/profiles/category-blocks";
import { DependencyFilters } from "@/components/profiles/dependency-filters";
import { OverviewValues, ProfileOverview } from "@/components/profiles/overview";
import { ProfileHashLink } from "@/components/profiles/profile-hash-link";
import { Relationships } from "@/components/profiles/relationships";
import { ServiceDependencies } from "@/components/profiles/services";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { SectionNav } from "@/components/ui/section-nav";
import { diagnosticReason } from "@/components/ui/status";
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { ShortValue, Tag } from "@/components/ui/tag";
import type { Assessment } from "@/lib/assessments/assessment-records";
import { type Executor, getDb } from "@/lib/db/client";
import { dependencyGroups } from "@/lib/profiles/joins";
import { type RepositoryProfile, profileDiagnostics, profileDocument } from "@/lib/profiles/profile-records";
import { packageProducers, repositoryRelationships } from "@/lib/profiles/relationships";
import { profileCommit } from "@/lib/profiles/schema";
import type { FactDocument } from "@/lib/profiles/states";
import { type SummaryPanel, profileSummary } from "@/lib/profiles/summary";
import { type ProfileTabId, isProfileTab, profileTabHref } from "@/lib/profiles/tabs";
import { type CategoryBlock, type DependencyFilters as Filters, filterDependencies, pageOfGroups, profileView, type ProfileView, type SharedBlock, type TabView } from "@/lib/profiles/view";
import styles from "./profile-body.module.css";
import { pageNumber, pageQuery, param, withQuery } from "@/lib/web/query";
import { targetById } from "@/lib/assessments/assessment-records";

/** The commit a Profile is pinned to. A page's header and body share one read of the document. */
export const profilePin = cache((profile: RepositoryProfile): { document: JsonObject; commit: string } => {
  const document = profileDocument(profile);
  return { document, commit: profileCommit(document) };
});

export const PROFILE_DESCRIPTION = "Every fact comes from committed files at this commit, read as data. Nothing in the repository was run.";


/** Rows per page of a long table, so a large repository's Profile stays quick to load and to read. */
const PROFILE_PAGE_SIZE = 50;

/** The Overview's panels, from the facts, the newest map's relationships, and which declared packages the fleet produces. */
function overviewPanels(db: Executor, profile: RepositoryProfile, facts: FactDocument, view: ProfileView) {
  const target = targetById(db, profile.assessmentTargetId);
  const relationships = repositoryRelationships(db, target.repositorySourceId);
  const declared = [...new Set(dependencyGroups(facts).flatMap((group) => group.rows.filter((row) => row.declared).map((row) => row.name)))];
  const panels = profileSummary(facts, view.overview, {
    kind: view.kind,
    relationships,
    producers: packageProducers(db, declared),
    self: target.sourcePublicId,
    services: { total: view.services.length, characterized: view.services.filter((service) => service.characterized).length },
  });
  return { panels, relationships, declared };
}

/**
 * A Profile as views, one per question a reader brings to a repository:
 * Overview, then Composition, Dependencies, Design system, Services,
 * Tooling, and Diagnostics, each in the address as `tab`. The
 * Overview answers each question in a few rows that link to the view holding
 * their facts; every other view leads with that answer, then shows its
 * categories in full with their search, state, and evidence. A repository
 * that isn't a frontend web repository has no frontend views, and its
 * Overview says why. +base+ is the page's address; +query+ holds the view,
 * the dependency filters, and each table's page.
 */
export function ProfileBody({ profile, assessment, query, base }: { profile: RepositoryProfile; assessment: Pick<Assessment, "publicId">; query: Record<string, string | string[] | undefined>; base: string }) {
  const db = getDb();
  const { document, commit } = profilePin(profile);
  const facts = document.fact_document as unknown as FactDocument;
  const diagnostics = profileDiagnostics(document);
  const view = profileView(facts, diagnostics);
  const context: EvidenceContext = { records: (facts.evidence ?? {}) as JsonObject, assessmentId: assessment.publicId, profileId: profile.publicId };
  const filters: Filters = { kind: param(query, "kind") || undefined, manifest: param(query, "manifest") || undefined, package: param(query, "package") || undefined };

  const { panels, relationships, declared } = overviewPanels(db, profile, facts, view);

  const visible = view.tabs.filter((tab) => tab.visible);
  const requested = param(query, "tab");
  const current = visible.find((tab) => tab.id === (isProfileTab(requested) ? requested : "overview")) ?? visible[0]!;

  // Each long table pages on its own, in the address as `<category>_page`, keeping the rest of the query.
  const paging = (id: string, total: number) => {
    const key = `${id}_page`;
    const { page, pages } = pageNumber(param(query, key), total, PROFILE_PAGE_SIZE);
    const kept = Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[0] !== key));
    const href = (number: number) => withQuery(base, { ...kept, [key]: pageQuery(number) }, id);
    return { page, pages, start: (page - 1) * PROFILE_PAGE_SIZE, href };
  };

  const category = (block: CategoryBlock) => {
    const { id, label } = block.heading.definition;
    const { page, pages, start, href } = paging(id, block.rows.length);
    return <CategoryTable key={id} block={{ ...block, rows: block.rows.slice(start, start + PROFILE_PAGE_SIZE) }} context={context} pagination={<Pagination label={`${label} pages`} page={page} pages={pages} href={href} scrollToTop />} />;
  };

  const shared = (block: SharedBlock) => {
    const filtered = block.kind === "dependencies" ? filterDependencies(block, filters) : null;
    const rows = filtered ? filtered.block : block;
    const id = block.sources[0]!.definition.id;
    const { page, pages, href } = paging(id, rows.groups.reduce((sum, group) => sum + group.rows.length, 0));
    return (
      <SharedTable
        key={block.kind}
        block={pageOfGroups(rows, page, PROFILE_PAGE_SIZE)}
        context={context}
        filters={filtered && <DependencyFilters block={block} filters={filters} action={`${base}#dependencies`} tab="dependencies" shown={filtered.shown} total={filtered.total} />}
        pagination={<Pagination label={`${block.kind === "dependencies" ? "Dependencies" : "Package scripts"} pages`} page={page} pages={pages} href={href} scrollToTop />}
      />
    );
  };

  const services = () => {
    const { page, pages, start, href } = paging("services", view.services.length);
    return <ServiceDependencies key="services" level={3} services={view.services.slice(start, start + PROFILE_PAGE_SIZE)} total={view.services.length} context={context} pagination={<Pagination label="Service Dependency pages" page={page} pages={pages} href={href} scrollToTop />} />;
  };

  // A large repository skips tens of thousands of inputs, so its diagnostics page like any long table.
  const diagnosticTable = (id: string, label: string, entries: readonly JsonObject[]) => {
    const { page, pages, start, href } = paging(id, entries.length);
    return (
      <>
        <Panel flush>
          <DiagnosticTable label={label} diagnostics={entries.slice(start, start + PROFILE_PAGE_SIZE)} />
        </Panel>
        <Pagination label={`${label} pages`} page={page} pages={pages} href={href} scrollToTop />
      </>
    );
  };

  const blocks = (tab: TabView) =>
    tab.blocks.flatMap((block) => {
      if (block.kind === "category") return [category(block)];
      if (block.kind === "compact") return block.items.map((item) => <EmptyCategory key={item.definition.id} definition={item.definition} value={item.value} />);
      return [shared(block)];
    });

  // A view's section menu: its categories, with the sections that aren't categories where they appear.
  const navigation = (tab: TabView) => {
    const items = [
      ...(tab.id === "composition" ? [{ id: "relationships", label: "Relationships", state: relationships.run ? (relationships.uses.length + relationships.usedBy.length ? "resolved" : "absent") : "unknown" }] : []),
      ...(tab.id === "services" ? [{ id: "services", label: `Service Dependencies (${view.services.length})`, state: !view.services.length ? "absent" : view.services.every((service) => service.characterized) ? "characterized" : "incomplete" }] : []),
      ...tab.navigation,
      ...(tab.id === "diagnostics"
        ? [
            { id: "needs-attention", label: view.attention.items.length ? `Needs attention (${view.attention.items.length})` : "Needs attention", state: view.attention.items.length ? "to_review" : "clear" },
            { id: "diagnostics", label: `Skipped inputs (${diagnostics.skipped.length})`, state: diagnostics.skipped.length ? "to_review" : "clear" },
            ...(diagnostics.notes.length ? [{ id: "other-diagnostics", label: `Other diagnostics (${diagnostics.notes.length})`, state: "to_review" }] : []),
          ]
        : []),
    ];
    return [{ label: tab.label, items }];
  };

  const panel = panels.find((candidate) => candidate.tab === current.id);
  const declaredCount = declared.length;
  const counts: Partial<Record<ProfileTabId, number>> = { dependencies: declaredCount, services: view.services.length, diagnostics: view.attention.items.length };

  return (
    <div className={styles.body}>
      <ProfileHashLink base={base} current={current.id} />
      <Tabs label="Profile views">
        {visible.map((tab) => (
          <TabLink key={tab.id} href={profileTabHref(base, tab.id)} active={tab.id === current.id} count={counts[tab.id]}>
            {tab.label}
          </TabLink>
        ))}
      </Tabs>

      {current.id === "overview" ? (
        <ProfileOverview view={view} panels={panels} base={base} />
      ) : (
        <div className={styles.layout}>
          <SectionNav label={`${current.label} sections`} jumpLabel="Jump to section" groups={navigation(current)} />
          <div className={styles.content}>
            <Section id={`view-${current.id}`} title={current.label} description={current.question}>
              {panel && panel.rows.length > 0 && <Answer panel={panel} base={base} />}
            </Section>
            {current.id === "composition" && <Relationships relationships={relationships} />}
            {current.id === "services" && services()}
            {blocks(current)}
            {current.id === "diagnostics" && (
              <>
                <NeedsAttention attention={view.attention} base={base} />
                <Section id="diagnostics" level={3} title="Skipped inputs" description="Files that were not read or not understood. Facts they could affect are unknown, never absent.">
                  {diagnostics.skipped.length ? diagnosticTable("diagnostics", "Skipped inputs", diagnostics.skipped) : <p className={styles.muted}>Every input was read and understood.</p>}
                </Section>
                {diagnostics.notes.length > 0 && (
                  <Section id="other-diagnostics" level={3} title="Other diagnostics" description="Inconsistencies and unsupported constructs the detectors noted without skipping the input.">
                    {diagnosticTable("other-diagnostics", "Other diagnostics", diagnostics.notes)}
                  </Section>
                )}
                <Disclosure summary="Details" variant="plain">
                  <DescriptionList
                    surface
                    items={[
                      ["Commit", <Tag key="commit" copy label="commit">{commit}</Tag>],
                      ["Detector release", <Tag key="release">{String(document.detector_release)}</Tag>],
                      ["Profile digest", <ShortValue key="digest" value={profile.digest} label="digest" />],
                      ["Created", <RelativeTime key="created" value={profile.createdAt} />],
                      ["ID", <Tag key="id" copy label="ID">{profile.publicId}</Tag>],
                    ]}
                  />
                </Disclosure>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A view's answer first: the Overview's rows for its question, before the facts behind them. */
function Answer({ panel, base }: { panel: SummaryPanel; base: string }) {
  return <DescriptionList surface items={panel.rows.map((row) => [row.label, <OverviewValues key={row.label} row={row} base={base} />])} />;
}

function DiagnosticTable({ label, diagnostics }: { label: string; diagnostics: readonly JsonObject[] }) {
  return (
    <Table
      label={label}
      head={
        <>
          <Th>Path</Th>
          <Th>Reason</Th>
          <Th>Detail</Th>
        </>
      }
    >
      {diagnostics.map((diagnostic, index) => (
        <tr key={`${String(diagnostic.path)}:${index}`}>
          <Td label="Path">
            <span className={styles.mono}>{String(diagnostic.path) || "(repository)"}</span>
          </Td>
          <Td label="Reason">
            {diagnosticReason(String(diagnostic.reason))}
            {diagnostic.detector !== null && <Secondary mono>{String(diagnostic.detector)}</Secondary>}
          </Td>
          <Td label="Detail">
            <DiagnosticDetail detail={String(diagnostic.detail)} />
          </Td>
        </tr>
      ))}
    </Table>
  );
}

/**
 * A diagnostic's detail in words first: "Origin is not a literal", then the
 * line and the rule it came from, rather than leading with a rule id.
 */
function DiagnosticDetail({ detail }: { detail: string }) {
  const match = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+) at line (\d+): (.+)$/s.exec(detail);
  if (!match) return <>{detail}</>;
  const [, rule, line, message] = match;
  return (
    <>
      {message!.charAt(0).toUpperCase() + message!.slice(1)}
      <Secondary>
        {`Line ${line} · rule `}
        <span className={styles.mono}>{rule}</span>
      </Secondary>
    </>
  );
}
