import type { Metadata } from "next";
import { Button, ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { MediaCard } from "@/components/ui/media-card";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Tag } from "@/components/ui/tag";
import { getDb } from "@/lib/db/client";
import { listApplications } from "@/lib/demo/applications";
import { BITBUCKET_HOST } from "@/lib/demo/bitbucket";
import { BRANDS, BRAND_IDS, type BrandId, TEMPLATES } from "@/lib/demo/catalog";
import { BITBUCKET_PROJECTS, projectByKey, repositoriesIn } from "@/lib/demo/catalog/repositories";
import { galleryOrder } from "@/lib/demo/gallery";
import { requireDemo } from "@/lib/demo/guard";
import { chipTemplates, importHref, nextChipSet, parseChipSet } from "@/lib/demo/prompt";
import { currentWorkspace } from "@/lib/demo/request";
import { resetDemo } from "../templates/actions";
import { demoOutcome } from "../templates/outcomes";
import { TemplateBadges } from "../templates/template-badges";
import { submitPrompt } from "./actions";
import { CreateHints } from "./create-hints";
import { PromptBar } from "./prompt-bar";
import styles from "./new.module.css";

export const metadata: Metadata = { title: "Let's build something new" };

type Params = Record<string, string | string[] | undefined>;

interface CreateState {
  readonly brand: BrandId;
  readonly chips: number;
  readonly bitbucket: boolean;
  readonly project: string;
}

const DEFAULT_BRAND: BrandId = "payments";
const DEFAULT_PROJECT = BITBUCKET_PROJECTS[0]!.key;
const BUILD_COUNT = 4;

function parseState(params: Params): CreateState {
  const brand = param(params, "brand");
  const project = param(params, "project");
  return {
    brand: BRAND_IDS.find((id) => id === brand) ?? DEFAULT_BRAND,
    chips: parseChipSet(params.chips),
    bitbucket: param(params, "provider") === "bitbucket",
    project: project && projectByKey(project) ? project : DEFAULT_PROJECT,
  };
}

/** The create page's address for a state, leaving out the defaults. */
function createHref(state: CreateState, hash = ""): string {
  const params = new URLSearchParams();
  if (state.brand !== DEFAULT_BRAND) params.set("brand", state.brand);
  if (state.chips) params.set("chips", String(state.chips));
  if (state.bitbucket) params.set("provider", "bitbucket");
  if (state.bitbucket && state.project !== DEFAULT_PROJECT) params.set("project", state.project);
  return `/new${params.size ? `?${params}` : ""}${hash}`;
}

/** Query values a filter keeps when it changes something else on the page. */
function keepFor(state: CreateState, omit: "brand" | "project"): Record<string, string> {
  const keep: Record<string, string> = {};
  if (omit !== "brand" && state.brand !== DEFAULT_BRAND) keep.brand = state.brand;
  if (state.chips) keep.chips = String(state.chips);
  if (state.bitbucket) keep.provider = "bitbucket";
  if (omit !== "project" && state.bitbucket && state.project !== DEFAULT_PROJECT) keep.project = state.project;
  return keep;
}

