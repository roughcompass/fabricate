import Image from "next/image";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status, statusLabel } from "@/components/ui/status";
import { SubmitButton } from "@/components/ui/submit-button";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, TagList } from "@/components/ui/tag";
import { BRANDS, PROVIDERS } from "@/lib/demo/catalog";
import { ORIGINS } from "@/lib/demo/gallery";
import { prototypeTemplateImage } from "@/lib/demo/gallery-templates";
import { getDb } from "@/lib/db/client";
import { type ControlRecheck, type TemplateStanding, combinedRecheckStatus, controlRecheck, templateStanding } from "@/lib/prototypes/conformance";
import { templatesAvailable } from "@/lib/prototypes/guard";
import { failingGates } from "@/lib/prototypes/rechecks";
import { checkSummary, formatFit } from "@/lib/prototypes/summary";
import { type AcceptedTemplate, attribution } from "@/lib/prototypes/templates";
import { startFromTemplateAction } from "./actions";
import styles from "../templates.module.css";

const GATE_LABELS: Record<string, string> = { typecheck: "typecheck", "salt-only": "Salt-only", "salt-usage": "Salt usage", build: "build" };

/** The gates a Broken re-check failed, as a phrase, such as "the typecheck gate". */
export function failingGatesPhrase(template: Pick<AcceptedTemplate, "recheck">): string {
  const names = failingGates(template.recheck).map((result) => GATE_LABELS[result.gate] ?? result.gate);
  return `the ${names.join(" and ")} ${names.length === 1 ? "gate" : "gates"}`;
}

/**
 * A template accepted from a prototype (template-gallery spec): its latest template version, who
 * accepted it (unverified) and when, its personas and evidence, what it was
 * checked against, its re-check status, and every template version. Use
 * template starts a prototype from the latest version, and Generate
 * variations opens New prototype with it attached as variant 0; both are
 * unavailable while that version is Broken.
 */
