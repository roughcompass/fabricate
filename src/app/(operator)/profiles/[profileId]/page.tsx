import { type JsonObject, type JsonValue, SHARED_CATEGORIES } from "@repo-facts/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { EvidenceList } from "@/components/results/evidence";
import { factText, formatValue } from "@/components/results/value";
import { Alert } from "@/components/ui/alert";
import { countLabel } from "@/components/ui/count";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { SectionNav } from "@/components/ui/section-nav";
import { StatGroup } from "@/components/ui/stat-group";
import { Status, diagnosticReason } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import { assessmentNumber } from "@/lib/assessments/assessment-records";
import { assessmentById } from "@/lib/assessments/lookups";
import { getDb } from "@/lib/db/client";
import { assessmentTargets } from "@/lib/db/schema";
import { initiativeById } from "@/lib/initiatives/initiative-records";
import { findProfile, latestProfileOfSource, profileDiagnostics, profileDocument } from "@/lib/profiles/profile-records";
import { eq } from "drizzle-orm";
import styles from "./profile.module.css";

type Fact = { key: string; state: string; value: JsonValue; evidence: JsonValue[]; reasoning?: string; candidates?: { value: JsonValue; evidence: JsonValue[] }[] };
type Category = { state: string; facts: Fact[]; search: { complete: boolean; skipped: string[]; surface: string[]; rules: string[] } };

const SERVICE_FACTS: [key: string, label: string][] = [
  ["identity", "Identity"],
  ["protocol", "Protocol"],
  ["endpoint", "Endpoint"],
  ["operations", "Operations"],
  ["request_shape", "Request shape"],
  ["consumed_response_fields", "Consumed response fields"],
  ["authentication", "Authentication signals"],
  ["timeout", "Timeout"],
  ["retry", "Retry"],
  ["proxy", "Proxy expectation"],
  ["contracts", "Contracts"],
  ["substitutes", "Test substitutes"],
];

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
  return { title: found ? `${found.target.sourceName} · Assessment #${found.number}` : "Profile not found" };
}

/** Why a category has no facts, in one sentence. */
function emptyReason(category: Category | undefined): string {
  if (category?.state === "absent") {
    return category.search.surface.length ? `None detected after a complete search of ${countLabel(category.search.surface.length, "input")}.` : "None detected: no input this category reads exists in this commit.";
  }
  if (category?.search.skipped.length) return `Unknown: ${countLabel(category.search.skipped.length, "relevant input")} could not be read or understood, so an absence cannot be claimed. ${category.search.skipped.join(", ")}`;
  return "Unknown: no bounded search can establish this category from committed files, or none of its searches was complete.";
}

