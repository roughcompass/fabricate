import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Attributed } from "@/components/onboarding/attribution";
import { CurrentState } from "@/components/onboarding/current-state";
import { ActorDialog, ChoiceDialog, ReasonDialog, ReferenceDialog } from "@/components/onboarding/dialogs";
import { LifecycleHistory } from "@/components/onboarding/history";
import { ReferencesTable } from "@/components/onboarding/references";
import { RevisionsTable } from "@/components/onboarding/revisions";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { portalState } from "@/lib/onboarding/external/current-state";
import { referencesOf } from "@/lib/onboarding/external/references";
import { type MenuNode, activeRoutes, currentDefault, effectiveMenu } from "@/lib/onboarding/placements";
import { activationIssues, governingRevision, portalHistory, portalRevisionView, portalSummary } from "@/lib/onboarding/portals";
import { environmentCatalog, environmentLabel } from "@/lib/onboarding/environments";
import { reviewQueue } from "@/lib/onboarding/reviews";
import { revisionsOf } from "@/lib/onboarding/revisions";
import { PORTAL_PLATFORM_LABELS } from "@/lib/onboarding/vocabulary";
import { rememberedActor } from "../../actor";
import { activatePortalAction, addPortalReferenceAction, assignDefaultAction, refreshPortalAction, removePortalReferenceAction, retirePortalAction, startPortalDraftAction } from "../actions";
import { loadPortal, portalCrumbs, portalHref, stepHref } from "../load";
import { portalOutcome } from "../outcomes";

type Params = Promise<{ portalId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const loaded = loadPortal((await params).portalId);
  return { title: loaded ? `${loaded.portal.label} · Portals` : "Portal not found" };
}

/** A menu's groups and approved placements as rows, each group's path leading its placements. */
/** The menu as rows: each group, with the path to it, then what it holds; each placement with the group path it sits in. */
function menuRows(nodes: readonly MenuNode[], path: string[] = []): { group: string; node: Extract<MenuNode, { kind: "placement" }> | null; label: string }[] {
  return nodes.flatMap((node) =>
    node.kind === "group" ? [{ group: path.length ? `Group in ${path.join(" › ")}` : "Top-level group", node: null, label: node.label }, ...menuRows(node.children, [...path, node.label])] : [{ group: path.join(" › ") || "Top level", node, label: node.label }],
  );
}

