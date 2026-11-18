import type { JsonObject } from "@repo-facts/contract";
import { cache } from "react";
import { NeedsAttention } from "@/components/profiles/attention";
import { CategoryTable, EmptyCategory, type EvidenceContext, SharedTable } from "@/components/profiles/category-blocks";
import { DependencyFilters } from "@/components/profiles/dependency-filters";
import { ProfileOverview } from "@/components/profiles/overview";
import { ServiceDependencies } from "@/components/profiles/services";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { SectionNav } from "@/components/ui/section-nav";
import { diagnosticReason } from "@/components/ui/status";
import { SHARED_TITLES } from "@/components/profiles/category-blocks";
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import type { Assessment } from "@/lib/assessments/assessment-records";
import { type RepositoryProfile, profileDiagnostics, profileDocument } from "@/lib/profiles/profile-records";
import { profileCommit } from "@/lib/profiles/schema";
import type { FactDocument } from "@/lib/profiles/states";
import { type CategoryBlock, type DependencyFilters as Filters, type SharedBlock, filterDependencies, pageOfGroups, profileView } from "@/lib/profiles/view";
import styles from "./profile-body.module.css";

/** What a Profile is pinned to: a commit, or, for a template version, its files' content digest. A page's header and body share one read of the document. */
export const profilePin = cache((profile: RepositoryProfile): { document: JsonObject; commit: string | null; pinned: string; pinnedLabel: string } => {
  const document = profileDocument(profile);
  // A template version's Profile describes its exported files, identified by their content digest, not a commit.
  const commit = profileCommit(document);
  return { document, commit, pinned: commit ?? String(document.content_digest), pinnedLabel: commit ? "commit" : "content digest" };
});

export const PROFILE_DESCRIPTION = {
  commit: "Every fact comes from committed files at this commit, read as data. Nothing in the repository was run.",
  template: "Every fact comes from the template version's exported files, read as data. Nothing in them was run.",
};

const queryValue = (value: string | string[] | undefined) => (typeof value === "string" && value !== "" ? value : undefined);

// The group the detector release puts service categories in, where the Service Dependencies lead.
const SERVICES_GROUP = "Services";

/** Rows per page of a long table, so a large repository's Profile stays quick to load and to read. */
const PROFILE_PAGE_SIZE = 50;

/**
 * A Profile's sections: the section menu, the overview, what needs
 * attention, every category, service dependencies, skipped inputs, other
 * diagnostics, and the details. +base+ is the page's address, which the
 * dependency filters submit to; +query+ holds their values.
 */
