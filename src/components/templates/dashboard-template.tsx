import Link from "next/link";
import { Page, PageHeader, type TemplateHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { PanelBoundary } from "./panel-boundary";
import { EmptyZone, FiguresSkeleton, HeaderSkeleton, type SpecimenOption, TableSkeleton, type TemplateEmpty, Zone, specimenHeader } from "./parts";
import styles from "./templates.module.css";

interface DashboardProps extends SpecimenOption {
  /** A title, one sentence, and at most one primary action; a Dashboard has no breadcrumbs. */
  header: TemplateHeader<"dashboard">;
  alerts?: React.ReactNode;
  /** What needs someone, first and full width; optional. */
  attention?: React.ReactNode;
  /** A row of at most five key figures. */
  figures?: React.ReactNode;
  /** Shown in place of the figures and panels when there is nothing to summarize yet. */
  empty?: TemplateEmpty;
  /** The fixed grid of panels, each a DashboardPanel. */
  children?: React.ReactNode;
}

/**
 * Dashboard (page-templates spec): a landing page. The page header, then
 * alerts, an optional list of what needs attention, a row of key figures,
 * and a fixed grid of panels, two to a row on a wide column. Modeled on
 * Cloudscape's service dashboard and Polaris's Homepage.
 */
export function DashboardTemplate({ header, alerts, attention, figures, empty, children, specimen }: DashboardProps) {
  return (
    <Page>
      <PageHeader template="dashboard" {...header} alerts={alerts} {...specimenHeader(specimen)} />
      {attention && <Zone name="attention">{attention}</Zone>}
      {empty ? (
        <EmptyZone empty={empty} />
      ) : (
        <>
          {figures && (
            <Zone name="figures">
              <div data-key-figures="">{figures}</div>
            </Zone>
          )}
          {children && (
            <Zone name="panels" className={styles.panels}>
              {children}
            </Zone>
          )}
        </>
      )}
    </Page>
  );
}

interface DashboardPanelProps {
  title: string;
  description?: React.ReactNode;
  /** The full list the panel summarizes; its label names that list. */
  link?: { href: string; label: string };
  /** Lets a table or list run edge to edge. */
  flush?: boolean;
  /** Spans the grid's full width. */
  wide?: boolean;
  children: React.ReactNode;
}

/**
 * One panel of a Dashboard: a heading, a link to the list it summarizes, and
 * its content. A panel whose content fails shows its own error with Try
 * again, and the other panels render (PanelBoundary).
 */
export function DashboardPanel({ title, description, link, flush = false, wide = false, children }: DashboardPanelProps) {
  return (
    <div className={styles.panelCell} data-wide={wide || undefined} data-dashboard-panel="">
      <Panel title={title} description={description} flush={flush} actions={link && <Link href={link.href}>{link.label}</Link>}>
        <PanelBoundary title={title}>{children}</PanelBoundary>
      </Panel>
    </div>
  );
}

/** A Dashboard while it loads: the header, the figures, and two panels. */
export function DashboardSkeleton({ figures = 4, actions = 2 }: { figures?: number; actions?: number }) {
  return (
    <Page busy>
      <HeaderSkeleton actions={actions} description />
      <FiguresSkeleton count={figures} />
      <div className={styles.panels}>
        <TableSkeleton rows={3} />
        <TableSkeleton rows={3} />
      </div>
    </Page>
  );
}
