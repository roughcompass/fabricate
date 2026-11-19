import { Page, PageHeader, type TemplateHeader } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyZone, headerWhileEmpty, HeaderSkeleton, type SpecimenOption, TableSkeleton, type TemplateEmpty, Zone, specimenHeader } from "./parts";
import styles from "./templates.module.css";

interface IndexProps extends SpecimenOption {
  /** The title, and at most one primary action, which creates or adds; breadcrumbs only for a list that belongs to a record. */
  header: TemplateHeader<"index">;
  alerts?: React.ReactNode;
  /** View tabs with counts, when the collection has them. */
  tabs?: React.ReactNode;
  /** The filter bar, such as a search, with the result count beside the results; it spans the page above a filter rail and its results. */
  filters?: React.ReactNode;
  /** A filter rail beside a card grid. */
  rail?: React.ReactNode;
  /** Shown in place of the results when the collection is empty; its action is the primary action's. */
  empty?: TemplateEmpty;
  /** The table on its surface, or the card grid. */
  children?: React.ReactNode;
  /** The pages of a long list. */
  pagination?: React.ReactNode;
}

/**
 * Index (page-templates spec): a collection. The page header, then alerts,
 * view tabs with counts, the filter bar, the table or a card grid with its
 * filter rail beside it, with the result count, and pagination. Modeled on
 * Cloudscape's table and card views, Polaris's Index, and Fiori's list report.
 */
export function IndexTemplate({ header, alerts, tabs, filters, rail, empty, children, pagination, specimen }: IndexProps) {
  const results = (
    <>
      {empty ? <EmptyZone empty={empty} /> : children && <Zone name="results">{children}</Zone>}
      {!empty && pagination && <Zone name="pagination">{pagination}</Zone>}
    </>
  );
  return (
    <Page>
      <PageHeader template="index" {...headerWhileEmpty(header, empty)} alerts={alerts} {...specimenHeader(specimen)} />
      {tabs && <Zone name="tabs">{tabs}</Zone>}
      {filters && <Zone name="filters">{filters}</Zone>}
      {rail ? (
        <div className={styles.railLayout}>
          <Zone name="rail">{rail}</Zone>
          <div className={styles.column}>{results}</div>
        </div>
      ) : (
        results
      )}
    </Page>
  );
}

interface IndexSkeletonProps {
  breadcrumbs?: boolean;
  actions?: number;
  tabs?: number;
  filters?: boolean;
  /** Cards beside a filter rail, rather than a table. */
  cards?: boolean;
  /** A table laid out as the page lays out its own, such as the Repositories list's. */
  table?: React.ReactNode;
}

/** An Index while it loads: its header, tabs, filter bar, and table rows or cards. */
export function IndexSkeleton({ breadcrumbs = false, actions = 1, tabs = 0, filters = false, cards = false, table }: IndexSkeletonProps) {
  return (
    <Page busy>
      <HeaderSkeleton breadcrumbs={breadcrumbs} actions={actions} description />
      {tabs > 0 && <HeaderSkeleton tabs={tabs} />}
      {cards ? (
        <div className={styles.railLayout}>
          <div className={styles.column}>
            <Skeleton width="long" />
            <Skeleton width="medium" />
          </div>
          <div className={styles.cardsSkeleton}>
            {Array.from({ length: 6 }, (_, index) => (
              <span key={index} className={styles.cardSkeleton} aria-hidden="true" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {filters && (
            <div className={styles.filtersSkeleton}>
              <span className={styles.countSkeleton}>
                <Skeleton width="long" />
              </span>
              <span className={styles.searchSkeleton} aria-hidden="true" />
            </div>
          )}
          {table ?? <TableSkeleton rows={6} />}
        </>
      )}
    </Page>
  );
}
