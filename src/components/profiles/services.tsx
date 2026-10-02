import type { JsonObject } from "@repo-facts/contract";
import { EvidenceList, evidenceLocation } from "@/components/results/evidence";
import { factText, formatValue } from "@/components/results/value";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Secondary } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import type { ServiceSummary } from "@/lib/profiles/view";
import type { EvidenceContext } from "./category-blocks";
import styles from "./profile.module.css";

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

/** What a Service Dependency's summary reads as: its endpoint, its client, and where it's called. */
export function serviceName(summary: ServiceSummary, records: JsonObject): string {
  const record = summary.callSite ? (records[summary.callSite] as JsonObject | undefined) : undefined;
  return [summary.endpoint.text, summary.client, record ? evidenceLocation(record) : null].filter(Boolean).join(" · ");
}

/** Outbound calls, each a panel whose summary names its endpoint, client, and call site, and whether its boundary is characterized. */
export function ServiceDependencies({ services, context }: { services: readonly ServiceSummary[]; context: EvidenceContext }) {
  return (
    <Section id="services" title="Service Dependencies" description="Outbound calls found in committed source and configuration. Static discovery does not prove entitlement, reachability, or integrated behavior, so access is unknown for every service.">
      {services.length === 0 && <p className={styles.muted}>No Service Dependency was found.</p>}
      {services.map((summary) => (
        <section key={summary.key} aria-label={serviceName(summary, context.records)}>
          <Disclosure summary={<ServiceSummaryLine summary={summary} context={context} />} aside={<Status state={summary.characterized ? "characterized" : "incomplete"} />}>
            <ServiceDetails summary={summary} context={context} />
          </Disclosure>
        </section>
      ))}
    </Section>
  );
}

function ServiceSummaryLine({ summary, context }: { summary: ServiceSummary; context: EvidenceContext }) {
  const record = summary.callSite ? (context.records[summary.callSite] as JsonObject | undefined) : undefined;
  return (
    <span className={styles.serviceSummary}>
      {summary.endpoint.resolved ? <span className={styles.mono}>{summary.endpoint.text}</span> : <span>{summary.endpoint.text}</span>}
      {summary.endpoint.detail && <span className={styles.secondary}>{summary.endpoint.detail}</span>}
      <span className={styles.muted}>{`called through ${summary.client}`}</span>
      {record && <span className={styles.mono}>{`at ${evidenceLocation(record)}${summary.moreCallSites ? ` and ${summary.moreCallSites} more` : ""}`}</span>}
    </span>
  );
}

function ServiceDetails({ summary, context }: { summary: ServiceSummary; context: EvidenceContext }) {
  const { service } = summary;
  const missing = Array.isArray(service.missing_evidence) ? service.missing_evidence.map(String) : [];
  const access = (service.access ?? {}) as JsonObject;
  return (
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
        ["Call sites", <EvidenceList key="calls" ids={Array.isArray(service.call_sites) ? service.call_sites : []} records={context.records} assessmentId={context.assessmentId} />],
        ["Key", <Tag key="key">{summary.key}</Tag>],
      ]}
    />
  );
}
