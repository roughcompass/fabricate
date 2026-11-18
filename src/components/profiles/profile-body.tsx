import type { JsonObject } from "@repo-facts/contract";
import { NeedsAttention } from "@/components/profiles/attention";
import { CategoryTable, CompactList, type EvidenceContext, SharedTable } from "@/components/profiles/category-blocks";
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
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import type { Assessment } from "@/lib/assessments/assessment-records";
import { type RepositoryProfile, profileDiagnostics, profileDocument } from "@/lib/profiles/profile-records";
import { profileCommit } from "@/lib/profiles/schema";
import { type FactDocument, categoryDefinitions } from "@/lib/profiles/states";
import { type CategoryBlock, type DependencyFilters as Filters, type SharedBlock, filterDependencies, pageOfGroups, profileView } from "@/lib/profiles/view";
import styles from "./profile-body.module.css";

/** What a Profile is pinned to: a commit, or, for a template version, its files' content digest. */
export function profilePin(profile: RepositoryProfile): { document: JsonObject; commit: string | null; pinned: string; pinnedLabel: string } {
  const document = profileDocument(profile);
  // A template version's Profile describes its exported files, identified by their content digest, not a commit.
  const commit = profileCommit(document);
  return { document, commit, pinned: commit ?? String(document.content_digest), pinnedLabel: commit ? "commit" : "content digest" };
}

export const PROFILE_DESCRIPTION = {
  commit: "Every fact comes from committed files at this commit, read as data. Nothing in the repository was run.",
  template: "Every fact comes from the template version's exported files, read as data. Nothing in them was run.",
};

const queryValue = (value: string | string[] | undefined) => (typeof value === "string" && value !== "" ? value : undefined);

/** Rows per page of a long table, so a large repository's Profile stays quick to load and to read. */
export const PROFILE_PAGE_SIZE = 50;

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
  const context: EvidenceContext = { records: (facts.evidence ?? {}) as JsonObject, assessmentId: assessment.publicId, labels: new Map(categoryDefinitions(facts).map((definition) => [definition.id, definition.label])) };
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
        filters={filtered && <DependencyFilters block={block} filters={filters} action={`${base}#dependencies`} shown={filtered.shown} total={filtered.total} />}
        pagination={<Pagination label={`${block.kind === "dependencies" ? "Dependencies" : "Package scripts"} pages`} page={page} pages={pages} href={href} scrollToTop />}
      />
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
              { id: "overview", label: "Overview" },
              { id: "attention", label: view.attention.items.length ? `Needs attention (${view.attention.items.length})` : "Needs attention" },
            ],
          },
          ...view.navigation,
          {
            label: "More",
            items: [
              { id: "services", label: `Service Dependencies (${view.services.length})` },
              { id: "diagnostics", label: `Skipped inputs (${diagnostics.skipped.length})` },
            ],
          },
        ]}
      />

      <div className={styles.content}>
        <ProfileOverview rows={view.overview} />
        <NeedsAttention attention={view.attention} />

        {view.groups.map((group) => (
          <Section key={group.label} title={group.label}>
            {group.blocks.map((block, index) => {
              if (block.kind === "category") return category(block);
              if (block.kind === "compact") return <CompactList key={`compact-${index}`} block={block} />;
              return shared(block);
            })}
          </Section>
        ))}

        {(() => {
          const { page, pages, start, href } = paging("services", view.services.length);
          return <ServiceDependencies services={view.services.slice(start, start + PROFILE_PAGE_SIZE)} total={view.services.length} context={context} pagination={<Pagination label="Service Dependency pages" page={page} pages={pages} href={href} scrollToTop />} />;
        })()}

        <Section id="diagnostics" title="Skipped inputs" description="Files that were not read or not understood. Facts they could affect are unknown, never absent.">
          {diagnostics.skipped.length ? (
            <Panel flush>
              <DiagnosticTable label="Skipped inputs" diagnostics={diagnostics.skipped} />
            </Panel>
          ) : (
            <p className={styles.muted}>Every input was read and understood.</p>
          )}
        </Section>
        {diagnostics.notes.length > 0 && (
          <Section id="other-diagnostics" title="Other diagnostics" description="Inconsistencies and unsupported constructs the detectors noted without skipping the input.">
            <Panel flush>
              <DiagnosticTable label="Other diagnostics" diagnostics={diagnostics.notes} />
            </Panel>
          </Section>
        )}

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
            <Tag>{String(diagnostic.path) || "(repository)"}</Tag>
          </Td>
          <Td label="Reason">
            {diagnosticReason(String(diagnostic.reason))}
            {diagnostic.detector !== null && <Secondary mono>{String(diagnostic.detector)}</Secondary>}
          </Td>
          <Td label="Detail">{String(diagnostic.detail)}</Td>
        </tr>
      ))}
    </Table>
  );
}
