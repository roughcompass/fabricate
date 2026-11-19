import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { ProgressPoller } from "@/components/progress-poller";
import { FlowTemplate } from "@/components/templates/flow-template";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { FormFooter, HiddenFields, TextInput } from "@/components/ui/form";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import { requireApplications } from "@/lib/applications/availability";
import { type OnboardingPackage, onboardingPackages, searchRepositories, suggestedDetails } from "@/lib/applications/onboarding";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { type PreviewPreparation, findPreparation, preparationPackages, preparationRefusal, settleAbandonedPreparations } from "@/lib/previews/records";
import { listRemoteRefs } from "@/lib/previews/refs";
import { type Repository, findRepository } from "@/lib/repositories/repository-records";
import { type Query, param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { RefusalTable } from "../../repositories/[repositoryId]/previews-section";
import { checkBranch, chooseCloneUrl, createAction } from "./actions";
import { BranchForm, CloneUrlForm, DetailsForm, type StepLinks } from "./onboarding-forms";
import { onboardingOrigin } from "./origin";
import styles from "./onboarding.module.css";

export const metadata: Metadata = { title: "New application" };

const STEPS = ["Repository", "Branch", "Eligibility", "Details"] as const;

/** Where onboarding is: what's chosen so far, read from the address. */
interface Choices {
  readonly from?: "repository";
  readonly repository?: Repository;
  readonly branch?: string;
  readonly preparation?: PreviewPreparation;
  readonly package?: string;
}

function readChoices(query: Record<string, string | string[] | undefined>): Choices {
  const db = getDb();
  const repositoryId = param(query, "repository");
  const repository = repositoryId && isPublicId(repositoryId, "src") ? findRepository(db, repositoryId) : undefined;
  const branch = repository ? param(query, "branch")?.slice(0, 255) : undefined;
  const preparationId = branch ? param(query, "preparation") : undefined;
  if (preparationId && isPublicId(preparationId, "ppr")) settleAbandonedPreparations(db);
  const found = preparationId && isPublicId(preparationId, "ppr") ? findPreparation(db, preparationId) : undefined;
  const preparation = found && repository && found.repositoryId === repository.id ? found : undefined;
  return { from: param(query, "from") === "repository" && repository ? "repository" : undefined, repository, branch, preparation, package: preparation ? param(query, "package")?.slice(0, 1_024) : undefined };
}

/** The address of onboarding with +choices+, keeping where it was opened from. */
function href(choices: Choices, extra: Query = {}): string {
  return routes.newApplication({ from: choices.from, repository: choices.repository?.publicId, branch: choices.branch, preparation: choices.preparation?.publicId, package: choices.package, ...extra });
}

/**
 * Onboarding (applications/onboarding spec; design decision 10): a focused
 * Flow, whose back button returns to where it was opened, Applications or a
 * Repository's page. Four steps, each in the address so every one works
 * without JavaScript: the Repository, searched or added by clone URL; the
 * branch to track; its eligibility, checked from a Profile of the branch's
 * commit, showing "Checking…" until it's decided and each failed condition
 * when it's refused, with the package to build when several qualify; and the
 * details, prefilled from the package's manifest, with the trust
 * confirmation and Create application.
 */
export default async function NewApplicationPage({ searchParams }: PageProps<"/applications/new">) {
  requireApplications();
  const query = await searchParams;
  const choices = readChoices(query);
  const cancel = onboardingOrigin(choices.from, choices.repository?.publicId);
  const header = { title: "New application", description: "Build a repository's single-page application from a branch, and keep it built as the branch moves." };

  if (!choices.repository) {
    return (
      <FlowTemplate focused header={header} steps={STEPS} current={1}>
        <RepositoryStep search={param(query, "q") ?? ""} from={choices.from} cancel={cancel} />
      </FlowTemplate>
    );
  }
  if (!choices.preparation) {
    return (
      <FlowTemplate focused header={header} steps={STEPS} current={2}>
        <BranchStep choices={choices} cancel={cancel} />
      </FlowTemplate>
    );
  }
  const packages = choices.preparation.state === "ready" ? onboardingPackages(getDb(), choices.preparation) : [];
  const available = packages.filter((candidate) => candidate.qualifies && !candidate.taken);
  const chosen = packages.find((candidate) => candidate.qualifies && !candidate.taken && candidate.directory === (choices.package ?? (available.length === 1 && packages.filter((other) => other.qualifies).length === 1 ? available[0]!.directory : undefined)));
  if (!chosen) {
    return (
      <FlowTemplate focused header={header} steps={STEPS} current={3}>
        <EligibilityStep choices={choices} packages={packages} cancel={cancel} />
      </FlowTemplate>
    );
  }
  const suggested = await suggestedDetails(choices.preparation, choices.repository, chosen.directory);
  return (
    <FlowTemplate focused header={header} steps={STEPS} current={4}>
      <DetailsStep choices={{ ...choices, package: chosen.directory }} chosen={chosen} suggested={suggested} single={packages.filter((other) => other.qualifies).length === 1} cancel={cancel} />
    </FlowTemplate>
  );
}

function RepositoryStep({ search, from, cancel }: { search: string; from?: string; cancel: string }) {
  const { matches, more } = searchRepositories(getDb(), search);
  return (
    <div className={styles.step}>
      <p className={styles.lead}>Choose the repository the application is built from: search the catalog, or enter a clone URL.</p>
      {/* A plain field in the step's panel, not the bordered search field, since surfaces never nest. */}
      <Form action={routes.newApplication()} className={styles.search} role="search" aria-label="Search Repositories">
        <HiddenFields values={{ from }} />
        <TextInput id="onboarding-search" name="q" type="search" label="Search Repositories" placeholder="Search by name or clone URL" defaultValue={search} />
        <div>
          <Button type="submit" icon="search">
            Search
          </Button>
        </div>
      </Form>
      {search && (
        <>
          {matches.length > 0 ? (
            <ul className={styles.choices} aria-label="Matching Repositories">
              {matches.map((repository) => (
                <li key={repository.publicId} className={styles.choice}>
                  <span className={styles.choiceText}>
                    <span className={styles.choiceName}>{repository.name}</span>
                    <span className={styles.muted}>{repository.cloneUrl}</span>
                  </span>
                  <ButtonLink href={routes.newApplication({ repository: repository.publicId, from })} aria-label={`Choose ${repository.name}`}>
                    Choose
                  </ButtonLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>{`No Repository's name or clone URL contains “${search}”. Enter its clone URL below to add it.`}</p>
          )}
          {more && <p className={styles.muted}>More Repositories match. Search for more of the name to narrow them.</p>}
        </>
      )}
      <section className={styles.part} aria-labelledby="onboarding-clone-url-heading">
        <h3 id="onboarding-clone-url-heading" className={styles.partTitle}>
          Or enter a clone URL
        </h3>
        <CloneUrlForm action={chooseCloneUrl} from={from} />
      </section>
      <FormFooter>
        <ButtonLink href={cancel}>Cancel</ButtonLink>
      </FormFooter>
    </div>
  );
}

async function BranchStep({ choices, cancel }: { choices: Choices; cancel: string }) {
  const repository = choices.repository!;
  const listing = await listRemoteRefs(repository);
  const remote = listing.unavailable ? null : listing.refs.filter((ref) => ref.kind === "branch");
  // The configured reference first and preselected (spec, "The tracked branch is chosen").
  const configured = remote?.find((ref) => ref.configured)?.label ?? repository.gitRef ?? undefined;
  const branches = remote && remote.map((ref) => ref.label);
  const links: StepLinks = { cancel, previous: routes.newApplication({ from: choices.from }) };
  return (
    <div className={styles.step}>
      <Chosen choices={choices} />
      {listing.unavailable && (
        <Alert tone="warning" title="The remote's branches couldn't be listed">
          {listing.unavailable}
        </Alert>
      )}
      <BranchForm action={checkBranch} repository={repository.publicId} branches={branches} initial={choices.branch ?? configured ?? ""} links={links} from={choices.from} />
    </div>
  );
}

function EligibilityStep({ choices, packages, cancel }: { choices: Choices; packages: readonly OnboardingPackage[]; cancel: string }) {
  const preparation = choices.preparation!;
  const links: StepLinks = { cancel, previous: href({ ...choices, preparation: undefined, package: undefined }) };
  const qualifying = packages.filter((candidate) => candidate.qualifies);
  return (
    <div className={styles.step}>
      <Chosen choices={choices} />
      {preparation.state === "profiling" && (
        <>
          <p role="status" className={styles.checking}>
            <Status state="profiling" label="Checking…" />
            <span className={styles.muted}>{`Surveying ${preparation.commitSha.slice(0, 7)} to decide whether it can be previewed. This page updates when it's decided.`}</span>
          </p>
          <ProgressPoller url={`/api/applications/eligibility?preparation=${preparation.publicId}`} version={`${preparation.state}:${preparation.requestedAt.getTime()}`} intervalMs={2_000} />
          <noscript>
            <Link href={href(choices)}>Check again</Link>
          </noscript>
        </>
      )}
      {preparation.state === "failed" && (
        <Alert tone="error" title="The commit couldn't be checked">
          {preparation.failure}
        </Alert>
      )}
      {preparation.state === "refused" && (
        <>
          <Alert tone="error" title={`${choices.repository!.name} can't become an application`}>
            Applications need a client-rendered single-page application whose build produces static files. Each failed condition is below, with the facts behind it.
          </Alert>
          <RefusalTable refusal={preparationRefusal(preparation)} verdicts={preparationPackages(preparation)} label="Why the branch can't become an application" />
        </>
      )}
      {preparation.state === "ready" && <PackageChoice choices={choices} packages={packages} qualifying={qualifying} />}
      <FormFooter>
        <ButtonLink href={cancel}>Cancel</ButtonLink>
        <ButtonLink href={links.previous!}>Previous</ButtonLink>
      </FormFooter>
    </div>
  );
}

/** The packages that can be previewed: one to choose, each that's already an application linked to it; those that can't, with the reason. */
function PackageChoice({ choices, packages, qualifying }: { choices: Choices; packages: readonly OnboardingPackage[]; qualifying: readonly OnboardingPackage[] }) {
  const others = packages.filter((candidate) => !candidate.qualifies);
  return (
    <>
      <p className={styles.lead}>{qualifying.length === 1 ? "This package can be previewed." : `${qualifying.length} packages can be previewed. Choose the one that becomes the application.`}</p>
      <Table
        label="Packages that can be previewed"
        head={
          <>
            <Th>Package</Th>
            <Th>Built with</Th>
            <Th align="actions">Application</Th>
          </>
        }
      >
        {qualifying.map((candidate) => (
          <tr key={candidate.directory}>
            <Td label="Package">
              <Primary>{candidate.name ?? candidate.directory}</Primary>
              <Secondary mono>{candidate.directory === "." ? "The repository root" : candidate.directory}</Secondary>
            </Td>
            <Td label="Built with">{[...candidate.traits.frameworks, candidate.traits.buildTool, candidate.traits.packageManager].filter(Boolean).join(" · ")}</Td>
            <Td label="Application" align="actions">
              {candidate.taken ? (
                <span>
                  Already <Link href={routes.application(candidate.taken.slug)}>{candidate.taken.name}</Link>
                </span>
              ) : (
                <ButtonLink href={href({ ...choices, package: candidate.directory })} aria-label={`Choose ${candidate.name ?? candidate.directory}`}>
                  Choose
                </ButtonLink>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      {others.length > 0 && <p className={styles.muted}>{`${others.length === 1 ? "One other package can't" : `${others.length} other packages can't`} be previewed: ${others.map((candidate) => `${candidate.name ?? candidate.directory} (${candidate.reason ?? "it doesn't qualify"})`).join("; ")}.`}</p>}
    </>
  );
}

function DetailsStep({ choices, chosen, suggested, single, cancel }: { choices: Choices; chosen: OnboardingPackage; suggested: { name: string; description: string }; single: boolean; cancel: string }) {
  const preparation = choices.preparation!;
  const links: StepLinks = { cancel, previous: single ? href({ ...choices, preparation: undefined, package: undefined }) : href({ ...choices, package: undefined }) };
  return (
    <div className={styles.step}>
      <DescriptionList
        items={[
          ["Repository", <ChangeLink key="repository" href={routes.newApplication({ from: choices.from })} label="Change the repository">{choices.repository!.name}</ChangeLink>],
          [
            "Branch",
            <ChangeLink key="branch" href={href({ ...choices, preparation: undefined, package: undefined })} label="Change the branch">
              <Tag>{choices.branch}</Tag> at <ShortValue value={preparation.commitSha} length={7} label="commit" />
            </ChangeLink>,
          ],
          ["Package", single ? (chosen.name ?? chosen.directory) : <ChangeLink key="package" href={href({ ...choices, package: undefined })} label="Change the package">{chosen.name ?? chosen.directory}</ChangeLink>],
          ["Built with", [...chosen.traits.frameworks, chosen.traits.buildTool, chosen.traits.packageManager].filter(Boolean).join(" · ")],
        ]}
      />
      <DetailsForm
        action={createAction}
        hidden={{ repository: choices.repository!.publicId, branch: choices.branch!, preparation: preparation.publicId, package: chosen.directory }}
        initial={suggested}
        links={links}
      />
    </div>
  );
}

/** What the review shows for a value, with a link back to the step that chose it. */
function ChangeLink({ href: to, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <span className={styles.changeable}>
      <span>{children}</span>
      <Link href={to} aria-label={label}>
        Change
      </Link>
    </span>
  );
}

/** The Repository and branch chosen so far, above the step's own content. */
function Chosen({ choices }: { choices: Choices }) {
  return (
    <p className={styles.chosen}>
      <span>
        Repository <strong>{choices.repository!.name}</strong>
      </span>
      {choices.preparation && (
        <span>
          Branch <Tag>{choices.branch}</Tag> at <ShortValue value={choices.preparation.commitSha} length={7} label="commit" />
        </span>
      )}
    </p>
  );
}
