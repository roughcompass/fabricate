import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DetailsTemplate } from "@/components/templates/details-template";
import { countLabel, formatNumber } from "@/components/ui/count";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { StatGroup } from "@/components/ui/stat-group";
import { EmptyRow, Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { designSystemCoverage } from "@/lib/adoption/fleet";
import { type ComponentAdoption, componentAdoption } from "@/lib/adoption/queries";
import type { TrackedDesignSystem } from "@/lib/adoption/tracked";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { oneOf, pageNumber, pageQuery, param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { CoverageAlert, RepositoryLinks, describedDesignSystems, publishedAsOf, shareLabel } from "../../../../shared";
import styles from "../../../../adoption.module.css";

const VIEWS = ["overview", "repositories"] as const;

/** The component and its design system, or null when either isn't tracked or the component is neither listed nor used. */
function load(designSystemId: string, name: string): { tracked: TrackedDesignSystem; adoption: ComponentAdoption } | null {
  const db = getDb();
  const tracked = describedDesignSystems(db, getConfig()).find(({ thing }) => thing.id === designSystemId)?.tracked;
  if (!tracked) return null;
  const adoption = componentAdoption(db, designSystemCoverage(db), tracked, name);
  const listed = tracked.components.some((component) => component.name === name);
  return listed || adoption.repositories.length > 0 ? { tracked, adoption } : null;
}

export async function generateMetadata({ params }: PageProps<"/adoption/design-systems/[designSystemId]/components/[componentName]">): Promise<Metadata> {
  const { designSystemId, componentName } = await params;
  const found = load(designSystemId, decodeURIComponent(componentName));
  return { title: found ? `${found.adoption.name} · ${found.tracked.name} · Adoption` : "Component not found" };
}

/**
 * One component's adoption (adoption-analytics spec, "Each component shows
 * where and how it is used"), on the Details template's hub variant: its
 * figures, the props passed to it with their values, the props no usage
 * passes, and the Repositories with stories of it, then the Repositories that
 * use it, five previewed and all of them in their own view.
 */
export default async function ComponentAdoptionPage({ params, searchParams }: PageProps<"/adoption/design-systems/[designSystemId]/components/[componentName]">) {
  const [{ designSystemId, componentName }, query] = await Promise.all([params, searchParams]);
  const found = load(designSystemId, decodeURIComponent(componentName));
  if (!found) notFound();
  const { tracked, adoption } = found;
  const view = oneOf(query, "view", VIEWS) ?? "overview";
  const href = (target: (typeof VIEWS)[number]) => routes.adoptionComponent(designSystemId, adoption.name, { view: target === "overview" ? null : target });
  const deprecated = tracked.components.find((component) => component.name === adoption.name)?.props.filter((prop) => prop.deprecated).map((prop) => prop.name) ?? [];
  const asOf = publishedAsOf(tracked);

  return (
    <DetailsTemplate
      header={{
        breadcrumbs: [
          { href: routes.adoption, label: "Adoption" },
          { href: routes.adoptionDesignSystem(designSystemId), label: tracked.name },
        ],
        title: adoption.name,
        meta: [...(adoption.package ? [<code key="package">{adoption.package}</code>] : []), `Used in ${countLabel(adoption.repositories.length, "Repository", "Repositories")}`],
        tabs: (
          <Tabs label={`${adoption.name} views`}>
            <TabLink href={href("overview")} active={view === "overview"}>
              Overview
            </TabLink>
            <TabLink href={href("repositories")} active={view === "repositories"} count={adoption.repositories.length}>
              Repositories
            </TabLink>
          </Tabs>
        ),
      }}
      alerts={<CoverageAlert coverage={adoption.coverage} />}
      related={
        view === "overview"
          ? [
              {
                title: "Used by",
                records: adoption.repositories.map(({ repository, usages }) => ({
                  key: repository.publicId,
                  content: (
                    <>
                      <Link href={routes.repository(repository.publicId)}>{repository.name}</Link> <span className={styles.muted}>{`${countLabel(usages.app, "usage")} in app code`}</span>
                    </>
                  ),
                })),
                all: { href: href("repositories"), noun: "Repositories", singular: "Repository" },
                empty: "No covered Repository uses it.",
              },
            ]
          : undefined
      }
    >
      {view === "repositories" ? (
        <RepositoriesTable adoption={adoption} requested={param(query, "page")} href={(page) => routes.adoptionComponent(designSystemId, adoption.name, { view: "repositories", page: pageQuery(page) })} />
      ) : (
        <>
          <StatGroup
            label={`${adoption.name} figures`}
            stats={[
              { label: "Usages in app code", value: formatNumber(adoption.usages.app) },
              { label: "In stories", value: formatNumber(adoption.usages.stories) },
              { label: "In tests", value: formatNumber(adoption.usages.tests) },
              { label: "Customized", value: shareLabel(adoption.customized), hint: `${formatNumber(adoption.customized.count)} of ${countLabel(adoption.customized.of, "app usage")}` },
            ]}
          />
          <Section title="Props" description="The props app code passes, and for props with a fixed set of values, each value passed.">
            <Panel flush>
              <Table
                label="Props"
                head={
                  <>
                    <Th>Prop</Th>
                    <Th align="numeric">Usages passing it</Th>
                    <Th>Values passed</Th>
                  </>
                }
              >
                {adoption.props.length === 0 && <EmptyRow columns={3}>No app usage passes a prop that can be read.</EmptyRow>}
                {adoption.props.map((prop) => (
                  <tr key={prop.name}>
                    <Td label="Prop">
                      <code>{prop.name}</code>
                      {deprecated.includes(prop.name) && <Secondary>{asOf ? `Deprecated, as of ${asOf}` : "Deprecated"}</Secondary>}
                    </Td>
                    <Td label="Usages passing it" align="numeric">
                      {formatNumber(prop.usages)}
                    </Td>
                    <Td label="Values passed">
                      {Object.keys(prop.values).length ? (
                        <ul className={styles.values}>
                          {Object.entries(prop.values)
                            .sort((a, b) => b[1] - a[1])
                            .map(([value, count]) => (
                              <li key={value}>
                                <code>{value}</code> <span className={styles.muted}>{formatNumber(count)}</span>
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <Secondary>Free text, not counted</Secondary>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </Panel>
            {adoption.unknownProps > 0 && <p className={styles.muted}>{`${countLabel(adoption.unknownProps, "app usage")} spread their props, so which props they pass can't be read.`}</p>}
          </Section>
          <Section title="Props no usage passes" description="Props the Reference Catalog entry lists that no usage passes, in any scope.">
            {adoption.unusedProps.length ? (
              <ul className={styles.values}>
                {adoption.unusedProps.map((prop) => (
                  <li key={prop}>
                    <Tag>{prop}</Tag>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>Every prop the entry lists is passed somewhere.</p>
            )}
          </Section>
          <Section title="Stories" description="Repositories with stories that use it.">
            {adoption.stories.length ? <RepositoryLinks repositories={adoption.stories} /> : <p className={styles.muted}>No covered Repository has stories of it.</p>}
          </Section>
        </>
      )}
    </DetailsTemplate>
  );
}

/** Rows per page of a long list (page-patterns spec, "Long lists are paged"). */
const PAGE_SIZE = 50;

/** Every covered Repository that uses the component, with its usages in each scope, fifty to a page. */
function RepositoriesTable({ adoption, requested, href }: { adoption: ComponentAdoption; requested: string | undefined; href: (page: number) => string }) {
  const { page, pages } = pageNumber(requested, adoption.repositories.length, PAGE_SIZE);
  const shown = adoption.repositories.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <>
      <Panel flush>
        <Table
          label={`Repositories using ${adoption.name}`}
          head={
            <>
              <Th>Repository</Th>
              <Th align="numeric">App</Th>
              <Th align="numeric">Stories</Th>
              <Th align="numeric">Tests</Th>
              <Th align="numeric">Customized</Th>
            </>
          }
        >
          {adoption.repositories.length === 0 && <EmptyRow columns={5}>No covered Repository uses it.</EmptyRow>}
          {shown.map(({ repository, usages, customized }) => (
            <tr key={repository.publicId}>
              <Td label="Repository">
                <Primary>
                  <Link href={routes.repository(repository.publicId)}>{repository.name}</Link>
                </Primary>
              </Td>
              <Td label="App" align="numeric">
                {formatNumber(usages.app)}
              </Td>
              <Td label="Stories" align="numeric">
                {formatNumber(usages.stories)}
              </Td>
              <Td label="Tests" align="numeric">
                {formatNumber(usages.tests)}
              </Td>
              <Td label="Customized" align="numeric">
                {formatNumber(customized)}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Pagination label={`Pages of Repositories using ${adoption.name}`} page={page} pages={pages} href={href} />
    </>
  );
}
