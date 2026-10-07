import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Attributed } from "@/components/onboarding/attribution";
import { DifferencesTable } from "@/components/onboarding/differences";
import { ValidationIssues } from "@/components/onboarding/issues";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag, TagList } from "@/components/ui/tag";
import { compareDocuments } from "@/lib/onboarding/contracts";
import { CAPABILITY_LABELS, type Capability, RENDERING_MODE_LABELS } from "@/lib/onboarding/documents";
import { environmentCatalog, environmentLabel } from "@/lib/onboarding/environments";
import { portalRevisionView } from "@/lib/onboarding/portals";
import { latestValidation, revisionByNumber } from "@/lib/onboarding/revisions";
import { loadPortal, portalCrumbs, portalHref } from "../../../load";

type Params = Promise<{ portalId: string; revision: string }>;

function load(portalId: string, revision: string) {
  const loaded = loadPortal(portalId);
  const number = /^\d{1,6}$/.test(revision) ? Number(revision) : NaN;
  const found = loaded && Number.isInteger(number) ? revisionByNumber(loaded.db, "portal", loaded.portal.id, number) : undefined;
  return loaded && found?.state === "submitted" ? { ...loaded, revision: found } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { portalId, revision } = await params;
  const loaded = load(portalId, revision);
  return { title: loaded ? `Revision ${loaded.revision.number} · ${loaded.portal.label} · Portals` : "Revision not found" };
}

/**
 * One submitted, frozen Portal revision: its environments and menu, and what
 * changed from the revision before. A revision written in the earlier format
 * also shows, read-only, the runtimes, environment entitlements, and contract
 * it was submitted with.
 */
