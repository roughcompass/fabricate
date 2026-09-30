import { type JsonObject, type JsonValue, SHARED_CATEGORIES } from "@repo-facts/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceList } from "@/components/results/evidence";
import styles from "@/components/results/results.module.css";
import { factText, formatValue } from "@/components/results/value";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ShortSha, Timestamp, countLabel } from "@/components/ui/format";
import { Card, DetailsList, Page, PageHeader, Stat, ui } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Mono, Secondary, Table, Td, Th } from "@/components/ui/table";
import { assessmentById } from "@/lib/assessments/lookups";
import { getDb } from "@/lib/db/client";
import { assessmentTargets } from "@/lib/db/schema";
import { findProfile, latestProfileOfSource, profileDiagnostics, profileDocument } from "@/lib/profiles/profile-records";
import { eq } from "drizzle-orm";

export const metadata: Metadata = { title: "Repository Profile" };

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

export default async function ProfilePage({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  const db = getDb();
  const profile = findProfile(db, profileId);
  if (!profile) notFound();
  const target = db.select().from(assessmentTargets).where(eq(assessmentTargets.id, profile.assessmentTargetId)).get()!;
  const assessment = assessmentById(db, profile.assessmentId);
  const document = profileDocument(profile);
  const facts = document.fact_document as JsonObject;
  const categories = (facts.categories ?? {}) as unknown as Record<string, Category>;
  const evidence = (facts.evidence ?? {}) as JsonObject;
  const services = (Array.isArray(facts.service_dependencies) ? facts.service_dependencies : []) as JsonObject[];
  const diagnostics = profileDiagnostics(document);
  const latest = latestProfileOfSource(db, target.sourcePublicId);
  const newer = latest && latest.profile.id !== profile.id ? latest : null;
  const states = SHARED_CATEGORIES.map((definition) => categories[definition.id]?.state ?? "unknown");
  const count = (state: string) => states.filter((item) => item === state).length;
  const groups = [...new Set(SHARED_CATEGORIES.map((definition) => definition.group))];
  const evidenceFor = (ids: JsonValue[] | undefined) => <EvidenceList ids={ids ?? []} records={evidence} assessmentId={assessment.publicId} />;

  return (
    <Page>
      <PageHeader
        title={target.sourceName}
        back={{ href: `/assessments/${assessment.publicId}`, label: `Assessment ${assessment.publicId}` }}
        description={`Repository Profile at commit ${String(document.commit).slice(0, 12)}, from detector release ${String(document.detector_release)}.`}
      />
      <Notice tone="info">Every fact comes from committed files at this commit, read as data. Nothing in the repository was run.</Notice>
      {newer && (
        <Notice tone="info" title="This is a historical Profile">
          {"A newer Profile of this repository exists. This one keeps its original facts, evidence, and detector release. "}
          <Link href={`/profiles/${newer.profile.publicId}`}>View the newest Profile</Link>
        </Notice>
      )}

      <Card title="Summary">
        <div className={ui.stats}>
          <Stat label="Observed" value={count("observed")} />
          <Stat label="Inferred or mixed" value={count("inferred") + count("mixed")} />
          <Stat label="Conflicting" value={count("conflicting")} />
          <Stat label="Unknown" value={count("unknown")} />
          <Stat label="None detected" value={count("absent")} />
        </div>
        <DetailsList
          items={[
            ["Service Dependencies", <Link key="services" href="#services">{countLabel(services.length, "dependency", "dependencies")}</Link>],
            ["Skipped inputs", <Link key="skipped" href="#diagnostics">{countLabel(diagnostics.skipped.length, "input")}</Link>],
            ["Commit", <ShortSha key="commit" sha={String(document.commit)} />],
            ["Detector release", <Mono key="release">{String(document.detector_release)}</Mono>],
            ["Profile digest", <Mono key="digest">{profile.digest.slice(0, 12)}</Mono>],
            ["Created", <Timestamp key="created" value={profile.createdAt} />],
          ]}
        />
      </Card>

      {groups.map((group) => (
        <section key={group} className={styles.group} aria-labelledby={`group-${group}`}>
          <h2 id={`group-${group}`} className={styles.groupTitle}>
            {group}
          </h2>
          {SHARED_CATEGORIES.filter((definition) => definition.group === group).map((definition) => {
            const category = categories[definition.id];
            return (
              <div key={definition.id} id={definition.id}>
                <Card level={3} title={definition.label} description={definition.description} actions={<StatusBadge state={category?.state ?? "unknown"} />} flush={Boolean(category?.facts.length)}>
                  {category?.facts.length ? (
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
                            <Mono>{fact.key}</Mono>
                          </Td>
                          <Td label="Value">
                            {fact.state === "conflicting" ? (
                              <ul className={styles.candidates} aria-label="Candidates">
                                {(fact.candidates ?? []).map((candidate, index) => (
                                  <li key={index} className={styles.value}>
                                    {formatValue(candidate.value)} {evidenceFor(candidate.evidence)}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className={styles.value}>{factText(fact.state, fact.value)}</span>
                            )}
                            {fact.reasoning && <Secondary>{fact.reasoning}</Secondary>}
                          </Td>
                          <Td label="State">
                            <StatusBadge state={fact.state} />
                          </Td>
                          <Td label="Evidence">{evidenceFor(fact.evidence)}</Td>
                        </tr>
                      ))}
                    </Table>
                  ) : category?.state === "absent" ? (
                    <p>{category.search.surface.length ? `None detected after a complete search of ${countLabel(category.search.surface.length, "input")}.` : "None detected: no input this category reads exists in this commit."}</p>
                  ) : category?.search.skipped.length ? (
                    <p>
                      {`Unknown: ${countLabel(category.search.skipped.length, "relevant input")} could not be read or understood, so an absence cannot be claimed. `}
                      <span className={styles.value}>{category.search.skipped.join(", ")}</span>
                    </p>
                  ) : (
                    <p>Unknown: no bounded search can establish this category from committed files, or none of its searches was complete.</p>
                  )}
                </Card>
              </div>
            );
          })}
        </section>
      ))}

      <section className={styles.group} aria-labelledby="service-dependencies" id="services">
        <h2 id="service-dependencies" className={styles.groupTitle}>
          Service Dependencies
        </h2>
        <Notice tone="info" title="Static discovery only">
          These are outbound calls found in committed source and configuration. Static discovery does not prove entitlement, reachability, or integrated behavior, so access is unknown for every service, and no response is fabricated or connection attempted.
        </Notice>
        {services.length === 0 && <p>No Service Dependency was found.</p>}
        {services.map((service) => {
          const missing = Array.isArray(service.missing_evidence) ? service.missing_evidence.map(String) : [];
          const access = (service.access ?? {}) as JsonObject;
          return (
            <Card key={String(service.key)} level={3} title={String(service.key)} description={`Called through ${formatValue(((service.client ?? {}) as JsonObject).kind ?? null)}`} actions={
                <Badge tone={service.characterizable ? "success" : "warning"} icon={service.characterizable ? "checkCircle" : "alert"}>
                  {service.characterizable ? "Boundary characterized" : "Boundary incomplete"}
                </Badge>
              }>
              <DetailsList
                items={[
                  ...SERVICE_FACTS.map(([key, label]): [string, React.ReactNode] => {
                    const fact = (service[key] ?? {}) as JsonObject;
                    const state = String(fact.state ?? "unknown");
                    return [
                      label,
                      <span key={key} className={styles.value}>
                        <StatusBadge state={state} />{" "}
                        {state === "conflicting"
                          ? `Candidates: ${(Array.isArray(fact.candidates) ? fact.candidates : []).map((candidate) => formatValue((candidate as JsonObject).value)).join(" | ")}`
                          : factText(state, fact.value)}
                        {typeof fact.reasoning === "string" && <Secondary>{fact.reasoning}</Secondary>}
                      </span>,
                    ];
                  }),
                  ["Access", <span key="access"><StatusBadge state="unknown" /> {String(access.reason ?? "Not established by static discovery")}</span>],
                  ["Missing evidence", missing.length ? missing.join(", ").replaceAll("_", " ") : "None"],
                  ["Call sites", evidenceFor(Array.isArray(service.call_sites) ? service.call_sites : [])],
                ]}
              />
            </Card>
          );
        })}
      </section>

      <div id="diagnostics">
        <Card title="Skipped inputs" description="Files that were not read or not understood. Facts they could affect are unknown, never absent." flush={diagnostics.skipped.length > 0}>
          {diagnostics.skipped.length ? <DiagnosticTable label="Skipped inputs" diagnostics={diagnostics.skipped} /> : <p>Every input was read and understood.</p>}
        </Card>
      </div>
      {diagnostics.notes.length > 0 && (
        <Card title="Other diagnostics" description="Inconsistencies and unsupported constructs the detectors noted without skipping the input." flush>
          <DiagnosticTable label="Other diagnostics" diagnostics={diagnostics.notes} />
        </Card>
      )}
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
            <Mono>{String(diagnostic.path) || "(repository)"}</Mono>
          </Td>
          <Td label="Reason">
            {String(diagnostic.reason).replaceAll("_", " ")}
            {diagnostic.detector !== null && <Secondary mono>{String(diagnostic.detector)}</Secondary>}
          </Td>
          <Td label="Detail">{String(diagnostic.detail)}</Td>
        </tr>
      ))}
    </Table>
  );
}