export default async function ProfilePage({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  const db = getDb();
  const found = load(profileId);
  if (!found) notFound();
  const { profile, target, assessment, initiative, number } = found;
  const document = profileDocument(profile);
  const facts = document.fact_document as JsonObject;
  const categories = (facts.categories ?? {}) as unknown as Record<string, Category>;
  const evidence = (facts.evidence ?? {}) as JsonObject;
  const services = (Array.isArray(facts.service_dependencies) ? facts.service_dependencies : []) as JsonObject[];
  const diagnostics = profileDiagnostics(document);
  const latest = latestProfileOfSource(db, target.sourcePublicId);
  const newer = latest && latest.profile.id !== profile.id ? latest : null;
  const stateOf = (id: string) => categories[id]?.state ?? "unknown";
  const count = (state: string) => SHARED_CATEGORIES.filter((definition) => stateOf(definition.id) === state).length;
  const groups = [...new Set(SHARED_CATEGORIES.map((definition) => definition.group))];
  const evidenceFor = (ids: JsonValue[] | undefined) => <EvidenceList ids={ids ?? []} records={evidence} assessmentId={assessment.publicId} />;
  const commit = String(document.commit);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[
          { href: "/", label: "Initiatives" },
          { href: `/initiatives/${initiative.publicId}`, label: initiative.name },
          { href: `/assessments/${assessment.publicId}`, label: `Assessment #${number}` },
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
            ...groups.map((group) => ({ label: group, items: SHARED_CATEGORIES.filter((definition) => definition.group === group).map((definition) => ({ id: definition.id, label: definition.label, state: stateOf(definition.id) })) })),
            {
              label: "More",
              items: [
                { id: "services", label: `Service Dependencies (${services.length})` },
                { id: "diagnostics", label: `Skipped inputs (${diagnostics.skipped.length})` },
              ],
            },
          ]}
        />

        <div className={styles.content}>
          <StatGroup
            label="Categories by state"
            stats={[
              { label: "Observed", value: count("observed") },
              { label: "Inferred or mixed", value: count("inferred") + count("mixed") },
              { label: "Conflicting", value: count("conflicting") },
              { label: "Unknown", value: count("unknown") },
              { label: "None detected", value: count("absent") },
            ]}
          />

          {groups.map((group) => {
            const definitions = SHARED_CATEGORIES.filter((definition) => definition.group === group);
            const withFacts = definitions.filter((definition) => categories[definition.id]?.facts.length);
            const withoutFacts = definitions.filter((definition) => !categories[definition.id]?.facts.length);
            return (
              <Section key={group} title={group}>
                {withFacts.map((definition) => {
                  const category = categories[definition.id]!;
                  return (
                    <Section key={definition.id} id={definition.id} level={3} title={definition.label} description={definition.description} actions={<Status state={category.state} />}>
                      <Panel flush>
                        <Table
                          label={definition.label}
                          head={
                            <>
                              <Th>Fact</Th>
                              <Th>Value</Th>
                              <Th>State</Th>
                              <Th>Evidence</Th>
                            </>
                          }
                        >
                          {category.facts.map((fact) => (
                            <tr key={fact.key}>
                              <Td label="Fact">
                                <Tag>{fact.key}</Tag>
                              </Td>
                              <Td label="Value">
                                {fact.state === "conflicting" ? (
                                  <ul className={styles.candidates} aria-label="Candidates">
                                    {(fact.candidates ?? []).map((candidate, index) => (
                                      <li key={index}>
                                        {formatValue(candidate.value)} {evidenceFor(candidate.evidence)}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  factText(fact.state, fact.value)
                                )}
                                {fact.reasoning && <Secondary>{fact.reasoning}</Secondary>}
                              </Td>
                              <Td label="State">
                                <Status state={fact.state} />
                              </Td>
                              <Td label="Evidence">{evidenceFor(fact.evidence)}</Td>
                            </tr>
                          ))}
                        </Table>
                      </Panel>
                    </Section>
                  );
                })}
                {withoutFacts.length > 0 && (
                  <Panel flush>
                    <ul className={styles.compact} aria-label={`${group} categories without facts`}>
                      {withoutFacts.map((definition) => (
                        <li key={definition.id} id={definition.id} className={styles.compactRow}>
                          <div className={styles.compactName}>
                            <Primary>{definition.label}</Primary>
                            <Secondary>{emptyReason(categories[definition.id])}</Secondary>
                          </div>
                          <Status state={stateOf(definition.id)} />
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}
              </Section>
            );
          })}

          <Section id="services" title="Service Dependencies" description="Outbound calls found in committed source and configuration. Static discovery does not prove entitlement, reachability, or integrated behavior, so access is unknown for every service.">
            {services.length === 0 && <p className={styles.muted}>No Service Dependency was found.</p>}
            {services.map((service) => {
              const missing = Array.isArray(service.missing_evidence) ? service.missing_evidence.map(String) : [];
              const access = (service.access ?? {}) as JsonObject;
              const key = String(service.key);
              return (
                <section key={key} aria-label={key}>
                  <Disclosure
                    summary={
                      <>
                        <Tag>{key}</Tag>
                        <span className={styles.muted}>{`called through ${formatValue(((service.client ?? {}) as JsonObject).kind ?? null)}`}</span>
                      </>
                    }
                    aside={<Status state={service.characterizable ? "characterized" : "incomplete"} />}
                  >
                    <DescriptionList
                      items={[
                        ...SERVICE_FACTS.map(([factKey, label]): [string, React.ReactNode] => {
                          const fact = (service[factKey] ?? {}) as JsonObject;
                          const state = String(fact.state ?? "unknown");
                          return [
                            label,
                            <span key={factKey}>
                              <Status state={state} size="sm" />{" "}
                              {state === "conflicting" ? `Candidates: ${(Array.isArray(fact.candidates) ? fact.candidates : []).map((candidate) => formatValue((candidate as JsonObject).value)).join(" | ")}` : factText(state, fact.value)}
                              {typeof fact.reasoning === "string" && <Secondary>{fact.reasoning}</Secondary>}
                            </span>,
                          ];
                        }),
                        [
                          "Access",
                          <span key="access">
                            <Status state="unknown" size="sm" /> {String(access.reason ?? "Not established by static discovery")}
                          </span>,
                        ],
                        ["Missing evidence", missing.length ? missing.join(", ").replaceAll("_", " ") : "None"],
                        ["Call sites", evidenceFor(Array.isArray(service.call_sites) ? service.call_sites : [])],
                      ]}
                    />
                  </Disclosure>
                </section>
              );
            })}
          </Section>

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
            <Section title="Other diagnostics" description="Inconsistencies and unsupported constructs the detectors noted without skipping the input.">
              <Panel flush>
                <DiagnosticTable label="Other diagnostics" diagnostics={diagnostics.notes} />
              </Panel>
            </Section>
          )}

          <Disclosure summary="Details" variant="plain">
            <DescriptionList
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
