import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChangeHistory } from "@/components/onboarding/history";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { buttonProps } from "@/components/ui/button-content";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Menu, MenuButton, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { type Outcome, OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Tag } from "@/components/ui/tag";
import { applicationHref } from "@/lib/applications/applications";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { MAX_MENU_DEPTH, type MenuEntry, menuOf, portalApplications, unplacedApplications } from "@/lib/onboarding/navigation";
import { type Portal, findPortal, isOnboarded, portalHistory } from "@/lib/onboarding/portals";
import { PORTAL_PLATFORM_LABELS } from "@/lib/onboarding/vocabulary";
import {
  addGroupAction,
  addItemAction,
  moveEntryAction,
  moveIntoAction,
  promotePortalAction,
  removeEntryAction,
  renameEntryAction,
  returnToPrototypeAction,
  setDefaultAction,
} from "../actions";
import { navigationCrumbs, navigationHref } from "../paths";
import { AddGroupForm, AddItemForm, type Choice, MoveIntoForm, RenameForm } from "./menu-forms";
import styles from "./navigation.module.css";

function onboardedPortal(portalId: string): Portal | null {
  if (!isPublicId(portalId, "ptl")) return null;
  const db = getDb();
  const portal = findPortal(db, portalId);
  return portal && isOnboarded(db, portal.id) ? portal : null;
}

export async function generateMetadata({ params }: { params: Promise<{ portalId: string }> }): Promise<Metadata> {
  const portal = onboardedPortal((await params).portalId);
  return { title: portal ? `${portal.label} · Navigation` : "Portal not found" };
}

/**
 * A notice's message, built from the record so a crafted link can't inject
 * text. A menu change is named by the history entry it just recorded.
 */
function navigationOutcome(code: string | undefined, portal: Portal, latest: { event: string; detail: string | null } | undefined): Outcome | undefined {
  const id = `${code}:${portal.publicId}:${portal.lockVersion}`;
  const name = portal.label;
  switch (code) {
    case "created":
      return { id, tone: "success", title: `${name} was created as a Prototype.`, description: "Add its menu, then make one item the default route to promote it to Production." };
    case "adopted":
      return { id, tone: "success", title: `${name} was onboarded as a Prototype.`, description: "An ownership claim already named it, so it keeps its identity." };
    case "edited":
      return { id, tone: "success", title: "The details are saved." };
    case "promoted":
      return { id, tone: "success", title: `${name} is in Production.` };
    case "returned":
      return { id, tone: "success", title: `${name} is a Prototype again.` };
    case "item-added":
    case "group-added":
    case "renamed":
    case "moved":
    case "removed":
    case "default":
      return { id, tone: "success", title: latest?.detail && (latest.event === "menu_changed" || latest.event === "default_changed") ? `${latest.detail}.` : "The menu is saved." };
    case "stale":
      return { id, tone: "warning", title: `${name} changed since you opened it.`, description: "The menu shows the current version. Check it and make your change again." };
    case "no-default":
      return { id, tone: "error", title: `${name} needs a default route first.`, description: "Make one of its menu items the default, then promote it." };
    case "not-empty":
      return { id, tone: "error", title: "That group isn't empty.", description: "Move or remove what's in it first." };
    case "edge":
      return { id, tone: "info", title: "That entry is already at the end of its group." };
    case "refused":
      return { id, tone: "error", title: "That change couldn't be made.", description: "Reload the page and try again." };
    default:
      return undefined;
  }
}

/** Each entry's place in the menu, as its groups' labels, such as "Payments › Cards". */
function paths(menu: readonly MenuEntry[]): Map<string, string> {
  const byId = new Map(menu.map((entry) => [entry.publicId, entry]));
  const result = new Map<string, string>();
  for (const entry of menu) {
    const labels = [entry.label];
    for (let parent = entry.parentPublicId ? byId.get(entry.parentPublicId) : undefined; parent; parent = parent.parentPublicId ? byId.get(parent.parentPublicId) : undefined) labels.unshift(parent.label);
    result.set(entry.publicId, labels.join(" › "));
  }
  return result;
}

/** +entry+ and everything inside it. */
function subtree(menu: readonly MenuEntry[], entry: MenuEntry): MenuEntry[] {
  const inside = [entry];
  for (const candidate of menu) if (candidate.parentPublicId && inside.some((held) => held.publicId === candidate.parentPublicId)) inside.push(candidate);
  return inside;
}

