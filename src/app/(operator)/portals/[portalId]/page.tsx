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
import { type Outcome, OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Tag } from "@/components/ui/tag";
import { applicationHref } from "@/lib/applications/applications";
import { getDb } from "@/lib/db/client";
import { menuOf, portalApplications, unplacedApplications } from "@/lib/onboarding/navigation";
import { type Portal, portalHistory } from "@/lib/onboarding/portals";
import { PORTAL_PLATFORM_LABELS } from "@/lib/onboarding/vocabulary";
import { promotePortalAction, returnToPrototypeAction } from "../actions";
import { onboardedPortal } from "../load";
import { editorHref, portalsCrumbs, portalHref } from "../paths";
import styles from "./portal.module.css";

export async function generateMetadata({ params }: { params: Promise<{ portalId: string }> }): Promise<Metadata> {
  const portal = onboardedPortal((await params).portalId);
  return { title: portal ? `${portal.label} · Navigation` : "Portal not found" };
}

/** A notice's message, built from the record so a crafted link can't inject text. */
function navigationOutcome(code: string | undefined, portal: Portal): Outcome | undefined {
  const id = `${code}:${portal.publicId}:${portal.lockVersion}`;
  const name = portal.label;
  switch (code) {
    case "created":
      return { id, tone: "success", title: `${name} was created as a Prototype.`, description: "Open the experience editor to add its menu, then make one item the default route to promote it to Production." };
    case "adopted":
      return { id, tone: "success", title: `${name} was onboarded as a Prototype.`, description: "An ownership claim already named it, so it keeps its identity." };
    case "edited":
      return { id, tone: "success", title: "The details are saved." };
    case "promoted":
      return { id, tone: "success", title: `${name} is in Production.` };
    case "returned":
      return { id, tone: "success", title: `${name} is a Prototype again.` };
    case "stale":
      return { id, tone: "warning", title: `${name} changed since you opened it.`, description: "The page shows the current version. Check it and try again." };
    case "no-default":
      return { id, tone: "error", title: `${name} needs a default route first.`, description: "Make one of its menu items the default in the experience editor, then promote it." };
    case "refused":
      return { id, tone: "error", title: "That change couldn't be made.", description: "Reload the page and try again." };
    default:
      return undefined;
  }
}

/**
 * A Portal's Navigation page (navigation spec): its lifecycle in the header
 * with Promote to Production or Return to Prototype, its details, its saved
 * menu, its Applications no item points at, and its history, newest first.
 * The menu, and the rest of the Portal's experience, is edited in the
 * experience editor; the page itself works without JavaScript.
 */
export default async function PortalNavigationPage({ params, searchParams }: { params: Promise<{ portalId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ portalId }, query] = await Promise.all([params, searchParams]);
  const portal = onboardedPortal(portalId);
  if (!portal) notFound();
  const db = getDb();
  const here = portalHref(portal.publicId);
  const menu = menuOf(db, portal.id);
  const applications = portalApplications(db, portal.id);
  const unplaced = unplacedApplications(db, portal.id);
  const history = portalHistory(db, portal.id);
  const hasDefault = menu.some((entry) => entry.isDefault);
  const lockVersion = String(portal.lockVersion);
  const menuEditor = editorHref(portal.publicId, "menu");

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
        breadcrumbs={portalsCrumbs}
        title={portal.label}
        status={<Status state={portal.lifecycle} />}
        meta={portal.ownerTeam ? [`Owned by ${portal.ownerTeam}`] : undefined}
        primaryAction={lifecycleAction ?? undefined}
        secondaryActions={[{ href: editorHref(portal.publicId), label: "Open experience editor", icon: "frame" }]}
        extraActions={
          portal.lifecycle === "production" ? (
            <ConfirmDialog action={returnToPrototypeAction.bind(null, portal.publicId)} fields={{ lockVersion }} trigger={{ label: "Return to Prototype", icon: "undo" }} title={`Return ${portal.label} to Prototype?`} confirmLabel="Return to Prototype">
              <p>{`${portal.label} shows a Prototype badge again. Its menu and default route stay as they are, and the change is recorded in its history.`}</p>
            </ConfirmDialog>
          ) : undefined
        }
        alerts={<OutcomeToast outcome={navigationOutcome(param(query, "notice"), portal)} />}
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
        description="The saved menu. Changes are made in the experience editor and take effect when they're saved."
        actions={
          <ButtonLink href={menuEditor} size="sm" icon="edit">
            Edit menu
          </ButtonLink>
        }
      >
        {menu.some((entry) => entry.kind === "item") && !hasDefault && (
          <Alert tone="warning" title={`${portal.label} has no default route`}>
            Choose Make default on an item in the menu editor. The default route is where people land, and promoting to Production needs one.
          </Alert>
        )}
        <Panel>
          {menu.length > 0 ? (
            tree(null, "Menu")
          ) : (
            <EmptyState title="No menu yet" icon="network">
              {`Add an item in the menu editor to route a path in ${portal.label} to one of its Applications, and a group to hold items.`}
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
                  <ButtonLink href={`${menuEditor}?add=${application.publicId}`} size="sm" icon="plus">
                    Add to menu
                  </ButtonLink>
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
