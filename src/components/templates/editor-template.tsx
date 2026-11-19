import { Page, PageHeader, type TemplateHeader } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyZone, HeaderSkeleton, type SpecimenOption, TableSkeleton, type TemplateEmpty, Zone, specimenHeader } from "./parts";
import styles from "./templates.module.css";

interface EditorPageProps extends SpecimenOption {
  focused?: undefined;
  /** Breadcrumbs, the title with its status, and a secondary action to view what's published; save and publish sit in the save bar. */
  header: TemplateHeader<"editor">;
  /** Validation alerts. */
  alerts?: React.ReactNode;
  /** An optional outline pane beside the editing area. */
  outline?: React.ReactNode;
  /** An optional preview pane beside the editing area. */
  preview?: React.ReactNode;
  /** Shown in place of the editing area when there's nothing to edit yet. */
  empty?: TemplateEmpty;
  /** The editing area. An editor whose save bar shares its client state renders the bar at its end itself. */
  children?: React.ReactNode;
  /** The sticky bar that holds save and publish and says whether every change is saved. */
  saveBar?: React.ReactNode;
}

interface FocusedProps extends SpecimenOption {
  /**
   * The focused variant, for a page that gives the content column to one
   * subject, such as preview mode: no page header, the sidebar hidden, and
   * the title as the page's only `h1`, for assistive technology only. Its
   * shell header holds the back button (src/app/(operator)/@header).
   */
  focused: { title: string };
  children: React.ReactNode;
}

/**
 * Editor (page-templates spec): authoring structured content. The page
 * header, then validation alerts, the editing area with optional outline and
 * preview panes, and a sticky save bar. Modeled on Fiori's object page in edit
 * mode and Polaris's save bar. Its focused variant, for preview mode, follows
 * Primer's page layout without a header.
 */
export function EditorTemplate(props: EditorPageProps | FocusedProps) {
  if (props.focused) {
    const { focused, specimen, children } = props;
    const Heading = specimen ? "h3" : "h1";
    return (
      <Page>
        <div className={styles.focused} data-focused-page={specimen ? undefined : ""}>
          <Heading className="visually-hidden">{focused.title}</Heading>
          {children}
        </div>
      </Page>
    );
  }
  const { header, alerts, outline, preview, empty, children, saveBar, specimen } = props;
  const panes = outline || preview;
  return (
    <Page>
      <PageHeader template="editor" {...header} alerts={alerts} {...specimenHeader(specimen)} />
      {empty ? (
        <EmptyZone empty={empty} />
      ) : panes ? (
        <div className={styles.editorPanes} data-preview={preview ? "" : undefined}>
          {outline && <Zone name="outline">{outline}</Zone>}
          <Zone name="editing">{children}</Zone>
          {preview && <Zone name="preview">{preview}</Zone>}
        </div>
      ) : (
        children && <Zone name="editing">{children}</Zone>
      )}
      {saveBar && (
        <Zone name="save-bar" className={styles.saveBar}>
          {saveBar}
        </Zone>
      )}
    </Page>
  );
}

/** An Editor while it loads: the header, the editing area, and the save bar; focused, the content with the sidebar already hidden. */
export function EditorSkeleton({ focused = false }: { focused?: boolean }) {
  if (focused) {
    return (
      <Page busy>
        <div className={styles.focused} data-focused-page="">
          <Skeleton width="short" height="control" />
          <span className={styles.workspaceSkeleton} aria-hidden="true" />
        </div>
      </Page>
    );
  }
  return (
    <Page busy>
      <HeaderSkeleton breadcrumbs actions={1} description />
      <TableSkeleton rows={4} />
      <span className={styles.saveBarSkeleton} aria-hidden="true" />
    </Page>
  );
}
