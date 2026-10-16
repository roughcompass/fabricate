import type { Metadata } from "next";
import Form from "next/form";
import { ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { FilterRail } from "@/components/ui/filter-rail";
import { MediaCard } from "@/components/ui/media-card";
import { Page, PageHeader } from "@/components/ui/page";
import { SearchField } from "@/components/ui/search-field";
import { BRANDS, BRAND_IDS, ORIGIN_IDS, PROVIDERS, PROVIDER_IDS } from "@/lib/demo/catalog";
import { EMPTY_QUERY, ORIGINS, filterTemplates, galleryHref, isFiltered, optionCounts, parseGalleryQuery } from "@/lib/demo/gallery";
import { galleryTemplates } from "@/lib/demo/gallery-templates";
import { requireDemo } from "@/lib/demo/guard";
import { INTENT_LENGTH } from "@/lib/prototypes/limits";
import { prototypesEnabled } from "@/lib/prototypes/guard";
import { RUNTIME } from "@/lib/prototypes/render";
import { upgradeReportFor } from "@/lib/prototypes/upgrade-report";
import { TemplateBadges } from "./template-badges";
import styles from "./templates.module.css";

export const metadata: Metadata = { title: "Salt Patterns" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  requireDemo();
  const params = await searchParams;
  const query = parseGalleryQuery(params);
  const all = await galleryTemplates();
  const templates = filterTemplates(query, all);
  const counts = optionCounts(query, all);
  // The Origin group appears only while a template accepted from a prototype is in the gallery.
  const withOrigin = all.some((template) => template.origin === "prototypes");
  const filtered = isFiltered(query);
  const clearHref = galleryHref(EMPTY_QUERY);
  // One way in (converge-templates-and-prototypes, design decision 9): a searched description can become an intent for New prototype.
  // After a Salt upgrade, once every re-check for the current runtime build is done, its report can be downloaded.
  const report = withOrigin && prototypesEnabled() ? await upgradeReportFor(RUNTIME.hash) : null;
  const reportHref = report && !("pending" in report) ? `/api/prototypes/templates/upgrade-report?${new URLSearchParams({ runtime: RUNTIME.hash })}` : null;
  const generateHref = query.search && prototypesEnabled() ? `/prototypes/new?${new URLSearchParams({ intent: query.search.slice(0, INTENT_LENGTH.max) })}` : null;

  return (
    <Page>
      <PageHeader
        title="Salt Patterns"
        description="Jumpstart your app development process with pre-built solutions from DE Web and our community."
        primaryAction={
          <ButtonLink href="/applications/new" variant="primary" icon="plus">
            Add application
          </ButtonLink>
        }
      />

      <Form key={query.search} action="/templates" scroll={false} className={styles.search} role="search" aria-label="Search templates">
        {query.brands.map((brand) => (
          <input key={brand} type="hidden" name="brand" value={brand} />
        ))}
        {query.providers.map((provider) => (
          <input key={provider} type="hidden" name="provider" value={provider} />
        ))}
        {query.origins.map((origin) => (
          <input key={origin} type="hidden" name="origin" value={origin} />
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
            ...(withOrigin ? [{ name: "origin", legend: "Origin", options: ORIGIN_IDS.map((id) => ({ value: id, label: ORIGINS[id].label, count: counts.origin[id] })) }] : []),
          ]}
          selected={{ brand: query.brands, provider: query.providers, origin: query.origins }}
          keep={query.search ? { q: query.search } : {}}
          activeCount={query.brands.length + query.providers.length + query.origins.length}
          filtered={filtered}
          clearHref={clearHref}
        />

        <section className={styles.results} aria-labelledby="templates-results">
          <h2 id="templates-results" className="visually-hidden">
            Salt Patterns
          </h2>
          <p className={styles.count} role="status">{`Showing ${templates.length} of ${countLabel(all.length, "template")}`}</p>
          {reportHref && report && !("pending" in report) && (
            <p className={styles.count} data-upgrade-report="">
              {`Upgrade report for Salt ${report.saltRelease}: `}
              <a href={`${reportHref}&format=md`}>Markdown</a> · <a href={reportHref}>JSON</a>
            </p>
          )}
          {generateHref && templates.length > 0 && (
            <div className={styles.generate} data-generate-prototypes="">
              <p className={styles.count}>{`None of these? Generate Salt prototypes for “${query.search}”.`}</p>
              <ButtonLink href={generateHref} icon="sparkle" size="sm">
                Generate prototypes
              </ButtonLink>
            </div>
          )}

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
                  <>
                    <ButtonLink href={clearHref} variant={generateHref ? "secondary" : "primary"}>
                      Clear filters
                    </ButtonLink>
                    {generateHref && (
                      <ButtonLink href={generateHref} variant="primary" icon="sparkle">
                        Generate prototypes
                      </ButtonLink>
                    )}
                  </>
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

