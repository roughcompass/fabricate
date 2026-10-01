import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/form";
import { MediaCard } from "@/components/ui/media-card";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Section } from "@/components/ui/section";
import { BITBUCKET_HOST } from "@/lib/demo/bitbucket";
import { BRANDS, BRAND_IDS, type BrandId, TEMPLATES } from "@/lib/demo/catalog";
import { galleryOrder } from "@/lib/demo/gallery";
import { requireDemo } from "@/lib/demo/guard";
import { chipTemplates, nextChipSet, parseChipSet } from "@/lib/demo/prompt";
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
}

const DEFAULT_BRAND: BrandId = "payments";
const BUILD_COUNT = 4;

function parseState(params: Params): CreateState {
  const brand = param(params, "brand");
  return { brand: BRAND_IDS.find((id) => id === brand) ?? DEFAULT_BRAND, chips: parseChipSet(params.chips) };
}

/** The create page's address for a state, leaving out the defaults. */
function createHref(state: CreateState): string {
  const params = new URLSearchParams();
  if (state.brand !== DEFAULT_BRAND) params.set("brand", state.brand);
  if (state.chips) params.set("chips", String(state.chips));
  return `/new${params.size ? `?${params}` : ""}`;
}

/** Query values the brand choice keeps: the chip set. */
function keepFor(state: CreateState): Record<string, string> {
  return state.chips ? { chips: String(state.chips) } : {};
}

export default async function CreatePage({ searchParams }: { searchParams: Promise<Params> }) {
  requireDemo();
  const params = await searchParams;
  const state = parseState(params);
  const chips = chipTemplates(state.chips);
  const solutions = galleryOrder(TEMPLATES.filter((template) => template.brand === state.brand)).slice(0, BUILD_COUNT);
  const workspace = await currentWorkspace();

  return (
    <Page>
      <PageHeader
        title="Let's build something new"
        description="Describe what you need, paste a BitBucket repository URL, or start from a template."
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

      <div data-hint-target="solutions">
        <Section
          title="Build your solution"
          description={`Templates for the ${BRANDS[state.brand].portalName} portal.`}
          actions={
            <FilterBar action="/new" label="Brand" filtered={false} clearHref={createHref(state)} keep={keepFor(state)}>
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
      <CreateHints key={JSON.stringify(workspace?.hints ?? {})} initial={workspace?.hints ?? {}} />
    </Page>
  );
}