export default async function PortalRevisionPage({ params }: { params: Params }) {
  const { portalId, revision: number } = await params;
  const loaded = load(portalId, number);
  if (!loaded) notFound();
  const { db, portal, revision } = loaded;
  const view = portalRevisionView(db, portal, revision);
  const previous = revision.number > 1 ? revisionByNumber(db, "portal", portal.id, revision.number - 1) : undefined;
  const before = previous?.state === "submitted" ? previous : undefined;
  const contract = view.contract;
  const validation = latestValidation(db, "portal", revision.id);
  const earlier = revision.formatVersion === 1;
  const catalog = environmentCatalog(db);

  return (
    <Page>
      <PageHeader
        breadcrumbs={[...portalCrumbs, { href: portalHref(portal.publicId), label: portal.label }]}
        title={`Revision ${revision.number}`}
        status={<Status state={revision.id === portal.activeRevisionId ? "active" : "submitted"} />}
        meta={[<span key="by">{`Submitted by ${revision.submittedBy}, unverified`}</span>, <RelativeTime key="at" value={revision.submittedAt} />]}
        description="A submitted revision is frozen. Reviews of placements in this Portal name the revision they checked."
      />
      {earlier ? (
        <Section title="Environments" description="Written in the earlier format, which also collected each environment's runtime and entitlements. They're shown as history; entitlements are now decided on each placement.">
          <Panel flush>
            <Table
              label="Environments"
              head={
                <>
                  <Th>Environment</Th>
                  <Th>Runtime</Th>
                  <Th>Entitlements</Th>
                </>
              }
            >
              {view.environments.map((environment) => {
                const entitlements = environment.entitlements ? (JSON.parse(environment.entitlements) as { codes: string[]; operator: string }) : { codes: [], operator: "any" };
                return (
                  <tr key={environment.environment}>
                    <Td label="Environment">
                      {environment.environment.toUpperCase()}
                      <Secondary>{environment.enabled ? "Enabled" : "Disabled"}</Secondary>
                    </Td>
                    <Td label="Runtime">{environment.runtime ?? "None"}</Td>
                    <Td label="Entitlements">
                      {entitlements.codes.length ? <TagList values={entitlements.codes} /> : "No restriction"}
                      <Secondary>{[entitlements.codes.length > 1 ? (entitlements.operator === "all" ? "All of them" : "Any one of them") : null, environment.entitlementsInheritedFrom ? `Inherited from ${environment.entitlementsInheritedFrom.toUpperCase()}` : "Stated here"].filter(Boolean).join(" · ")}</Secondary>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Panel>
        </Section>
      ) : (
        <Section title="Environments" description={`The catalog environments the Portal enables, checked against the ${view.catalog?.source === "studio" ? "Studio" : "fallback"} environment catalog when it was submitted.`}>
          <DescriptionList surface items={[["Enabled", <TagList key="environments" values={view.environments.map((environment) => environmentLabel(catalog, environment.environment))} />]]} />
        </Section>
      )}
      <Section title="Menu groups">
        <Panel flush>
          <Table
            label="Menu groups"
            head={
              <>
                <Th>Group</Th>
                <Th>Key</Th>
                <Th>Inside</Th>
                <Th align="numeric">Position</Th>
              </>
            }
          >
            {view.menu.map((group) => (
              <tr key={group.key}>
                <Td label="Group">{group.label}</Td>
                <Td label="Key">
                  <Tag label="key">{group.key}</Tag>
                </Td>
                <Td label="Inside">{group.parentKey ? (view.menu.find((parent) => parent.key === group.parentKey)?.label ?? group.parentKey) : "Top level"}</Td>
                <Td label="Position" align="numeric">
                  {group.ordering}
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </Section>
      {earlier && view.runtimes.length > 0 && (
        <Section title="Runtimes" description="Collected by the earlier format, and kept as history.">
          <DescriptionList surface items={[["Runtimes", <TagList key="runtimes" values={view.runtimes} />]]} />
        </Section>
      )}
      {contract && (
        <Section title="Contract" description={`${view.contractLabel}: what Applications placed in ${portal.label} were checked against while this revision was current. Contracts are no longer collected; it's kept as history.`}>
          <DescriptionList
            surface
            items={[
              ["Capabilities", contract.capabilities.map((capability) => CAPABILITY_LABELS[capability as Capability]).join(", ") || "None"],
              ["Events", contract.events.length ? <TagList key="events" values={contract.events} /> : "None"],
              ["Context", contract.context.length ? <TagList key="context" values={contract.context} /> : "None"],
              ["Allowed origins", contract.allowedOrigins.length ? <TagList key="origins" values={contract.allowedOrigins} /> : "None"],
              ...Object.entries(contract.modes).map(([mode, settings]) => [RENDERING_MODE_LABELS[mode as keyof typeof RENDERING_MODE_LABELS], <code key={mode}>{JSON.stringify(settings)}</code>] as const),
            ]}
          />
        </Section>
      )}
      <Section title={before ? `Changes from revision ${before.number}` : "Changes"} description={before ? "Each field added, removed, or changed since the revision before." : "The first revision; there's nothing to compare it with."}>
        <DifferencesTable label={`Changes from revision ${before?.number ?? revision.number}`} differences={before ? compareDocuments(before.document, revision.document) : []} empty={before ? "This revision is the same as the one before." : "This is the Portal's first revision."} />
      </Section>
      {validation && (
        <Section title="Validation at submission" description="Warnings recorded when the revision was submitted; nothing blocked it.">
          <ValidationIssues issues={validation.issues} stepOf={() => ({ href: portalHref(portal.publicId), label: portal.label })} />
        </Section>
      )}
      <Disclosure summary="Details" variant="plain">
        <DescriptionList
          surface
          items={[
            ["Digest", <Tag key="digest" copy label="digest">{revision.digest!}</Tag>],
            ...(view.contractDigest ? ([["Contract digest", <Tag key="contract" copy label="contract digest">{view.contractDigest}</Tag>]] as const) : []),
            ...(view.catalog ? ([["Environment catalog", <Tag key="catalog" copy label="catalog digest">{`${view.catalog.source === "studio" ? "Studio" : "Fallback"} ${view.catalog.digest}`}</Tag>]] as const) : []),
            ["Submitted by", <Attributed key="by" name={revision.submittedBy!} attribution="unverified" />],
          ]}
        />
      </Disclosure>
    </Page>
  );
}