export function PrototypeTemplateDetail({ template, notice }: { template: AcceptedTemplate; notice: string | undefined }) {
  const { latest, recheck } = template;
  const { snapshot } = latest;
  const summary = checkSummary({ status: "ready", gatesPassed: true, gates: snapshot.gates, audit: snapshot.audit, fit: snapshot.fit });
  const broken = recheck?.status === "broken";
  // Standards live in SQLite, which only the deployments that offer Accept have.
  const standing = templatesAvailable() ? templateStanding(getDb(), latest.standards) : null;
  // A Control that regressed marks the template Regressed unless its gates make it Broken.
  const controls = standing && recheck ? controlRecheck(getDb(), latest.standards, recheck.standards) : null;
  const status = recheck?.status ? combinedRecheckStatus(recheck.status, controls) : null;
  const changed = recheck && status && status !== "unchanged" ? { status, saltRelease: recheck.saltRelease } : null;
  return (
    <Page>
      <OutcomeToast
        outcome={
          notice === "limit"
            ? { id: `limit:${template.id}`, tone: "error", title: "This workspace holds as many prototypes as it can.", description: "Delete one to start another from this template." }
            : notice === "broken"
              ? { id: `broken:${template.id}`, tone: "error", title: "This template can't be used right now.", description: "It fails its checks on the current Salt release." }
              : undefined
        }
        strip={["notice"]}
      />
      <PageHeader
        breadcrumbs={[{ href: "/templates", label: "Salt Patterns" }]}
        title={latest.title}
        description={latest.description}
        alerts={
          broken && (
            <Alert tone="error" title={`Broken on Salt ${recheck.saltRelease}`}>
              {`It fails ${failingGatesPhrase(template)} on the current Salt release, so Use template is unavailable until a fixed version is accepted.`}
            </Alert>
          )
        }
        extraActions={
          <>
            <ButtonLink href={`/templates/${template.slug}/preview`} icon="eye">
              Preview template
            </ButtonLink>
            {/* Like Use template, unavailable while the latest version is Broken. */}
            {!broken && (
              <ButtonLink href={`/prototypes/new?${new URLSearchParams({ template: template.id })}`} icon="sparkle">
                Generate variations
              </ButtonLink>
            )}
          </>
        }
        primaryAction={
          <form action={startFromTemplateAction}>
            <input type="hidden" name="template" value={template.id} />
            <input type="hidden" name="slug" value={template.slug} />
            <SubmitButton icon="plus" pendingLabel="Starting" disabled={broken}>
              Use template
            </SubmitButton>
          </form>
        }
      />

      <div className={styles.detail}>
        <div className={styles.overview}>
          <DescriptionList
            surface
            items={[
              ["Brand", BRANDS[latest.brand].label],
              ["Provider", PROVIDERS.community.label],
              ["Origin", ORIGINS.prototypes.label],
              ["Version", `v${latest.number}, from ${snapshot.prototypeName} v${snapshot.number}`],
              ["Accepted by", attribution(latest.acceptedBy)],
              ["Accepted", <RelativeTime key="accepted" value={latest.acceptedAt} />],
              ["Personas", snapshot.personas.length ? snapshot.personas.map((persona) => `${persona.name}, ${persona.role}`).join("; ") : "None"],
              ["Checks", summary.text],
              ["Average fit", snapshot.fit?.average != null ? formatFit(snapshot.fit.average) : "Not reviewed"],
              ["Checked against", `Salt ${latest.reproducibility.saltRelease}`],
              ...(standing ? ([["Standards", <Status key="standards" state={standing.status} label={standing.status === "meets" ? "Meets selected Standards" : undefined} />]] as const) : []),
              ...(changed ? ([["Re-check", <Status key="recheck" state={`recheck_${changed.status}`} label={`${statusLabel(`recheck_${changed.status}`)} on Salt ${changed.saltRelease}`} />]] as const) : []),
              ["Tags", <TagList key="tags" values={latest.tags} />],
            ]}
          />
          {changed && changed.status !== "broken" && <RecheckWarnings template={template} />}
          {controls && <ControlChanges controls={controls} />}
          {broken && <RecheckFailures template={template} />}
        </div>
        <figure className={styles.preview}>
          <Image src={prototypeTemplateImage(template.id)} alt={`${latest.title}, a page from Prototypes in the common Salt page shell`} fill unoptimized sizes="(max-width: 767px) 100vw, 800px" className={styles.previewImage} />
        </figure>
      </div>

      {standing && <StandardsSection standing={standing} />}

      <Section title="Version history" description="Every template version, newest first. A version never changes once it is accepted.">
        <Panel flush>
          <Table
            label="Template versions"
            head={
              <>
                <Th>Version</Th>
                <Th>From</Th>
                <Th>Accepted by</Th>
                <Th>Checked against</Th>
                <Th>Check digest</Th>
              </>
            }
          >
            {template.versions.map((version) => (
              <tr key={version.id} data-template-version={version.number}>
                <Td label="Version">
                  <Primary>{`v${version.number}`}</Primary>
                  <Secondary>
                    <RelativeTime value={version.acceptedAt} />
                  </Secondary>
                </Td>
                <Td label="From">{`${version.snapshot.prototypeName} v${version.snapshot.number}`}</Td>
                <Td label="Accepted by">{attribution(version.acceptedBy)}</Td>
                <Td label="Checked against">
                  <Primary>{`Salt ${version.reproducibility.saltRelease}`}</Primary>
                  <Secondary>{`Registry ${version.reproducibility.registryRelease} · Kit ${version.reproducibility.kitVersion} · Checks v${version.reproducibility.checksVersion}`}</Secondary>
                </Td>
                <Td label="Check digest">
                  <ShortValue value={version.reproducibility.checkDigest} label="check digest" />
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </Section>
    </Page>
  );
}

const OUTCOME_COLUMNS = [
  ["meets", "Meets"],
  ["gap", "Gap"],
  ["indeterminate", "Indeterminate"],
  ["not_applicable", "Not applicable"],
] as const;

/** The latest version's Evaluation against Salt Patterns' Releases: each Release's Finding counts, each linked to those Findings, or why it isn't evaluated. */
export function StandardsSection({ standing, hero = false }: { standing: TemplateStanding; hero?: boolean }) {
  if (standing.status === "not_evaluated") {
    return (
      <Section title="Standards" description={hero ? "What its page, as its reference deployment renders it, is held to." : "What the latest version was held to when it was accepted."}>
        <p className={styles.standardsReason} data-standards="not-evaluated">
          {`Not evaluated. ${standing.reason}`} <Link href="/standards/new">Salt starters</Link> in the Standard Library can be selected on <Link href="/assessments/ini_saltpatterns0000">Salt Patterns</Link> to evaluate {hero ? "it" : "later acceptances"}.
        </p>
      </Section>
    );
  }
  return (
    <Section title="Standards" description={hero ? "The Releases its page meets. Each count opens those Findings." : "The Releases the latest version met when it was accepted. Each count opens those Findings."}>
      <Panel flush>
        <Table
          label="Standard Releases"
          head={
            <>
              <Th>Release</Th>
              {OUTCOME_COLUMNS.map(([, label]) => (
                <Th key={label} align="numeric">
                  {label}
                </Th>
              ))}
            </>
          }
        >
          {standing.releases.map((release) => (
            <tr key={release.publicId} data-standards-release={release.label}>
              <Td label="Release">
                <Primary>{release.label}</Primary>
                <Secondary>{release.publicId}</Secondary>
              </Td>
              {OUTCOME_COLUMNS.map(([outcome, label]) => (
                <Td key={outcome} label={label} align="numeric">
                  <Link href={`/evaluations/${standing.evaluationId}?${new URLSearchParams({ release: String(release.position), outcome })}`} aria-label={`${release.counts[outcome]} ${label}, ${release.label}`}>
                    {release.counts[outcome]}
                  </Link>
                </Td>
              ))}
            </tr>
          ))}
        </Table>
      </Panel>
    </Section>
  );
}

const OUTCOME_WORDS: Record<string, string> = { meets: "Meets", gap: "Gap", indeterminate: "Indeterminate", not_applicable: "Not applicable" };

/** The Controls a re-check classified differently from acceptance, by name, with their Release. */
function ControlChanges({ controls }: { controls: ControlRecheck }) {
  const regressed = controls.controls.filter((change) => change.status === "regressed");
  const fixed = controls.controls.filter((change) => change.status === "fixed");
  if (controls.status === "pending") return <p className={styles.standardsReason}>Re-evaluating against the Releases it was accepted with…</p>;
  if (regressed.length + fixed.length === 0) return null;
  const list = (title: string, changes: typeof regressed, kind: string) =>
    changes.length > 0 && (
      <>
        <p className={styles.recheckTitle}>{title}</p>
        <ul className={styles.recheckList} data-control-changes={kind}>
          {changes.map((change) => (
            <li key={`${change.release}:${change.key}`}>{`${change.control} (${change.release}): ${OUTCOME_WORDS[change.before] ?? change.before} at acceptance, ${change.after ? (OUTCOME_WORDS[change.after] ?? change.after) : "no result"} now`}</li>
          ))}
        </ul>
      </>
    );
  return (
    <div className={styles.recheck} data-recheck-controls="">
      {list("Controls that regressed", regressed, "regressed")}
      {list("Controls that are fixed", fixed, "fixed")}
    </div>
  );
}

/** What a Regressed or Fixed re-check changed: the warnings it found that acceptance didn't, and the ones that are gone. */
function RecheckWarnings({ template }: { template: AcceptedTemplate }) {
  const key = (gate: string, issue: { code: string; message: string }) => `${gate}:${issue.code}:${issue.message}`;
  const before = new Set(template.latest.snapshot.gates.flatMap((result) => result.warnings.map((warning) => key(result.gate, warning))));
  const now = template.recheck?.gates ?? [];
  const after = new Set(now.flatMap((result) => result.warnings.map((warning) => key(result.gate, warning))));
  const added = now.flatMap((result) => result.warnings.filter((warning) => !before.has(key(result.gate, warning))));
  const gone = template.latest.snapshot.gates.flatMap((result) => result.warnings.filter((warning) => !after.has(key(result.gate, warning))));
  return (
    <div className={styles.recheck} data-recheck-changes="">
      {added.length > 0 && (
        <>
          <p className={styles.recheckTitle}>New warnings</p>
          <ul className={styles.recheckList}>
            {added.map((warning, index) => (
              <li key={`added-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </>
      )}
      {gone.length > 0 && (
        <>
          <p className={styles.recheckTitle}>Warnings that are gone</p>
          <ul className={styles.recheckList}>
            {gone.map((warning, index) => (
              <li key={`gone-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** A Broken re-check's failures, so the upgrade's effect stays visible. */
function RecheckFailures({ template }: { template: AcceptedTemplate }) {
  return (
    <div className={styles.recheck} data-recheck-failures="">
      {failingGates(template.recheck).map((result) => (
        <div key={result.gate}>
          <p className={styles.recheckTitle}>{`${GATE_LABELS[result.gate] ?? result.gate} failed`}</p>
          <ul className={styles.recheckList}>
            {result.issues.map((issue, index) => (
              <li key={index}>{issue.line ? `Line ${issue.line}: ${issue.message}` : issue.message}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
