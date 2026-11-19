import type { Metadata } from "next";
import { IndexTemplate } from "@/components/templates/index-template";
import Form from "next/form";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { FilterRail } from "@/components/ui/filter-rail";
import { MediaCard } from "@/components/ui/media-card";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
import { SearchField } from "@/components/ui/search-field";
import { Section } from "@/components/ui/section";
import { BRANDS, BRAND_IDS, PROVIDERS, PROVIDER_IDS, TEMPLATES } from "@/lib/demo/catalog";
import { EMPTY_QUERY, filterTemplates, galleryHref, isFiltered, optionCounts, parseGalleryQuery } from "@/lib/demo/gallery";
import { requireDemo } from "@/lib/demo/guard";
import { resetDemo } from "./actions";
import { demoOutcome } from "./outcomes";
import { TemplateBadges } from "./template-badges";
import styles from "./templates.module.css";
import { HiddenFields } from "@/components/ui/form";

export const metadata: Metadata = { title: "Salt Patterns" };

export default async function TemplatesPage({ searchParams }: PageProps<"/templates">) {
  requireDemo();
  const params = await searchParams;
  const query = parseGalleryQuery(params);
  const templates = filterTemplates(query, TEMPLATES);
  const counts = optionCounts(query, TEMPLATES);
  const filtered = isFiltered(query);
  const clearHref = galleryHref(EMPTY_QUERY);

  return (
    <IndexTemplate
      header={{
        title: "Salt Patterns",
        description: "Jumpstart your app development process with pre-built solutions from DE Web and our community.",
      }}
      alerts={<OutcomeToast outcome={demoOutcome(param(params, "notice"))} />}
      rail={
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
      }
      filters={
        <Form key={query.search} action="/templates" scroll={false} className={styles.search} role="search" aria-label="Search templates">
          <HiddenFields values={{ brand: query.brands, provider: query.providers }} />
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
      }
    >
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
      {/* Resetting removes work, so it isn't a header action: it has its own section, last. */}
      <Section title="Reset the demo" description="Removes your comments, share links, and session profiles, and leaves the templates and other visitors' work as they are.">
        <div>
          <ConfirmDialog action={resetDemo} trigger={{ label: "Reset demo", icon: "undo" }} title="Reset the demo?" confirmLabel="Reset demo" tone="danger">
            {"Your comments, share links, and session profiles are removed. The templates and other visitors' work are not affected."}
          </ConfirmDialog>
        </div>
      </Section>
    </IndexTemplate>
  );
}