/** The groups +entry+ can move into: not itself or what it holds, and none that would nest it deeper than the limit. */
function moveTargets(menu: readonly MenuEntry[], entry: MenuEntry, labels: Map<string, string>): Choice[] {
  const held = subtree(menu, entry);
  const height = Math.max(...held.map((candidate) => candidate.depth)) - entry.depth + 1;
  return menu.filter((group) => group.kind === "group" && !held.includes(group) && group.depth + height <= MAX_MENU_DEPTH).map((group) => ({ value: group.publicId, label: labels.get(group.publicId)! }));
}

/**
 * A Portal's Navigation page (navigation spec): its lifecycle in the header
 * with Promote to Production or Return to Prototype, its details, its menu
 * edited one change at a time, its Applications no item points at, and its
 * history, newest first. Every change is a form post, so the page works
 * without JavaScript; the menu's forms open in place from `?form=`.
 */
export default async function PortalNavigationPage({ params, searchParams }: { params: Promise<{ portalId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ portalId }, query] = await Promise.all([params, searchParams]);
  const portal = onboardedPortal(portalId);
  if (!portal) notFound();
  const db = getDb();
  const here = navigationHref(portal.publicId);
  const menu = menuOf(db, portal.id);
  const applications = portalApplications(db, portal.id);
  const unplaced = unplacedApplications(db, portal.id);
  const history = portalHistory(db, portal.id);
  const hasDefault = menu.some((entry) => entry.isDefault);
  const labels = paths(menu);
  const lockVersion = String(portal.lockVersion);
  const applicationChoices = applications.map((application) => ({ value: application.publicId, label: application.slug ? `${application.name} (${application.slug})` : (application.name ?? application.publicId) }));
  // An item goes inside a group only while it stays within the depth limit.
  const itemGroups = menu.filter((entry) => entry.kind === "group" && entry.depth < MAX_MENU_DEPTH).map((group) => ({ value: group.publicId, label: labels.get(group.publicId)! }));
  const shared = { lockVersion: portal.lockVersion, portal: portal.label, cancelHref: `${here}#menu` };

  const form = param(query, "form");
  const formEntry = menu.find((entry) => entry.publicId === param(query, "entry"));
  const inlineForm =
    form === "add-item" ? (
      <AddItemForm {...shared} inline action={addItemAction.bind(null, portal.publicId)} applications={applicationChoices} groups={itemGroups} application={applications.find((application) => application.publicId === param(query, "application"))?.publicId} trigger={{ label: "Add item" }} fallbackHref={here} />
    ) : form === "add-group" ? (
      <AddGroupForm {...shared} inline action={addGroupAction.bind(null, portal.publicId)} groups={itemGroups} trigger={{ label: "Add group" }} fallbackHref={here} />
    ) : form === "rename" && formEntry ? (
      <RenameForm {...shared} action={renameEntryAction.bind(null, portal.publicId)} entry={formEntry} />
    ) : form === "move" && formEntry ? (
      <MoveIntoForm {...shared} action={moveIntoAction.bind(null, portal.publicId)} entry={{ publicId: formEntry.publicId, label: formEntry.label, parent: formEntry.parentPublicId }} targets={moveTargets(menu, formEntry, labels)} />
    ) : null;
  // A rename or move whose entry is gone: someone removed it since the form opened.
  const goneEntry = (form === "rename" || form === "move") && !formEntry;

  const lifecycleAction =
    portal.lifecycle === "production" ? null : hasDefault ? (
      <ConfirmDialog action={promotePortalAction.bind(null, portal.publicId)} fields={{ lockVersion }} trigger={{ label: "Promote to Production", icon: "arrowUp", variant: "primary" }} title={`Promote ${portal.label} to Production?`} confirmLabel="Promote to Production">
        <p>{`${portal.label} shows a Production badge everywhere it appears. The promotion is recorded in its history with your name, marked Unverified.`}</p>
      </ConfirmDialog>
    ) : (
      <span className={styles.pendingAction}>
        <button type="button" {...buttonProps("primary")} disabled aria-describedby="promote-blocked">
          <Icon name="arrowUp" size={16} />
          Promote to Production
        </button>
        <span id="promote-blocked" className={styles.pendingNote}>
          Needs a default route first
        </span>
      </span>
    );

  const entryActions = (entry: MenuEntry, children: number) => {
    const moves = (
      <>
        {!entry.first && (
          <MenuButton icon="arrowUp" formAction={moveEntryAction.bind(null, portal.publicId, "up")}>
            Move up
          </MenuButton>
        )}
        {!entry.last && (
          <MenuButton icon="arrowDown" formAction={moveEntryAction.bind(null, portal.publicId, "down")}>
            Move down
          </MenuButton>
        )}
        <MenuItem href={`${here}?form=move&entry=${entry.publicId}#menu-form`} icon="folder">
          Move to a group
        </MenuItem>
        <MenuItem href={`${here}?form=rename&entry=${entry.publicId}#menu-form`} icon="edit">
          Rename
        </MenuItem>
        {entry.kind === "item" && !entry.isDefault && (
          <MenuButton icon="home" formAction={setDefaultAction.bind(null, portal.publicId)}>
            Make default
          </MenuButton>
        )}
        <MenuSeparator />
      </>
    );
    // A group that holds something can't be removed; its Remove says why.
    if (entry.kind === "group" && children > 0) {
      return (
        <form className={styles.entryForm}>
          <input type="hidden" name="lockVersion" value={lockVersion} />
          <input type="hidden" name="entry" value={entry.publicId} />
          <Menu label={`Actions for ${entry.label}`}>
            {moves}
            <MenuButton icon="trash" disabled>
              Remove<span className="visually-hidden"> (move or remove what&apos;s in it first)</span>
            </MenuButton>
          </Menu>
        </form>
      );
    }
    return (
      <ConfirmDialog
        action={removeEntryAction.bind(null, portal.publicId)}
        fields={{ lockVersion, entry: entry.publicId }}
        trigger={{ label: "Remove", icon: "trash" }}
        menu={{ label: `Actions for ${entry.label}`, items: moves }}
        title={`Remove ${entry.label}?`}
        confirmLabel="Remove"
        tone="danger"
      >
        <p>
          {entry.kind === "group"
            ? "The group is empty, so nothing else changes."
            : `${entry.route} no longer opens ${entry.application?.name ?? "its Application"} in ${portal.label}.${entry.isDefault ? ` It's the default route, so ${portal.label} has none until you choose another.` : ""}`}
        </p>
      </ConfirmDialog>
    );
  };

  const tree = (parent: string | null, label?: string): React.ReactNode => {
    const entries = menu.filter((entry) => entry.parentPublicId === parent);
    if (entries.length === 0) return parent ? <p className={styles.empty}>Empty</p> : null;
    return (
      <ul className={styles.tree} aria-label={label}>
        {entries.map((entry) => (
          <li key={entry.publicId} className={styles.node}>
            <div className={styles.entry} data-kind={entry.kind}>
              <Icon name={entry.kind === "group" ? "folder" : "link"} size={14} className={styles.entryIcon} />
              <span className={styles.entryMain}>
                <span className={styles.entryLabel}>{entry.label}</span>
                {entry.kind === "item" && (
                  <span className={styles.entryTarget}>
                    <Tag>{entry.route}</Tag>
                    {entry.application && <Link href={applicationHref(entry.application.publicId)}>{entry.application.name}</Link>}
                  </span>
                )}
                {entry.isDefault && <Tag sans>Default</Tag>}
              </span>
              <span className={styles.entryActions}>{entryActions(entry, menu.filter((candidate) => candidate.parentPublicId === entry.publicId).length)}</span>
            </div>
            {entry.kind === "group" && tree(entry.publicId)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <Page>
      <PageHeader
        breadcrumbs={navigationCrumbs}
        title={portal.label}
        status={<Status state={portal.lifecycle} />}
        meta={portal.ownerTeam ? [`Owned by ${portal.ownerTeam}`] : undefined}
        primaryAction={lifecycleAction ?? undefined}
        extraActions={
          portal.lifecycle === "production" ? (
            <ConfirmDialog action={returnToPrototypeAction.bind(null, portal.publicId)} fields={{ lockVersion }} trigger={{ label: "Return to Prototype", icon: "undo" }} title={`Return ${portal.label} to Prototype?`} confirmLabel="Return to Prototype">
              <p>{`${portal.label} shows a Prototype badge again. Its menu and default route stay as they are, and the change is recorded in its history.`}</p>
            </ConfirmDialog>
          ) : undefined
        }
        alerts={<OutcomeToast outcome={navigationOutcome(param(query, "notice"), portal, history[0])} />}
      />

      <Panel
        title="Details"
        actions={
          <ButtonLink href={`${here}/edit`} size="sm" icon="edit">
            Edit details
          </ButtonLink>
        }
      >
        <DescriptionList
          layout="columns"
          items={[
            ["SEAL ID", portal.sealId ?? "None"],
            ["Platform", portal.platform ? PORTAL_PLATFORM_LABELS[portal.platform] : "None"],
            ["Slug", portal.slug ? <code key="slug">{portal.slug}</code> : "None"],
            ["Owning team", portal.ownerTeam ?? "None"],
            ["Description", portal.description ?? "None"],
          ]}
        />
      </Panel>

      <Section
        id="menu"
        title="Menu"
        description="Each change takes effect at once and is recorded in the history."
        actions={
          <>
            <AddGroupForm {...shared} action={addGroupAction.bind(null, portal.publicId)} groups={itemGroups} trigger={{ label: "Add group", icon: "folder", size: "sm" }} fallbackHref={`${here}?form=add-group#menu-form`} />
            <AddItemForm {...shared} action={addItemAction.bind(null, portal.publicId)} applications={applicationChoices} groups={itemGroups} trigger={{ label: "Add item", icon: "plus", size: "sm" }} fallbackHref={`${here}?form=add-item#menu-form`} />
          </>
        }
      >
        {inlineForm && <div id="menu-form">{inlineForm}</div>}
        {goneEntry && (
          <Alert tone="warning" title={`${portal.label} changed since you opened it`}>
            That entry isn&apos;t in the menu any more. The menu below is the current version.
          </Alert>
        )}
        {menu.some((entry) => entry.kind === "item") && !hasDefault && (
          <Alert tone="warning" title={`${portal.label} has no default route`}>
            Choose Make default in an item&apos;s actions. The default route is where people land, and promoting to Production needs one.
          </Alert>
        )}
        <Panel>
          {menu.length > 0 ? (
            tree(null, "Menu")
          ) : (
            <EmptyState title="No menu yet" icon="network">
              {`Add an item to route a path in ${portal.label} to one of its Applications, and a group to hold items.`}
            </EmptyState>
          )}
        </Panel>
      </Section>

      <Section id="unplaced" title="Applications not in the menu" description={`Applications registered in ${portal.label} that no menu item points at.`}>
        <Panel flush={unplaced.length > 0}>
          {unplaced.length > 0 ? (
            <ul className={styles.unplaced} aria-label="Applications not in the menu">
              {unplaced.map((application) => (
                <li key={application.publicId}>
                  <span className={styles.unplacedName}>
                    <Link href={applicationHref(application.publicId)}>{application.name}</Link>
                    {application.slug && <span className={styles.muted}>{application.slug}</span>}
                  </span>
                  <AddItemForm
                    {...shared}
                    id={`add-${application.publicId}`}
                    action={addItemAction.bind(null, portal.publicId)}
                    applications={applicationChoices}
                    groups={itemGroups}
                    application={application.publicId}
                    trigger={{ label: "Add to menu", icon: "plus", size: "sm" }}
                    fallbackHref={`${here}?form=add-item&application=${application.publicId}#menu-form`}
                  />
                </li>
              ))}
            </ul>
          ) : applications.length > 0 ? (
            <EmptyState title="Every Application is in the menu">{`Each Application registered in ${portal.label} has at least one menu item.`}</EmptyState>
          ) : (
            <EmptyState
              title={`No Applications in ${portal.label} yet`}
              action={
                <ButtonLink href="/applications/new" icon="plus">
                  Add application
                </ButtonLink>
              }
            >
              A menu item points at an Application registered in its Portal.
            </EmptyState>
          )}
        </Panel>
      </Section>

      <Section id="history" title="History" description="Who stated they made each change, newest first.">
        <ChangeHistory events={history} />
      </Section>
    </Page>
  );
}