export function ProfileBody({ profile, assessment, query, base }: { profile: RepositoryProfile; assessment: Pick<Assessment, "publicId">; query: Record<string, string | string[] | undefined>; base: string }) {
  const { document, commit, pinned, pinnedLabel } = profilePin(profile);
  const facts = document.fact_document as unknown as FactDocument;
  const diagnostics = profileDiagnostics(document);
  const view = profileView(facts, diagnostics);
  const context: EvidenceContext = { records: (facts.evidence ?? {}) as JsonObject, assessmentId: assessment.publicId, profileId: profile.publicId };
  const filters: Filters = { kind: queryValue(query.kind), manifest: queryValue(query.manifest), package: queryValue(query.package) };

  // Each long table pages on its own, in the address as `<category>_page`, keeping the rest of the query.
  const paging = (id: string, total: number) => {
    const key = `${id}_page`;
    const pages = Math.max(1, Math.ceil(total / PROFILE_PAGE_SIZE));
    const requested = Number.parseInt(queryValue(query[key]) ?? "1", 10);
    const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
    const href = (number: number) => {
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(query)) if (typeof value === "string" && name !== key) params.set(name, value);
      if (number > 1) params.set(key, String(number));
      return `${base}${params.size ? `?${params}` : ""}#${id}`;
    };
    return { page, pages, start: (page - 1) * PROFILE_PAGE_SIZE, href };
  };

  const category = (block: CategoryBlock) => {
    const { id, label } = block.heading.definition;
    const { page, pages, start, href } = paging(id, block.rows.length);
    return <CategoryTable key={id} block={{ ...block, rows: block.rows.slice(start, start + PROFILE_PAGE_SIZE) }} context={context} pagination={<Pagination label={`${label} pages`} page={page} pages={pages} href={href} scrollToTop />} />;
  };

  const services = (level: 2 | 3) => {
    const { page, pages, start, href } = paging("services", view.services.length);
    return <ServiceDependencies key="services" level={level} services={view.services.slice(start, start + PROFILE_PAGE_SIZE)} total={view.services.length} context={context} pagination={<Pagination label="Service Dependency pages" page={page} pages={pages} href={href} scrollToTop />} />;
  };
  // Every menu entry shows a state: the Service Dependencies' is whether each one's boundary is characterized.
  const servicesItem = { id: "services", label: `Service Dependencies (${view.services.length})`, state: !view.services.length ? "absent" : view.services.every((service) => service.characterized) ? "characterized" : "incomplete" };

  const shared = (block: SharedBlock, level: 2 | 3 = 3) => {
    const filtered = block.kind === "dependencies" ? filterDependencies(block, filters) : null;
    const rows = filtered ? filtered.block : block;
    const id = block.sources[0]!.definition.id;
    const { page, pages, href } = paging(id, rows.groups.reduce((sum, group) => sum + group.rows.length, 0));
    return (
      <SharedTable
        key={block.kind}
        level={level}
        block={pageOfGroups(rows, page, PROFILE_PAGE_SIZE)}
        context={context}
        filters={filtered && <DependencyFilters block={block} filters={filters} action={`${base}#dependencies`} shown={filtered.shown} total={filtered.total} />}
        pagination={<Pagination label={`${block.kind === "dependencies" ? "Dependencies" : "Package scripts"} pages`} page={page} pages={pages} href={href} scrollToTop />}
      />
    );
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

  return (
    <div className={styles.layout}>
      <SectionNav
        label="Profile sections"
        jumpLabel="Jump to category"
        groups={[
          {
            label: "Summary",
            items: [
              { id: "overview", label: "Overview", state: view.attention.items.length ? "complete_with_issues" : "complete" },
              { id: "attention", label: view.attention.items.length ? `Needs attention (${view.attention.items.length})` : "Needs attention", state: view.attention.items.length ? "to_review" : "clear" },
            ],
          },
          // Service Dependencies lead the Services group, where the page shows them.
          ...view.navigation.map((group) => (group.label === SERVICES_GROUP ? { ...group, items: [servicesItem, ...group.items] } : group)),
          ...(view.navigation.some((group) => group.label === SERVICES_GROUP) ? [] : [{ label: SERVICES_GROUP, items: [servicesItem] }]),
          {
            label: "Diagnostics",
            items: [
              { id: "diagnostics", label: `Skipped inputs (${diagnostics.skipped.length})`, state: diagnostics.skipped.length ? "to_review" : "clear" },
              ...(diagnostics.notes.length ? [{ id: "other-diagnostics", label: `Other diagnostics (${diagnostics.notes.length})`, state: "to_review" }] : []),
            ],
          },
        ]}
      />

      <div className={styles.content}>
        <ProfileOverview rows={view.overview} scope={view.scope} />
        <NeedsAttention attention={view.attention} />

        {view.groups.map((group) => {
          const [only] = group.blocks;
          // A group that is one shared table of the same name is that table, so its heading isn't said twice.
          if (group.blocks.length === 1 && (only!.kind === "dependencies" || only!.kind === "scripts") && SHARED_TITLES[only!.kind].title === group.label) return shared(only!, 2);
          return (
            <Section key={group.label} title={group.label}>
              {group.label === SERVICES_GROUP && services(3)}
              {group.blocks.flatMap((block) => {
                if (block.kind === "category") return [category(block)];
                if (block.kind === "compact") return block.items.map((item) => <EmptyCategory key={item.definition.id} definition={item.definition} value={item.value} />);
                return [shared(block)];
              })}
            </Section>
          );
        })}
        {!view.groups.some((group) => group.label === SERVICES_GROUP) && services(2)}

        <Section title="Diagnostics">
          <Section id="diagnostics" level={3} title="Skipped inputs" description="Files that were not read or not understood. Facts they could affect are unknown, never absent.">
            {diagnostics.skipped.length ? (
              diagnosticTable("diagnostics", "Skipped inputs", diagnostics.skipped)
            ) : (
              <p className={styles.muted}>Every input was read and understood.</p>
            )}
          </Section>
          {diagnostics.notes.length > 0 && (
            <Section id="other-diagnostics" level={3} title="Other diagnostics" description="Inconsistencies and unsupported constructs the detectors noted without skipping the input.">
              {diagnosticTable("other-diagnostics", "Other diagnostics", diagnostics.notes)}
            </Section>
          )}
        </Section>

        <Disclosure summary="Details" variant="plain">
          <DescriptionList
            surface
            items={[
              [commit ? "Commit" : "Content digest", <Tag key="commit" copy label={pinnedLabel}>{pinned}</Tag>],
              ["Detector release", <Tag key="release">{String(document.detector_release)}</Tag>],
              ["Profile digest", <ShortValue key="digest" value={profile.digest} label="digest" />],
              ["Created", <RelativeTime key="created" value={profile.createdAt} />],
              ["ID", <Tag key="id" copy label="ID">{profile.publicId}</Tag>],
            ]}
          />
        </Disclosure>
      </div>
    </div>
  );
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
