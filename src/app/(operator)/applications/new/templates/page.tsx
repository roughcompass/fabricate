import type { Metadata } from "next";
import Form from "next/form";
import { ShellHeader } from "@/components/shell/shell-header";
import { ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterRail } from "@/components/ui/filter-rail";
import { MediaCard } from "@/components/ui/media-card";
import { Page } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { SearchField } from "@/components/ui/search-field";
import { Tag } from "@/components/ui/tag";
import { catalogEntries, filterCatalog, kindCounts, parseKinds } from "@/lib/applications/starter-catalog";
import { STARTER_KINDS, STARTER_KIND_LABELS, type StarterKind } from "@/lib/applications/vocabulary";
import { BRANDS, BRAND_IDS, ORIGIN_IDS, PROVIDERS, PROVIDER_IDS } from "@/lib/demo/catalog";
import { type GalleryQuery, ORIGINS, isFiltered, optionCounts, parseGalleryQuery } from "@/lib/demo/gallery";
import { demoEnabled } from "@/lib/demo/guard";
import { INTENT_LENGTH } from "@/lib/prototypes/limits";
import { prototypesEnabled } from "@/lib/prototypes/guard";
import { TemplateBadges } from "../../../templates/template-badges";
import styles from "../../../templates/templates.module.css";
import page from "./catalog.module.css";

export const metadata: Metadata = { title: "Choose a starter or template" };

const BASE = "/applications/new/templates";

/** The catalog's address for a query and kinds, leaving out what's empty. */
function catalogHref(query: GalleryQuery, kinds: readonly StarterKind[]): string {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  for (const brand of query.brands) params.append("brand", brand);
  for (const provider of query.providers) params.append("provider", provider);
  for (const origin of query.origins) params.append("origin", origin);
  for (const kind of kinds) params.append("kind", kind);
  return `${BASE}${params.size ? `?${params}` : ""}`;
}

/**
 * The full catalog Browse all opens (application-creation spec, "Browse all
 * opens the full catalog on a full page"): a focused page with the gallery's
 * search, filter rail, and cards, plus a Kind facet, listing every starter
 * and, while the demo is enabled, every Salt Patterns template. Each card
 * continues to Create Application. While Prototypes is enabled, a searched
 * description also offers Generate prototypes.
 */
export default async function StarterCatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = parseGalleryQuery(params);
  const kinds = parseKinds(params.kind);
  const { entries, startersAvailable } = await catalogEntries();
  const shown = filterCatalog(entries, query, kinds);
  const counts = optionCounts(query, entries);
  const kindCount = kindCounts(entries, query);
  const demo = demoEnabled();
  const withOrigin = entries.some((entry) => entry.origin === "prototypes");
  const filtered = isFiltered(query) || kinds.length > 0;
  const clearHref = BASE;
  const generateHref = query.search && prototypesEnabled() ? `/prototypes/new?${new URLSearchParams({ intent: query.search.slice(0, INTENT_LENGTH.max) })}` : null;

  return (
    <Page>
      <ShellHeader back={{ href: "/applications/new", label: "Back to Let's build something new" }} />
      <div className={page.head}>
        <h1 className={page.title}>Choose a starter or template</h1>
        <p className={page.lede}>{demo ? "Every starter, and every Salt Patterns template. Choosing one continues to Create Application." : "Every starter. Choosing one continues to Create Application."}</p>
      </div>

      <Form key={query.search} action={BASE} scroll={false} className={styles.search} role="search" aria-label="Search starters and templates">
        {query.brands.map((brand) => (
          <input key={brand} type="hidden" name="brand" value={brand} />
        ))}
        {query.providers.map((provider) => (
          <input key={provider} type="hidden" name="provider" value={provider} />
        ))}
        {query.origins.map((origin) => (
          <input key={origin} type="hidden" name="origin" value={origin} />
        ))}
        {kinds.map((kind) => (
          <input key={kind} type="hidden" name="kind" value={kind} />
        ))}
        <SearchField id="catalog-search" name="q" label="Search starters and templates" hideLabel size="lg" placeholder="Search by name, description, or tag" defaultValue={query.search} clearHref={catalogHref({ ...query, search: "" }, kinds)} shortcut="/" />
      </Form>

      <div className={styles.layout}>
        <FilterRail
          key={catalogHref({ ...query, search: "" }, kinds)}
          action={BASE}
          label="Filter starters and templates"
          groups={[
            { name: "kind", legend: "Kind", options: STARTER_KINDS.map((kind) => ({ value: kind, label: STARTER_KIND_LABELS[kind], count: kindCount[kind] })) },
            ...(demo
              ? [
                  { name: "brand", legend: "Brand", options: BRAND_IDS.map((id) => ({ value: id, label: BRANDS[id].label, count: counts.brand[id] })) },
                  { name: "provider", legend: "Provider", options: PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDERS[id].label, count: counts.provider[id] })) },
                ]
              : []),
            ...(withOrigin ? [{ name: "origin", legend: "Origin", options: ORIGIN_IDS.map((id) => ({ value: id, label: ORIGINS[id].label, count: counts.origin[id] })) }] : []),
          ]}
          selected={{ kind: kinds, brand: query.brands, provider: query.providers, origin: query.origins }}
          keep={query.search ? { q: query.search } : {}}
          activeCount={kinds.length + query.brands.length + query.providers.length + query.origins.length}
          filtered={filtered}
          clearHref={clearHref}
        />

        <section className={styles.results} aria-labelledby="catalog-results">
          <h2 id="catalog-results" className="visually-hidden">
            Starters and templates
          </h2>
          <p className={styles.count} role="status">{`Showing ${shown.length} of ${countLabel(entries.length, "starter or template", "starters and templates")}`}</p>
          {!startersAvailable && <p className={styles.count}>The starters couldn&apos;t be read, so only templates are listed.</p>}
          {generateHref && shown.length > 0 && (
            <div className={styles.generate} data-generate-prototypes="">
              <p className={styles.count}>{`None of these? Generate Salt prototypes for “${query.search}”.`}</p>
              <ButtonLink href={generateHref} icon="sparkle" size="sm">
                Generate prototypes
              </ButtonLink>
            </div>
          )}

          {shown.length > 0 ? (
            <ul className={styles.grid} aria-label="Starters and templates">
              {shown.map((entry) => (
                <li key={entry.slug}>
                  <MediaCard
                    title={entry.title}
                    description={entry.description}
                    image={entry.preview}
                    href={`/applications/new/create?${new URLSearchParams({ starter: entry.slug, from: "templates" })}`}
                    footer={
                      entry.starter ? (
                        <>
                          <Tag sans>Starter</Tag>
                          <Tag sans>{STARTER_KIND_LABELS[entry.kind]}</Tag>
                        </>
                      ) : (
                        <TemplateBadges template={entry} />
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Panel flush>
              <EmptyState
                title="Nothing matches"
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
                {query.search ? `No starter or template matches “${query.search}” with the chosen filters.` : "No starter or template matches the chosen filters."}
              </EmptyState>
            </Panel>
          )}
        </section>
      </div>
    </Page>
  );
}
