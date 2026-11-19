import { docsAction } from "@/components/site/docs-help";
import type { Metadata } from "next";
import { DashboardPanel, DashboardTemplate } from "@/components/templates/dashboard-template";
import { countLabel, formatNumber } from "@/components/ui/count";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { StatGroup } from "@/components/ui/stat-group";
import { designSystemCoverage } from "@/lib/adoption/fleet";
import { designSystemAdoption, packageAdoption, tokenUse } from "@/lib/adoption/queries";
import { latestSnapshot } from "@/lib/adoption/snapshots";
import type { DescribedThing } from "@/lib/catalog/configuration";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { PRODUCT } from "@/lib/product";
import { routes } from "@/lib/web/routes";
import { CoverageAlert, changeSince, describedDesignSystems, hint, shareCounts, shareLabel, thingName, trackedPackages } from "./shared";

export const metadata: Metadata = { title: "Adoption" };

/**
 * Adoption (adoption-analytics spec), a Dashboard: how many registered
 * Repositories the figures cover, then a panel for each design system and
 * package the Reference Catalog describes, each opening its own page. Read
 * from the projection, never from Profile documents.
 */
export default function AdoptionPage() {
  const db = getDb();
  const config = getConfig();
  const coverage = designSystemCoverage(db);
  const systems = describedDesignSystems(db, config);
  const packages = trackedPackages(config);
  return (
    <DashboardTemplate
      header={{ title: "Adoption", description: `How the fleet's Repositories use the design systems and packages the ${PRODUCT.referenceCatalog} describes.`, secondaryActions: [docsAction("guides/adoption")] }}
      alerts={<CoverageAlert coverage={coverage} />}
      figures={
        <StatGroup
          label="Coverage"
          stats={[
            { label: "Registered", value: formatNumber(coverage.registered), href: routes.repositories, hint: "Repositories" },
            { label: "Covered", value: formatNumber(coverage.covered.length), hint: "With design-system facts in their current Profile" },
            { label: "Design systems", value: formatNumber(systems.length), hint: "Tracked" },
            { label: "Packages", value: formatNumber(packages.length), hint: "Tracked" },
          ]}
        />
      }
      empty={systems.length + packages.length === 0 ? { title: "Nothing is tracked yet", icon: "layers", children: "Describe a design system in config/catalog.yaml to track its adoption." } : undefined}
    >
      {systems.map(({ thing, tracked }) =>
        tracked ? (
          <DashboardPanel key={thing.id} title={tracked.name} description="Its components across covered Repositories, in app code." link={{ href: routes.adoptionDesignSystem(thing.id), label: `${tracked.name} adoption` }}>
            {() => {
              const adoption = designSystemAdoption(db, coverage, tracked, { rarelyUsedPercentile: config.adoption.rarelyUsedPercentile });
              const tokens = tokenUse(coverage, thing.id);
              const change = latestSnapshot(db, "design_system", thing.id);
              return (
                <DescriptionList
                  items={[
                    ["Repositories using it", hint(formatNumber(adoption.repositories.length), changeSince(change, "repositories"))],
                    ["Components used", hint(`${formatNumber(adoption.componentsUsed)} of ${formatNumber(adoption.componentsTracked)}`, changeSince(change, "components_used"))],
                    ["Usages in app code", hint(formatNumber(adoption.usages.app), changeSince(change, "usages"))],
                    ["Token use", `${shareLabel(tokens)}, ${shareCounts(tokens, "token-capable declarations")}`],
                  ]}
                />
              );
            }}
          </DashboardPanel>
        ) : (
          <NotDescribedYet key={thing.id} thing={thing} />
        ),
      )}
      {packages.map((name) => (
        <DashboardPanel key={name} title={name} description="The versions Repositories declare and resolve." link={{ href: routes.adoptionPackage(name), label: `${name} versions` }}>
          {() => {
            const adoption = packageAdoption(db, name);
            const change = latestSnapshot(db, "package", name);
            const newest = adoption.versions.find((version) => version.newest);
            return (
              <DescriptionList
                items={[
                  ["Declared by", hint(countLabel(adoption.repositories.length, "Repository", "Repositories"), changeSince(change, "repositories"))],
                  ["Versions in use", formatNumber(adoption.versions.length)],
                  ["Newest resolved", newest ? `${newest.version}, in ${countLabel(newest.repositories, "Repository", "Repositories")}` : "None"],
                ]}
              />
            );
          }}
        </DashboardPanel>
      ))}
    </DashboardTemplate>
  );
}

/** A design system described in config/catalog.yaml with no entry built yet. */
function NotDescribedYet({ thing }: { thing: DescribedThing }) {
  return (
    <DashboardPanel title={thingName(thing)}>
      <EmptyState title="No Reference Catalog entry yet" icon="clock">
        {`${thingName(thing)}'s figures appear once an entry of a version Repositories use is built.`}
      </EmptyState>
    </DashboardPanel>
  );
}
