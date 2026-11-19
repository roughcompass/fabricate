import Link from "next/link";
import { ProgressPoller } from "@/components/progress-poller";
import { ActionButton } from "@/components/ui/button";
import { countLabel, formatBytes, formatNumber } from "@/components/ui/count";
import { Disclosure } from "@/components/ui/disclosure";
import { pageNumber, param } from "@/lib/web/query";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status, humanize, statusLabel } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import type { Repository } from "@/lib/repositories/repository-records";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { isEnrolled } from "@/lib/previews/access";
import type { BuildPlan, BuildTool, Condition, ConditionId, DecidingFact, PackageVerdict, Refusal } from "@/lib/previews/eligibility";
import { type PreviewBuild, type PreviewPreparation, preparationPackages, preparationRefusal } from "@/lib/previews/records";
import type { RefListing } from "@/lib/previews/refs";
import { listPreviews, packageLabel, preparationOf, previewActivity, previewCount, previewsOfCommit, refLabel, remoteRefsFor, settlePreviewWork } from "@/lib/previews/views";
import { buildPreview, preparePreview } from "../preview-actions";
import { PrepareForm } from "./prepare-form";
import styles from "./previews.module.css";
import { routes } from "@/lib/web/routes";

/** Previews in the list per page; the page is in the address as previews_page. */
const PAGE_SIZE = 20;
/** The most branches and tags the ref choice lists; a commit SHA reaches the rest. */
const MAX_REFS = 1_000;

const CONDITION_LABELS: Record<ConditionId, string> = {
  framework: "Browser framework",
  build_tool: "Build tool",
  package_manager: "Package manager and lockfile",
  node: "Node version",
  build_script: "Build script",
  page: "Page",
};

/**
 * The Repository page's Previews (docs/previews.md, spec "A preview targets
 * a remote ref or commit" and "Preview states and logs are visible"): the
 * choice of a branch, tag, or commit; the preparation the operator asked
 * for, Profiling until it's decided, then why nothing can be previewed or
 * which packages can; and the Repository's previews, newest first. Shown only
 * while previews are on and the Repository's remote is enrolled. The page
 * polls while a preparation or a build is under way.
 */
