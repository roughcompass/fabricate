import type { Metadata } from "next";
import { DashboardPanel, DashboardTemplate } from "@/components/templates/dashboard-template";
import { Alert } from "@/components/ui/alert";
import { formatNumber } from "@/components/ui/count";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { RelativeTime } from "@/components/ui/relative-time";
import { StatGroup } from "@/components/ui/stat-group";
import { Status, humanize } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue } from "@/components/ui/tag";
import { formatAbsolute } from "@/components/ui/time";
import { type CatalogBuild, catalogBuilds } from "@/lib/catalog/build";
import { BUILD_REASON_LABELS, buildFailureSentence } from "@/lib/catalog/build-outcomes";
import { entriesInUse } from "@/lib/catalog/current";
import type { StoredEntry } from "@/lib/catalog/entries";
import { recipeProgress } from "@/lib/catalog/updates";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { PRODUCT, SURVEYOR_RELEASE_LABEL } from "@/lib/product";
import { nextScheduledChecks } from "@/lib/profiling/check";
import { currentRecipe } from "@/lib/surveys/records";
import { repositoriesHref } from "@/lib/web/list-filters";
import styles from "./system.module.css";

export const metadata: Metadata = { title: "System" };

/** How many recent builds the page lists. */
const BUILDS_SHOWN = 10;

/** A described thing and version, as people name it: "Salt 1.75.0". */
const entryName = (entry: { entryId: string; version: string } | { id: string; version: string }) => `${humanize("entryId" in entry ? entry.entryId : entry.id)} ${entry.version}`;

/**
 * System status (operator-interface/system-status spec), a Dashboard: how far
 * re-surveying has come, as counts that each open the Repositories they
 * count; then the Surveyor release and configuration surveys run with and the
 * next scheduled checks; the recent Catalog builds and their outcomes; and the
 * Reference Catalog entries in use. A latest build that failed is an alert.
 */
export default function SystemPage() {
  const db = getDb();
  const config = getConfig();
  const progress = recipeProgress(db, config);
  const latest = catalogBuilds(db, 1)[0];
  return (
    <DashboardTemplate
      header={{ title: "System", description: `What the ${PRODUCT.name} surveys with, and how far re-surveying has come.` }}
      alerts={
        latest?.state === "failed" && (
          <Alert tone="warning" title={`The latest Catalog build, of ${entryName(latest.request)}, failed`}>
            <p>{buildFailureSentence(latest.failure?.reason ?? "failed")}</p>
            <p>The entries in use below are unchanged.</p>
          </Alert>
        )
      }
      figures={
        <StatGroup
          label="Re-survey progress"
          stats={[
            { label: "Current recipe", value: formatNumber(progress.current), href: repositoriesHref({ recipe: "current" }), hint: "Newest version made with today's recipe" },
            { label: "Waiting", value: formatNumber(progress.waiting), href: repositoriesHref({ recipe: "waiting" }), hint: "On an older recipe, queued, or being surveyed" },
            { label: "Failed", value: formatNumber(progress.failed), href: repositoriesHref({ recipe: "failed" }), hint: "Newest version failed" },
          ]}
        />
      }
    >
      <DashboardPanel title={PRODUCT.surveyor} description="The release and configuration every survey runs with.">
        {surveyorPanel}
      </DashboardPanel>
      <DashboardPanel title="Catalog builds" description="The newest builds of Reference Catalog entries, newest first." flush>
        {buildsPanel}
      </DashboardPanel>
      <DashboardPanel title={`${PRODUCT.referenceCatalog} entries`} description="The entry of each version in use that surveys pick." flush wide>
        {entriesPanel}
      </DashboardPanel>
    </DashboardTemplate>
  );
}

