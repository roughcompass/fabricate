import { EmptyState } from "@/components/ui/empty-state";
import type { IconName } from "@/components/ui/icon";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import styles from "./templates.module.css";

/**
 * Options every template takes for the component gallery's specimens: the
 * title as an `h3` under the gallery's own headings, and no page-alert slot,
 * so a specimen never adds a second top-level heading or alert slot.
 */
export interface SpecimenOption {
  specimen?: boolean;
}

/** The page header's props for a specimen or a page. */
export const specimenHeader = (specimen: boolean | undefined) => (specimen ? ({ headingLevel: 3, alerts: false } as const) : {});

/** What an empty template shows in place of its records: what's missing, and the action that fills it or why none applies. */
export interface TemplateEmpty {
  title: string;
  /** One sentence. */
  children: React.ReactNode;
  action?: React.ReactNode;
  icon?: IconName;
}

/** A template's empty state, on its own surface. */
export function EmptyZone({ empty }: { empty: TemplateEmpty }) {
  return (
    <Panel flush>
      <EmptyState title={empty.title} icon={empty.icon} action={empty.action}>
        {empty.children}
      </EmptyState>
    </Panel>
  );
}

/** A zone below the page header, marked so checks can find it. */
export function Zone({ name, className, children }: { name: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className ?? styles.zone} data-zone={name}>
      {children}
    </div>
  );
}

/** Which parts of a page header a skeleton draws, in the header's order. */
export interface HeaderShape {
  breadcrumbs?: boolean;
  /** How many action buttons sit at the title row's end. */
  actions?: number;
  meta?: boolean;
  description?: boolean;
  tabs?: number;
}

/** A page header's skeleton: placeholders in the places its template's header puts its parts. */
export function HeaderSkeleton({ breadcrumbs = false, actions = 0, meta = false, description = false, tabs = 0 }: HeaderShape) {
  return (
    <div className={styles.headerSkeleton} data-header-skeleton="">
      {breadcrumbs && <Skeleton width="short" />}
      <div className={styles.titleRowSkeleton}>
        <span className={styles.titleSkeleton}>
          <Skeleton width="medium" height="title" />
        </span>
        {actions > 0 && (
          <span className={styles.actionsSkeleton}>
            {Array.from({ length: actions }, (_, index) => (
              <span key={index} className={styles.actionSkeleton} data-primary={index === actions - 1 || undefined} aria-hidden="true" />
            ))}
          </span>
        )}
      </div>
      {meta && <Skeleton width="medium" />}
      {description && <Skeleton width="long" />}
      {tabs > 0 && (
        <span className={styles.tabsSkeleton}>
          {Array.from({ length: tabs }, (_, index) => (
            <span key={index} className={styles.tabSkeleton} aria-hidden="true" />
          ))}
        </span>
      )}
    </div>
  );
}

/** Rows of a table on its surface, while it loads. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className={styles.panelSkeleton}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.rowSkeleton}>
          <Skeleton width="medium" />
          <Skeleton width="long" />
          <Skeleton width="short" />
        </div>
      ))}
    </div>
  );
}

/** A row of key figures, while they load. */
export function FiguresSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={styles.figuresSkeleton}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.figureSkeleton}>
          <Skeleton width="short" />
          <Skeleton width="medium" height="title" />
        </div>
      ))}
    </div>
  );
}

/** A surface of labelled fields, while it loads. */
export function FieldsSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <div className={styles.fieldsSkeleton}>
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className={styles.fieldSkeleton}>
          <Skeleton width="short" />
          <Skeleton height="control" />
        </div>
      ))}
    </div>
  );
}