export async function PreviewsSection({ repository, query }: { repository: Repository; query: Record<string, string | string[] | undefined> }) {
  const config = getConfig();
  if (!isEnrolled(config, repository)) return null;
  const db = getDb();
  settlePreviewWork(db);
  const preparation = preparationOf(db, repository, param(query, "preparation"));
  const total = previewCount(db, repository);
  const { page, pages } = pageNumber(param(query, "previews_page"), total, PAGE_SIZE);
  const previews = listPreviews(db, repository, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const activity = previewActivity(db, repository, preparation?.publicId);
  const listing = await remoteRefsFor(config, repository);
  const pageHref = (number: number) => {
    const params = new URLSearchParams();
    if (preparation) params.set("preparation", preparation.publicId);
    if (number > 1) params.set("previews_page", String(number));
    return `${routes.repository(repository.publicId)}${params.size ? `?${params}` : ""}#previews`;
  };

  return (
    <Section id="previews" title="Previews" description="Build a branch, tag, or commit of this repository and open it in a device frame.">
      {activity.active && <ProgressPoller url={`/api/repositories/${repository.publicId}/previews${preparation ? `?preparation=${preparation.publicId}` : ""}`} version={activity.version} />}
      <Panel>
        <PrepareForm action={preparePreview.bind(null, repository.publicId)} {...refChoice(listing)} />
      </Panel>
      {preparation && <PreparationPanel repository={repository} preparation={preparation} />}
      {total > 0 && (
        <div className={styles.list}>
          <Panel flush>
            <PreviewTable repository={repository} previews={previews} />
          </Panel>
          <Pagination label="Preview pages" page={page} pages={pages} href={pageHref} scrollToTop />
        </div>
      )}
    </Section>
  );
}

/** The ref choice's options: the configured reference, then the remote's branches and tags; and what the list leaves out. */
function refChoice(listing: RefListing): { options: React.ComponentProps<typeof PrepareForm>["options"]; note?: string } {
  const defaultBranch = listing.refs.find((ref) => ref.configured);
  const configured = { value: "configured", label: listing.configured.request.kind === "ref" && listing.configured.request.name === null ? `Default branch${defaultBranch ? ` (${defaultBranch.label})` : ""}` : `${listing.configured.label} (configured)` };
  const others = listing.refs.filter((ref) => !ref.configured);
  const shown = others.slice(0, MAX_REFS);
  const group = (kind: "branch" | "tag", label: string) => {
    const options = shown.filter((ref) => ref.kind === kind).map((ref) => ({ value: ref.name, label: ref.label }));
    return options.length ? [{ label, options }] : [];
  };
  const note =
    listing.unavailable !== null
      ? `The remote's other branches and tags couldn't be listed: ${listing.unavailable}`
      : others.length > shown.length
        ? `The first ${formatNumber(shown.length)} of ${formatNumber(others.length)} other branches and tags are listed. Enter a commit for any other.`
        : undefined;
  return { options: [configured, ...group("branch", "Branches"), ...group("tag", "Tags")], note };
}

/** What the operator chose, as a heading: "main at 1a2b3c4d5e6f", or the commit alone. */
function pinnedTitle(row: Pick<PreviewPreparation, "refName" | "refKind" | "commitSha">): string {
  const ref = refLabel(row);
  return ref ? `${ref} at ${row.commitSha.slice(0, 12)}` : `Commit ${row.commitSha.slice(0, 12)}`;
}

/** The preparation the operator asked for: Profiling, Failed, Not previewable with each failed condition, or the packages that can be built. */
function PreparationPanel({ repository, preparation }: { repository: Repository; preparation: PreviewPreparation }) {
  const title = pinnedTitle(preparation);
  if (preparation.state === "profiling") {
    return <Panel level={3} title={title} description={<StatusLine state="profiling">Reading the commit&apos;s files to decide what can be previewed. Nothing from the repository runs yet.</StatusLine>} />;
  }
  if (preparation.state === "failed") {
    return <Panel level={3} title={title} description={<StatusLine state="failed">{preparation.failure ?? "The commit couldn't be prepared."}</StatusLine>} />;
  }
  const verdicts = preparationPackages(preparation);
  if (preparation.state === "refused") {
    const refusal = preparationRefusal(preparation);
    return (
      <Panel level={3} title={title} description={<StatusLine state="not_previewable">{`${refusal?.reason ?? "No package qualifies for a preview"}. Previews need a client-rendered single-page application whose build produces static files.`}</StatusLine>} flush>
        <RefusalTable refusal={refusal} verdicts={verdicts} />
      </Panel>
    );
  }
  const qualifying = verdicts.filter((verdict) => verdict.qualifies);
  const others = verdicts.filter((verdict) => !verdict.qualifies);
  const existing = previewsOfCommit(getDb(), preparation);
  // One package is built without asking; several wait for the operator's choice.
  const summary = qualifying.length === 1 ? "1 package can be previewed, so its build started." : `${qualifying.length} packages can be previewed. Choose one to build.`;
  return (
    <Panel level={3} title={title} description={<StatusLine state="previewable">{summary}</StatusLine>} flush>
      <Table
        label="Packages that can be previewed"
        head={
          <>
            <Th>Package</Th>
            <Th>Builds with</Th>
            <Th>Preview</Th>
          </>
        }
      >
        {qualifying.map((verdict) => {
          const preview = existing.get(verdict.directory);
          return (
            <tr key={verdict.directory}>
              <Td label="Package">
                <PackageName verdict={verdict} />
              </Td>
              <Td label="Builds with">{verdict.plan ? <span className={styles.plan}>{planSummary(verdict.plan)}</span> : null}</Td>
              <Td label="Preview">
                {preview ? (
                  <span className={styles.previewState}>
                    <Status state={preview.attemptState} size="sm" />
                    <Link href={routes.repositoryPreview(repository.publicId, preview.publicId)}>Open preview</Link>
                  </span>
                ) : (
                  <ActionButton action={buildPreview} fields={{ source: repository.publicId, preparation: preparation.publicId, package: verdict.directory }} size="sm" icon="play" aria-label={`Build preview of ${verdict.name ?? verdict.directory}`}>
                    Build preview
                  </ActionButton>
                )}
              </Td>
            </tr>
          );
        })}
      </Table>
      {others.length > 0 && (
        <div className={styles.others}>
          <Disclosure variant="plain" summary={`${countLabel(others.length, "other package")} can't be previewed`}>
            <ul className={styles.otherList}>
              {others.map((verdict) => (
                <li key={verdict.directory}>
                  <PackageName verdict={verdict} />
                  <span className={styles.muted}>{verdict.conditions.find((condition) => !condition.passed)?.reason}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>
      )}
    </Panel>
  );
}

/** A state and the sentence it introduces, announced politely when the page refreshes into it. */
function StatusLine({ state, children }: { state: string; children: React.ReactNode }) {
  return (
    <span role="status" className={styles.statusLine}>
      <Status state={state}>
        {statusLabel(state)}
        <span className={styles.muted}>{children}</span>
      </Status>
    </span>
  );
}

function PackageName({ verdict }: { verdict: Pick<PackageVerdict, "directory" | "name"> }) {
  return (
    <>
      <Primary>{verdict.name ?? (verdict.directory === "." ? "The repository root" : verdict.directory)}</Primary>
      {verdict.name && <Secondary mono>{verdict.directory === "." ? "Repository root" : verdict.directory}</Secondary>}
    </>
  );
}

const TOOL_LABELS: Record<BuildTool, string> = { vite: "Vite", webpack: "webpack", rspack: "Rspack", rsbuild: "Rsbuild" };

/** How a qualifying package builds: its tool, package manager, and Node, and the kind of microfrontend it is, if any, which shows through its own page like any other application. */
function planSummary(plan: BuildPlan): string {
  const layout = plan.layout === "module_federation" ? ", a Module Federation remote" : plan.layout === "single_spa" ? ", a single-spa application" : "";
  return `${TOOL_LABELS[plan.buildTool]}, ${plan.packageManager.name}${plan.packageManager.version ? ` ${plan.packageManager.version}` : ""}, Node ${plan.node.version}${layout}`;
}

/** Each condition that failed, for each package, with the facts and evidence behind it. */
function RefusalTable({ refusal, verdicts }: { refusal: Refusal | null; verdicts: readonly PackageVerdict[] }) {
  const names = new Map(verdicts.map((verdict) => [verdict.directory, verdict]));
  const conditions = refusal?.conditions ?? [];
  return (
    <Table
      label="Why the commit can't be previewed"
      head={
        <>
          <Th>Package</Th>
          <Th>Condition</Th>
          <Th>Why</Th>
          <Th>Evidence</Th>
        </>
      }
    >
      {conditions.map((condition, index) => {
        const verdict = condition.package === null ? null : (names.get(condition.package) ?? { directory: condition.package, name: null });
        return (
          <tr key={`${condition.package ?? ""}:${condition.condition}:${index}`}>
            <Td label="Package">{verdict ? <PackageName verdict={verdict} /> : <span className={styles.muted}>No package</span>}</Td>
            <Td label="Condition">{CONDITION_LABELS[condition.condition]}</Td>
            <Td label="Why">{condition.reason}</Td>
            <Td label="Evidence">
              <Evidence facts={condition.facts} />
            </Td>
          </tr>
        );
      })}
    </Table>
  );
}

/** Where the deciding facts were found: each location, or the category's state when no fact decided. */
function Evidence({ facts }: { facts: Condition["facts"] }) {
  const locations = [...new Set(facts.flatMap((fact) => fact.evidence.map((evidence) => evidence.location)))];
  if (locations.length) {
    const shown = locations.slice(0, 4);
    return (
      <span className={styles.evidence}>
        {shown.map((location) => (
          <Tag key={location}>{location}</Tag>
        ))}
        {locations.length > shown.length && <span className={styles.muted}>{`and ${locations.length - shown.length} more`}</span>}
      </span>
    );
  }
  const states = facts.map(factState).filter(Boolean);
  return states.length ? <span className={styles.muted}>{states.join("; ")}</span> : <span className={styles.muted}>None</span>;
}

/** A fact without evidence, such as a category with no fact: what it is and its state. */
function factState(fact: DecidingFact): string {
  return `${humanize(fact.category)}${fact.key ? ` ${fact.key}` : ""}: ${statusLabel(fact.state).toLowerCase()}`;
}

/** The Repository's previews, newest first: package, ref, commit, latest attempt, and published size. */
function PreviewTable({ repository, previews }: { repository: Repository; previews: readonly PreviewBuild[] }) {
  return (
    <Table
      label="Previews"
      head={
        <>
          <Th>Package</Th>
          <Th>Ref</Th>
          <Th>Commit</Th>
          <Th>Latest build</Th>
          <Th align="numeric">Size</Th>
        </>
      }
    >
      {previews.map((preview) => {
        const ref = refLabel(preview);
        return (
          <tr key={preview.publicId}>
            <Td label="Package">
              <Primary>
                <Link href={routes.repositoryPreview(repository.publicId, preview.publicId)}>{packageLabel(preview)}</Link>
              </Primary>
              <Secondary>
                Created <RelativeTime value={preview.createdAt} />
              </Secondary>
            </Td>
            <Td label="Ref">{ref ? <Tag>{ref}</Tag> : <span className={styles.muted}>Commit</span>}</Td>
            <Td label="Commit">
              <ShortValue value={preview.commitSha} label="commit" />
            </Td>
            <Td label="Latest build">
              <Status state={preview.attemptState} />
            </Td>
            <Td label="Size" align="numeric">
              {preview.outputBytes === null ? <span className={styles.muted}>None</span> : formatBytes(preview.outputBytes)}
            </Td>
          </tr>
        );
      })}
    </Table>
  );
}
