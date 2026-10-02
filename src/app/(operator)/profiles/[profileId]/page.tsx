import type { JsonObject } from "@repo-facts/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { NeedsAttention } from "@/components/profiles/attention";
import { CategoryTable, CompactList, type EvidenceContext, SharedTable } from "@/components/profiles/category-blocks";
import { DependencyFilters } from "@/components/profiles/dependency-filters";
import { ProfileOverview } from "@/components/profiles/overview";
import { ServiceDependencies } from "@/components/profiles/services";
import { Alert } from "@/components/ui/alert";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { SectionNav } from "@/components/ui/section-nav";
import { diagnosticReason } from "@/components/ui/status";
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import { assessmentNumber } from "@/lib/assessments/assessment-records";
import { assessmentById } from "@/lib/assessments/lookups";
import { getDb } from "@/lib/db/client";
import { assessmentTargets } from "@/lib/db/schema";
import { initiativeById } from "@/lib/initiatives/initiative-records";
import { findProfile, latestProfileOfSource, profileDiagnostics, profileDocument } from "@/lib/profiles/profile-records";
import { type FactDocument, categoryDefinitions } from "@/lib/profiles/states";
import { type DependencyFilters as Filters, type SharedBlock, filterDependencies, profileView } from "@/lib/profiles/view";
import { eq } from "drizzle-orm";
import styles from "./profile.module.css";

const load = cache((publicId: string) => {
  const db = getDb();
  const profile = findProfile(db, publicId);
  if (!profile) return undefined;
  const target = db.select().from(assessmentTargets).where(eq(assessmentTargets.id, profile.assessmentTargetId)).get()!;
  const assessment = assessmentById(db, profile.assessmentId);
  return { profile, target, assessment, initiative: initiativeById(db, assessment.initiativeId), number: assessmentNumber(db, assessment) };
});

export async function generateMetadata({ params }: { params: Promise<{ profileId: string }> }): Promise<Metadata> {
  const found = load((await params).profileId);
  return { title: found ? `${found.target.sourceName} · Run #${found.number}` : "Profile not found" };
}

const queryValue = (value: string | string[] | undefined) => (typeof value === "string" && value !== "" ? value : undefined);

export default async function ProfilePage({ params, searchParams }: { params: Promise<{ profileId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ profileId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const found = load(profileId);
  if (!found) notFound();
  const { profile, target, assessment, initiative, number } = found;
  const document = profileDocument(profile);
  const facts = document.fact_document as unknown as FactDocument;
  const diagnostics = profileDiagnostics(document);
  const view = profileView(facts, diagnostics);
  const latest = latestProfileOfSource(db, target.sourcePublicId);
  const newer = latest && latest.profile.id !== profile.id ? latest : null;
  const commit = String(document.commit);
  const context: EvidenceContext = { records: (facts.evidence ?? {}) as JsonObject, assessmentId: assessment.publicId, labels: new Map(categoryDefinitions(facts).map((definition) => [definition.id, definition.label])) };
  const filters: Filters = { kind: queryValue(query.kind), manifest: queryValue(query.manifest), package: queryValue(query.package) };
  const base = `/profiles/${profile.publicId}`;

  const dependencies = (block: SharedBlock) => {
    const { block: shown, shown: count, total } = filterDependencies(block, filters);
    return <SharedTable key={block.kind} block={shown} context={context} filters={<DependencyFilters block={block} filters={filters} action={`${base}#dependencies`} shown={count} total={total} />} />;
  };

  return (
    <Page>
      <PageHeader
        breadcrumbs={[
          { href: "/assessments", label: "Assessments" },
          { href: `/assessments/${initiative.publicId}`, label: initiative.name },
          { href: `/runs/${assessment.publicId}`, label: `Run #${number}` },
        ]}
        title={target.sourceName}
        meta={[
          <ShortValue key="commit" value={commit} label="commit" />,
          <span key="created">
            Profiled <RelativeTime value={profile.createdAt} />
          </span>,
        ]}
        description="Every fact comes from committed files at this commit, read as data. Nothing in the repository was run."
        alerts={
          newer && (
            <Alert
              tone="info"
              title="This is a historical Profile"
              actions={
                <Link href={`/profiles/${newer.profile.publicId}`} className={styles.alertLink}>
                  View the newest Profile
                </Link>
              }
            >
              A newer Profile of this repository exists. This one keeps its original facts, evidence, and detector release.
            </Alert>
          )
        }
      />

      <div className={styles.layout}>
        <SectionNav
          label="Profile sections"
          jumpLabel="Jump to category"
          groups={[
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
                if (block.kind === "category") return <CategoryTable key={block.heading.definition.id} block={block} context={context} />;
                if (block.kind === "compact") return <CompactList key={`compact-${index}`} block={block} />;
                return block.kind === "dependencies" ? dependencies(block) : <SharedTable key={block.kind} block={block} context={context} />;
              })}
            </Section>
          ))}

          <ServiceDependencies services={view.services} context={context} />

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
                ["Commit", <Tag key="commit" copy label="commit">{commit}</Tag>],
                ["Detector release", <Tag key="release">{String(document.detector_release)}</Tag>],
                ["Profile digest", <ShortValue key="digest" value={profile.digest} label="digest" />],
                ["Created", <RelativeTime key="created" value={profile.createdAt} />],
                ["ID", <Tag key="id" copy label="ID">{profile.publicId}</Tag>],
              ]}
            />
          </Disclosure>
        </div>
      </div>
    </Page>
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
