import type { Metadata } from "next";
import Form from "next/form";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { FilterRail } from "@/components/ui/filter-rail";
import { MediaCard } from "@/components/ui/media-card";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { SearchField } from "@/components/ui/search-field";
import { BRANDS, BRAND_IDS, PROVIDERS, PROVIDER_IDS, TEMPLATES } from "@/lib/demo/catalog";
import { EMPTY_QUERY, filterTemplates, galleryHref, isFiltered, optionCounts, parseGalleryQuery } from "@/lib/demo/gallery";
import { requireDemo } from "@/lib/demo/guard";
import { resetDemo } from "./actions";
import { demoOutcome } from "./outcomes";
import { TemplateBadges } from "./template-badges";
import styles from "./templates.module.css";

export const metadata: Metadata = { title: "Salt Patterns" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  requireDemo();
  const params = await searchParams;
  const query = parseGalleryQuery(params);
  const templates = filterTemplates(query, TEMPLATES);
  const counts = optionCounts(query, TEMPLATES);
  const filtered = isFiltered(query);
  const clearHref = galleryHref(EMPTY_QUERY);

  return (
    <Page>
      <PageHeader
        title="Salt Patterns"
        description="Jumpstart your app development process with pre-built solutions from DE Web and our community."
        extraActions={
          <ConfirmDialog action={resetDemo} trigger={{ label: "Reset demo", icon: "undo" }} menu={{ label: "More actions" }} title="Reset the demo?" confirmLabel="Reset demo" tone="danger">
            {"Your comments, share links, and session profiles are removed. The templates and other visitors' work are not affected."}
          </ConfirmDialog>
        }
        alerts={<OutcomeToast outcome={demoOutcome(param(params, "notice"))} />}
      />

      <Form key={query.search} action="/templates" scroll={false} className={styles.search} role="search" aria-label="Search templates">
        {query.brands.map((brand) => (
          <input key={brand} type="hidden" name="brand" value={brand} />
        ))}
        {query.providers.map((provider) => (
          <input key={provider} type="hidden" name="provider" value={provider} />
        ))}
        <SearchField
          id="template-search"
          name="q"
          label="Search templates"
          hideLabel
          size="lg"
          placeholder="Search by name, description, tag, or author"
          defaultValue={query.search}
          clearHref={galleryHref({ ...query, search: "" })}
        />
      </Form>

      <div className={styles.layout}>
        <FilterRail
          key={galleryHref({ ...query, search: "" })}
          action="/templates"
          label="Filter templates"
          groups={[
            { name: "brand", legend: "Brand", options: BRAND_IDS.map((id) => ({ value: id, label: BRANDS[id].label, count: counts.brand[id] })) },
            { name: "provider", legend: "Provider", options: PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDERS[id].label, count: counts.provider[id] })) },
          ]}
          selected={{ brand: query.brands, provider: query.providers }}
          keep={query.search ? { q: query.search } : {}}
          activeCount={query.brands.length + query.providers.length}
          filtered={filtered}
          clearHref={clearHref}
        />

        <section className={styles.results} aria-labelledby="templates-results">
          <h2 id="templates-results" className="visually-hidden">
            Salt Patterns
          </h2>
          <p className={styles.count} role="status">{`Showing ${templates.length} of ${countLabel(TEMPLATES.length, "template")}`}</p>

          {templates.length > 0 ? (
            <ul className={styles.grid}>
              {templates.map((template) => (
                <li key={template.slug}>
                  <MediaCard
                    title={template.title}
                    description={template.description}
                    image={template.preview}
                    href={`/templates/${template.slug}`}
                    footer={<TemplateBadges template={template} />}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Panel flush>
              <EmptyState
                title="No templates match"
                icon="search"
                action={
                  <ButtonLink href={clearHref} variant="primary">
                    Clear filters
                  </ButtonLink>
                }
              >
                {query.search ? `No template matches “${query.search}” with the chosen filters.` : "No template matches the chosen filters."}
              </EmptyState>
            </Panel>
          )}
        </section>
      </div>
    </Page>
  );
}