export default async function PortalPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ portalId }, query] = await Promise.all([params, searchParams]);
  const loaded = loadPortal(portalId);
  if (!loaded) notFound();
  const { db, portal } = loaded;
  const here = portalHref(portal.publicId);
  const { draft, latest, active } = portalSummary(db, portal);
  const governing = governingRevision(db, portal);
  const view = governing ? portalRevisionView(db, portal, governing) : null;
  const actor = await rememberedActor();
  const dialog = param(query, "dialog");
  const pendingActivation = latest && latest.id !== portal.activeRevisionId && (portal.lifecycle === "ready" || portal.lifecycle === "active") ? latest : null;
  const activation = pendingActivation ? activationIssues(db, portal, pendingActivation) : [];
  const environments = view?.environments ?? [];
  const catalog = environmentCatalog(db);
  const placements = reviewQueue(db, { portal: portal.publicId });
  const routes = activeRoutes(db, portal.id);
  const references = referencesOf(db, { kind: "portal", id: portal.id });
  const retired = portal.lifecycle === "retired";

  const startDraft = (inline = false) => (
    <ActorDialog
      id="start-draft"
      action={startPortalDraftAction.bind(null, portal.publicId)}
      title={`Start a Draft of ${portal.label}?`}
      description={latest ? `The Draft starts from revision ${latest.number}. ${portal.lifecycle === "active" ? "The active revision keeps running until a new one is activated." : ""}` : "The Draft holds the Portal's configuration until you submit it."}
      confirmLabel="Start Draft"
      actor={actor}
      trigger={{ label: "Start a Draft", icon: "edit", variant: "primary" }}
      fallbackHref={`${here}?dialog=start-draft#dialog`}
      inline={inline}
      cancelHref={here}
    />
  );
  const activate = (inline = false) =>
    pendingActivation &&
    activation.length === 0 && (
      <ActorDialog
        id="activate"
        action={activatePortalAction.bind(null, portal.publicId)}
        fields={{ revision: String(pendingActivation.number), lockVersion: String(portal.lockVersion) }}
        title={`Activate revision ${pendingActivation.number} of ${portal.label}?`}
        description={portal.activeRevisionId ? `Revision ${pendingActivation.number} replaces revision ${active?.number} as the configuration the Portal runs under.` : "The Portal becomes Active, with this revision's environments, menu, and contract."}
        confirmLabel={`Activate revision ${pendingActivation.number}`}
        actor={actor}
        trigger={{ label: `Activate revision ${pendingActivation.number}`, icon: "play" }}
        fallbackHref={`${here}?dialog=activate#dialog`}
        inline={inline}
        cancelHref={here}
      />
    );
  const retire = (inline = false) => (
    <ReasonDialog
      id="retire"
      action={retirePortalAction.bind(null, portal.publicId)}
      fields={{ lockVersion: String(portal.lockVersion) }}
      title={`Retire ${portal.label}?`}
      description="A retired Portal takes no new placements and can't be changed. Its revisions and history stay. Retire or withdraw its approved placements first."
      confirmLabel="Retire Portal"
      tone="danger"
      actor={actor}
      trigger={{ label: "Retire", icon: "trash" }}
      fallbackHref={`${here}?dialog=retire#dialog`}
      inline={inline}
      cancelHref={here}
      reasonDescription="Recorded in the Portal's history."
    />
  );
  const defaultDialog = (environment: string, inline = false) => {
    const current = currentDefault(db, portal.id, environment);
    const options = routes.filter((route) => route.environment === environment).map((route) => ({ value: route.placement, label: `${route.applicationName ?? route.application} at ${route.route}` }));
    return (
      <ChoiceDialog
        id={`default-${environment}`}
        action={assignDefaultAction.bind(null, portal.publicId, environment)}
        fields={{ sequence: String(current.sequence) }}
        title={`Choose ${portal.label}'s default in ${environment.toUpperCase()}`}
        description="The route a visitor lands on. Only an approved placement in this environment can be the default."
        confirmLabel="Save default"
        actor={actor}
        trigger={{ label: current.placement ? "Change" : "Choose", size: "sm" }}
        fallbackHref={`${here}?dialog=default-${environment}#dialog`}
        inline={inline}
        cancelHref={`${here}#defaults`}
        choiceLabel="Default placement"
        name="placement"
        selected={current.placement ?? ""}
        options={portal.lifecycle === "active" ? options : [{ value: "", label: "No default" }, ...options]}
      />
    );
  };
  const reference = (inline = false) => (
    <ReferenceDialog
      id="reference"
      action={addPortalReferenceAction.bind(null, portal.publicId)}
      title={`Map ${portal.label} to Studio`}
      description="State the Studio channel that represents this Portal, or the Studio environment one of its environments names."
      confirmLabel="Save mapping"
      actor={actor}
      trigger={{ label: "Add mapping", icon: "link" }}
      fallbackHref={`${here}?dialog=reference#dialog`}
      inline={inline}
      cancelHref={`${here}#references`}
      resourceTypes={[
        { value: "channel", label: "Studio channel" },
        { value: "environment", label: "Studio environment" },
      ]}
      environments={environments.map((environment) => environment.environment)}
    />
  );
  const inlineDialog =
    dialog === "start-draft" && !draft && !retired
      ? startDraft(true)
      : dialog === "activate"
        ? activate(true)
        : dialog === "retire" && !retired
          ? retire(true)
          : dialog === "reference"
            ? reference(true)
            : dialog?.startsWith("default-") && environments.some((environment) => `default-${environment.environment}` === dialog)
              ? defaultDialog(dialog.slice("default-".length), true)
              : null;

  return (
    <Page>
      <PageHeader
        breadcrumbs={portalCrumbs}
        title={portal.label}
        status={<Status state={portal.lifecycle} />}
        meta={[portal.ownerTeam ? `Owned by ${portal.ownerTeam}` : "No owning team yet", portal.sealId ? `SEAL ID ${portal.sealId}` : "No SEAL ID"]}
        primaryAction={retired ? undefined : draft ? <ButtonLink href={stepHref(portal.publicId, "identity")} variant="primary" icon="edit">{`Continue revision ${draft.number}`}</ButtonLink> : startDraft()}
        extraActions={
          retired ? undefined : (
            <>
              {activate()}
              {retire()}
            </>
          )
        }
        alerts={
          <>
            <OutcomeToast outcome={portalOutcome(param(query, "notice"), portal)} />
            {retired && <Alert title={`${portal.label} is retired`}>It takes no new placements and can&apos;t be changed. Its revisions and history stay below.</Alert>}
          </>
        }
      />
      {inlineDialog && <div id="dialog">{inlineDialog}</div>}

      <DescriptionList
        layout="columns"
        surface
        items={[
          ["Lifecycle", <Status key="lifecycle" state={portal.lifecycle} />],
          ["Active revision", active ? <Link href={`${here}/revisions/${active.number}`}>{`Revision ${active.number}`}</Link> : "None yet"],
          ["Draft", draft ? <Link href={stepHref(portal.publicId, "identity")}>{`Revision ${draft.number}`}</Link> : "None"],
          ["Owning team", portal.ownerTeam ?? "None yet"],
          ["Platform", portal.platform ? PORTAL_PLATFORM_LABELS[portal.platform] : "None"],
          ["Slug", portal.slug ? <Tag key="slug">{portal.slug}</Tag> : "None"],
          ["Description", portal.description ?? "None"],
          ["Environments", environments.length ? environments.map((environment) => `${environmentLabel(catalog, environment.environment)}${environment.enabled ? "" : " (disabled)"}`).join(", ") : "None yet"],
        ]}
      />

      {pendingActivation && (
        <Section title="Activation" description={`Revision ${pendingActivation.number} is submitted and waiting to be activated.`}>
          {activation.length === 0 ? (
            <Panel>
              <p>Every enabled environment has a default route, and every approved placement has its menu group. It can be activated.</p>
            </Panel>
          ) : (
            <Panel flush>
              <Table label="What stops activation" head={<Th>Needed before activation</Th>}>
                {activation.map((issue) => (
                  <tr key={issue.location}>
                    <Td label="Needed">{issue.message}</Td>
                  </tr>
                ))}
              </Table>
            </Panel>
          )}
        </Section>
      )}

      {view && (
        <Section id="defaults" title="Default routes" description="Each enabled environment's default: the approved placement a visitor lands on.">
          <Panel flush>
            <Table
              label="Default routes"
              head={
                <>
                  <Th>Environment</Th>
                  <Th>Default</Th>
                  <Th align="actions" hidden>
                    Actions
                  </Th>
                </>
              }
            >
              {environments.map((environment) => {
                const current = currentDefault(db, portal.id, environment.environment);
                const route = routes.find((item) => item.placement === current.placement && item.environment === environment.environment);
                return (
                  <tr key={environment.environment}>
                    <Td label="Environment">
                      {environment.environment.toUpperCase()}
                      {!environment.enabled && <Secondary>Disabled</Secondary>}
                    </Td>
                    <Td label="Default">
                      {route ? (
                        <>
                          {`${route.applicationName ?? route.application} at ${route.route}`}
                          {current.actor && (
                            <Secondary>
                              {`Chosen by ${current.actor}, unverified, `}
                              <RelativeTime value={current.assignedAt} />
                            </Secondary>
                          )}
                        </>
                      ) : (
                        <Secondary>No default yet</Secondary>
                      )}
                    </Td>
                    <Td align="actions">{!retired && routes.some((item) => item.environment === environment.environment) && defaultDialog(environment.environment)}</Td>
                  </tr>
                );
              })}
            </Table>
          </Panel>
        </Section>
      )}

      {view && (
        <Section title="Menu" description="Each environment's effective menu: the governing revision's groups, with the approved placements under the group their Portal owner accepted.">
          {environments.map((environment) => {
            const menu = effectiveMenu(db, portal.id, governing!.id, environment.environment);
            const rows = menuRows(menu.nodes);
            return (
              <Disclosure key={environment.environment} summary={`${environment.environment.toUpperCase()} · ${rows.filter((row) => row.node).length} routes`} defaultOpen={environment.environment === environments[0]?.environment}>
                {rows.length > 0 ? (
                  <Table
                    label={`${environment.environment.toUpperCase()} menu`}
                    head={
                      <>
                        <Th>Menu item</Th>
                        <Th>Route</Th>
                        <Th>Application</Th>
                      </>
                    }
                  >
                    {rows.map((row, index) => (
                      <tr key={`${row.group}-${index}`}>
                        <Td label="Menu item">
                          {row.node ? row.label : <strong>{row.label}</strong>}
                          <Secondary>{row.node ? `${row.group}${row.node.isDefault ? " · Default" : ""}${row.node.orphaned ? " · Its group is gone" : ""}` : row.group}</Secondary>
                        </Td>
                        <Td label="Route">{row.node ? <Tag label="route">{row.node.route}</Tag> : "—"}</Td>
                        <Td label="Application">{row.node ? <Link href={`/onboarding/applications/${row.node.application}`}>{row.node.applicationName ?? row.node.application}</Link> : "—"}</Td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <EmptyState title="Empty menu">Add menu groups in a Draft, and approve placements to fill them.</EmptyState>
                )}
              </Disclosure>
            );
          })}
        </Section>
      )}

      <Section title="Placements" description="Every Application placed or requesting a place in this Portal, each reviewed on its own.">
        <Panel flush>
          {placements.length > 0 ? (
            <Table
              label="Placements"
              head={
                <>
                  <Th>Application</Th>
                  <Th>Route</Th>
                  <Th>State</Th>
                </>
              }
            >
              {placements.map((row) => (
                <tr key={row.placement}>
                  <Td label="Application">
                    <Primary>
                      <Link href={`/onboarding/reviews/${row.placement}`}>{row.application.name}</Link>
                    </Primary>
                    <Secondary>{`Revision ${row.revision}`}</Secondary>
                  </Td>
                  <Td label="Route">
                    <Tag label="route">{row.route}</Tag>
                  </Td>
                  <Td label="State">
                    <Status state={row.state} />
                    {row.effective !== row.state && <Secondary>An earlier approval is serving</Secondary>}
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No placements yet">Applications request placements from their own Drafts; each request appears in Reviews.</EmptyState>
          )}
        </Panel>
      </Section>

      <Section title="Revisions" description="Each submitted revision is frozen; edits start a new Draft.">
        <RevisionsTable revisions={revisionsOf(db, "portal", portal.id)} href={(number) => `${here}/revisions/${number}`} active={portal.activeRevisionId} draftHref={stepHref(portal.publicId, "identity")} />
      </Section>

      <div id="current-state">
        <CurrentState items={portalState(db, portal)} refresh={refreshPortalAction.bind(null, portal.publicId)} />
      </div>

      <Section id="references" title="Mappings" description="The Studio resources this Portal is mapped to. Nothing is matched by name or SEAL ID." actions={!retired && reference()}>
        <ReferencesTable references={references} remove={(item) => (item.source === "person" && !retired ? removePortalReferenceAction.bind(null, portal.publicId, item.publicId) : null)} />
      </Section>

      <Section title="History" description="Each change, with who made it as they stated it.">
        <LifecycleHistory events={portalHistory(db, portal.id)} />
      </Section>

      <Disclosure summary="Details" variant="plain">
        <DescriptionList
          surface
          items={[
            ["ID", <Tag key="id" copy label="ID">{portal.publicId}</Tag>],
            ["Created", <RelativeTime key="created" value={portal.createdAt} />],
            ["Ontology concept", portal.conceptKey ?? "Pending review"],
            ...(view?.contractDigest ? ([["Contract digest", <Tag key="digest" copy label="contract digest">{view.contractDigest}</Tag>]] as const) : []),
            ...(draft ? ([["Draft version", draft.lockVersion]] as const) : []),
            ...(latest?.submittedBy ? ([["Last submitted by", <Attributed key="by" name={latest.submittedBy} attribution="unverified" />]] as const) : []),
          ]}
        />
      </Disclosure>
    </Page>
  );
}