/** The recipe surveys run with, and when the next checks are due. */
function surveyorPanel(): React.ReactNode {
  const recipe = currentRecipe(getConfig());
  const next = nextScheduledChecks(getDb());
  const when = (value: Date | null) => (value ? <time dateTime={value.toISOString()}>{formatAbsolute(value)}</time> : "Not scheduled");
  return (
    <DescriptionList
      items={[
        [SURVEYOR_RELEASE_LABEL, recipe.surveyorRelease],
        ["Profile version", `v${recipe.profileSchemaVersion}`],
        ["Configuration digest", <ShortValue key="digest" value={recipe.configurationDigest} label="configuration digest" />],
        ["Next survey check", when(next.profiling)],
        ["Next Catalog check", when(next.catalog)],
      ]}
    />
  );
}

/** Recent builds, each with why it ran and how it ended. */
function buildsPanel(): React.ReactNode {
  const builds = catalogBuilds(getDb(), BUILDS_SHOWN);
  if (builds.length === 0) return <EmptyState title="No Catalog builds yet">An entry is built for each version Repositories use, and for each newest release.</EmptyState>;
  return (
    <Table
      label="Catalog builds"
      head={
        <>
          <Th>Entry</Th>
          <Th>Outcome</Th>
          <Th>When</Th>
        </>
      }
    >
      {builds.map((build) => (
        <tr key={build.jobId}>
          <Td label="Entry">
            <Primary>{entryName(build.request)}</Primary>
            <Secondary>{BUILD_REASON_LABELS[build.request.reason]}</Secondary>
          </Td>
          <Td label="Outcome">
            <BuildOutcome build={build} />
          </Td>
          <Td label="When">
            <RelativeTime value={build.finishedAt ?? build.queuedAt} />
          </Td>
        </tr>
      ))}
    </Table>
  );
}

/** A build's state, and for a failure what it means, with the Catalog Builder's reason one disclosure away. */
function BuildOutcome({ build }: { build: CatalogBuild }) {
  if (build.state === "failed") {
    return (
      <div className={styles.outcome}>
        <Status state="failed" />
        <Secondary>{buildFailureSentence(build.failure?.reason ?? "failed")}</Secondary>
        {build.failure && (
          <Disclosure summary="Details" variant="plain">
            <DescriptionList
              items={[
                ["Reason", <code key="reason">{build.failure.reason}</code>],
                ["Message", build.failure.message],
                ["Attempts", build.attempts],
              ]}
            />
          </Disclosure>
        )}
      </div>
    );
  }
  if (build.state === "succeeded") return <Status state="succeeded" label={build.entry ? "Built" : "Built, unchanged"} />;
  return <Status state={build.state === "running" ? "building" : "queued"} />;
}

/** The entries surveys pick, each with its kind, sources, build time, and digest. */
function entriesPanel(): React.ReactNode {
  const entries = entriesInUse(getDb(), getConfig());
  if (entries.length === 0) return <EmptyState title="No Reference Catalog entries yet">Repositories are surveyed without design-system recognition until the first entry is built.</EmptyState>;
  return (
    <Table
      label={`${PRODUCT.referenceCatalog} entries`}
      head={
        <>
          <Th>Entry</Th>
          <Th>Sources</Th>
          <Th>Built</Th>
          <Th>Digest</Th>
        </>
      }
    >
      {entries.map((entry) => (
        <EntryRow key={entry.digest} entry={entry} />
      ))}
    </Table>
  );
}

function EntryRow({ entry }: { entry: StoredEntry }) {
  return (
    <tr>
      <Td label="Entry">
        <Primary>{entryName(entry)}</Primary>
        <Secondary>{humanize(entry.kind)}</Secondary>
      </Td>
      <Td label="Sources">
        <ul className={styles.sources}>
          {entry.sources.map((source) => (
            <li key={source.name}>
              {source.name}{" "}
              <span className={styles.version}>{source.snapshot_date ? `as of ${source.snapshot_date}` : /^sha256:/.test(source.version) ? <ShortValue value={source.version.slice("sha256:".length)} label="rules digest" /> : source.version}</span>
            </li>
          ))}
        </ul>
      </Td>
      <Td label="Built">
        <RelativeTime value={entry.builtAt} />
      </Td>
      <Td label="Digest">
        <ShortValue value={entry.digest} label="digest" />
      </Td>
    </tr>
  );
}