const UPDATED = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function CreatePage({ searchParams }: { searchParams: Promise<Params> }) {
  requireDemo();
  const params = await searchParams;
  const state = parseState(params);
  const chips = chipTemplates(state.chips);
  const solutions = galleryOrder(TEMPLATES.filter((template) => template.brand === state.brand)).slice(0, BUILD_COUNT);
  const workspace = await currentWorkspace();
  const existing = new Set(workspace ? listApplications(getDb(), workspace.id).map((application) => `${application.bitbucketProject}/${application.bitbucketRepository}`) : []);
  const project = projectByKey(state.project)!;

  return (
    <Page>
      <PageHeader
        title="Let's build something new"
        description="Describe what you need, import a repository from the demo's BitBucket, or start from a template."
        secondaryActions={[{ href: "/applications", label: "View applications", icon: "layers" }]}
        extraActions={
          <ConfirmDialog
            action={resetDemo}
            trigger={{ label: "Reset demo", icon: "undo" }}
            menu={{ label: "More actions", variant: "secondary", size: "md" }}
            title="Reset the demo?"
            confirmLabel="Reset demo"
            tone="danger"
          >
            <p>Your applications, comments, and share links are removed. The templates and other visitors&apos; work are not affected.</p>
          </ConfirmDialog>
        }
        alerts={<OutcomeToast outcome={demoOutcome(param(params, "notice"))} strip={["notice"]} />}
      />

      <section className={styles.start} aria-label="Start building" data-hint-target="prompt">
        <PromptBar action={submitPrompt} placeholder={`A payments dashboard, or https://${BITBUCKET_HOST}/projects/PAY/repos/payee-hub`} />
        <div className={styles.chips}>
          <ul className={styles.chipList} aria-label="Quick-start templates">
            {chips.map((template) => (
              <li key={template.slug}>
                <ButtonLink href={`/templates/${template.slug}`} size="sm">
                  {template.title}
                </ButtonLink>
              </li>
            ))}
          </ul>
          <ButtonLink href={createHref({ ...state, chips: nextChipSet(state.chips) })} size="sm" variant="tertiary" icon="refresh" label="Show other templates" scroll={false} />
        </div>
      </section>

      <div className={styles.columns}>
        <div data-hint-target="import">
          <Panel
            title="Import Git Repository"
            description={state.bitbucket ? `Repositories in the demo's BitBucket, ${BITBUCKET_HOST}.` : "Choose where the repository lives. Imports are simulated."}
            actions={state.bitbucket ? <ButtonLink href={createHref({ ...state, bitbucket: false })} size="sm" variant="tertiary" scroll={false}>Change provider</ButtonLink> : undefined}
          >
            {state.bitbucket ? (
              <div className={styles.import} id="import">
                <FilterBar action="/new" label="BitBucket project" filtered={false} clearHref={createHref(state)} keep={keepFor(state, "project")}>
                  <Select id="import-project" name="project" label="Project" size="sm" defaultValue={state.project} options={BITBUCKET_PROJECTS.map((entry) => ({ value: entry.key, label: `${entry.key} · ${entry.name}` }))} />
                </FilterBar>
                <ul className={styles.repositories} aria-label={`Repositories in ${project.key}`}>
                  {repositoriesIn(project.key).map((repository) => {
                    const key = `${repository.project}/${repository.name}`;
                    return (
                      <li key={key} className={styles.repository} data-repository={key}>
                        <Icon name="git" size={16} className={styles.repositoryIcon} />
                        <span className={styles.repositoryText}>
                          <span className={styles.repositoryName}>{repository.name}</span>
                          <span className={styles.repositoryMeta}>{`${repository.description} Updated ${UPDATED.format(new Date(`${repository.updated}T00:00:00Z`))} on ${repository.defaultBranch}.`}</span>
                        </span>
                        {existing.has(key) && <Tag sans>In your workspace</Tag>}
                        <ButtonLink href={importHref(repository.project, repository.name)} size="sm" aria-label={`Import ${key}`}>
                          Import
                        </ButtonLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <ul className={styles.providers} aria-label="Git providers">
                <li>
                  <ButtonLink href={createHref({ ...state, bitbucket: true }, "#import")} icon="git" variant="primary">
                    Continue with BitBucket
                  </ButtonLink>
                </li>
                {["GitHub", "GitLab"].map((provider) => (
                  <li key={provider} className={styles.unavailable}>
                    <Button icon="git" disabled aria-describedby={`provider-${provider.toLowerCase()}-note`}>
                      {`Continue with ${provider}`}
                    </Button>
                    <span id={`provider-${provider.toLowerCase()}-note`} className={styles.note}>
                      Unavailable in the demo
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div data-hint-target="solutions">
          <Section
            title="Build your solution"
            description={`Templates for the ${BRANDS[state.brand].portalName} portal.`}
            actions={
              <FilterBar action="/new" label="Brand" filtered={false} clearHref={createHref(state)} keep={keepFor(state, "brand")}>
                <Select id="build-brand" name="brand" label="Brand" hideLabel size="sm" defaultValue={state.brand} options={BRAND_IDS.map((id) => ({ value: id, label: BRANDS[id].label }))} />
              </FilterBar>
            }
          >
            <ul className={styles.solutions} aria-label={`${BRANDS[state.brand].label} templates`}>
              {solutions.map((template) => (
                <li key={template.slug}>
                  <MediaCard title={template.title} description={template.description} image={template.preview} href={`/templates/${template.slug}`} footer={<TemplateBadges template={template} />} />
                </li>
              ))}
            </ul>
            <div className={styles.browseAll}>
              <ButtonLink href={`/templates?brand=${state.brand}`} variant="secondary" icon="arrowRight" aria-label={`Browse all ${BRANDS[state.brand].label} templates`}>
                Browse all
              </ButtonLink>
            </div>
          </Section>
        </div>
      </div>
      <CreateHints key={JSON.stringify(workspace?.hints ?? {})} initial={workspace?.hints ?? {}} />
    </Page>
  );
}
