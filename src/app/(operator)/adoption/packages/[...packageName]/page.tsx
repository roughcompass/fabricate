import type { Metadata } from "next";
import Link from "next/link";
import { AnalysisTemplate } from "@/components/templates/analysis-template";
import { Alert } from "@/components/ui/alert";
import { BarChart } from "@/components/ui/bar-chart";
import { countLabel, formatNumber } from "@/components/ui/count";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { StatGroup } from "@/components/ui/stat-group";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { packageAdoption } from "@/lib/adoption/queries";
import { latestSnapshot } from "@/lib/adoption/snapshots";
import { getDb } from "@/lib/db/client";
import { pageNumber, pageQuery, param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { RepositoryLinks, changeSince } from "../../shared";

/** Rows per page of a long list (page-patterns spec, "Long lists are paged"). */
const PAGE_SIZE = 50;

/** The package a path names: its segments joined, as `@salt-ds/core`. */
const nameOf = (segments: readonly string[]) => segments.map((segment) => decodeURIComponent(segment)).join("/");

export async function generateMetadata({ params }: PageProps<"/adoption/packages/[...packageName]">): Promise<Metadata> {
  return { title: `${nameOf((await params).packageName)} · Adoption` };
}

/**
 * A package's versions across the fleet (adoption-analytics spec, "Package
 * adoption shows versions across the fleet"), on the Analysis template: how
 * many Repositories declare it and resolve it, the Repositories on each
 * resolved version, with the newest marked, and each Repository's declared
 * ranges and resolved versions. Any package name opens, so a package no
 * Repository declares shows that it has none.
 */
export default async function PackageAdoptionPage({ params, searchParams }: PageProps<"/adoption/packages/[...packageName]">) {
  const [{ packageName }, query] = await Promise.all([params, searchParams]);
  const name = nameOf(packageName);
  const db = getDb();
  const adoption = packageAdoption(db, name);
  const change = latestSnapshot(db, "package", name);
  const newest = adoption.versions.find((version) => version.newest);
  const { page, pages } = pageNumber(param(query, "page"), adoption.repositories.length, PAGE_SIZE);
  const header = {
    breadcrumbs: [{ href: routes.adoption, label: "Adoption" }],
    title: name,
    meta: [`Declared by ${formatNumber(adoption.repositories.length)} of ${countLabel(adoption.profiled, "profiled Repository", "profiled Repositories")}`, ...(newest ? [`Newest resolved ${newest.version}`] : [])],
  };
  if (adoption.repositories.length === 0) {
    return <AnalysisTemplate header={header} empty={{ title: "No Repository declares it", icon: "layers", children: `No registered Repository's current Profile declares ${name}.` }} />;
  }
  return (
    <AnalysisTemplate
      header={header}
      alerts={
        adoption.unresolved.length > 0 && (
          <Alert tone="info" title={`${countLabel(adoption.unresolved.length, "Repository", "Repositories")} ${adoption.unresolved.length === 1 ? "declares" : "declare"} it without a lockfile resolving it`}>
            <p>
              <RepositoryLinks repositories={adoption.unresolved} />
            </p>
          </Alert>
        )
      }
      figures={
        <StatGroup
          label={`${name} adoption`}
          stats={[
            { label: "Declared by", value: formatNumber(adoption.repositories.length), hint: changeSince(change, "repositories") ?? "Repositories" },
            { label: "Resolved by a lockfile", value: formatNumber(adoption.repositories.length - adoption.unresolved.length), hint: changeSince(change, "resolved") },
            { label: "Versions in use", value: formatNumber(adoption.versions.length) },
            { label: "Newest resolved", value: newest?.version ?? "None", hint: newest ? `In ${countLabel(newest.repositories, "Repository", "Repositories")}` : undefined },
          ]}
        />
      }
      chart={
        <Panel title="Versions" description="Repositories on each version their lockfile resolves, newest first.">
          <BarChart
            id="package-versions"
            label={`Repositories on each version of ${name}`}
            groupLabel="Version"
            series={[{ id: "repositories", label: "Repositories", tone: "neutral", pattern: "solid" }]}
            groups={adoption.versions.map((version) => ({ label: version.newest ? `${version.version} (newest)` : version.version, values: { repositories: version.repositories } }))}
            empty="No Repository's lockfile resolves it."
          />
        </Panel>
      }
    >
      <Panel flush>
        <Table
          label={`Repositories declaring ${name}`}
          head={
            <>
              <Th>Repository</Th>
              <Th>Declared</Th>
              <Th>Resolved</Th>
            </>
          }
        >
          {adoption.repositories.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ repository, ranges, resolved }) => (
            <tr key={repository.publicId}>
              <Td label="Repository">
                <Primary>
                  <Link href={routes.repository(repository.publicId)}>{repository.name}</Link>
                </Primary>
              </Td>
              <Td label="Declared">{ranges.length ? <code>{ranges.join(", ")}</code> : <Secondary>No range</Secondary>}</Td>
              <Td label="Resolved">{resolved.length ? <code>{resolved.join(", ")}</code> : <Secondary>No lockfile resolves it</Secondary>}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Pagination label={`Pages of Repositories declaring ${name}`} page={page} pages={pages} href={(number) => routes.adoptionPackage(name, { page: pageQuery(number) })} />
    </AnalysisTemplate>
  );
}
