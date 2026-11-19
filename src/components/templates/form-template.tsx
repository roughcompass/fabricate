import { FormFooter } from "@/components/ui/form";
import { Page, PageHeader, type TemplateHeader } from "@/components/ui/page";
import { EmptyZone, FieldsSkeleton, HeaderSkeleton, type SpecimenOption, type TemplateEmpty, Zone, specimenHeader } from "./parts";
import styles from "./templates.module.css";

interface FormProps extends SpecimenOption {
  /** Breadcrumbs and a title naming the task, such as "New Repository"; a Form's header holds no actions. */
  header: TemplateHeader<"form">;
  alerts?: React.ReactNode;
  /** `content` for a review that shows tables, such as publishing a Release; every other form is at the form width. */
  width?: "form" | "content";
  /** Shown in place of the form when nothing can be entered yet, with the action that makes it possible. */
  empty?: TemplateEmpty;
  /** The form: its sections, optional settings behind a disclosure, and its footer with Cancel and the submit action. */
  children?: React.ReactNode;
  /** Cancel and the submit action, when they aren't part of a form element, as when publishing a Release. */
  footer?: React.ReactNode;
}

/**
 * Form (page-templates spec): create, edit, or publish one record on one
 * page. The page header, with no actions, then alerts, the form's sections
 * at the form width, and a footer with Cancel and the submit action, which
 * stays enabled. Modeled on Cloudscape's single-page create and Salt's Forms
 * and Button bar.
 */
export function FormTemplate({ header, alerts, width = "form", empty, children, footer, specimen }: FormProps) {
  return (
    <Page width={width}>
      <PageHeader template="form" {...header} alerts={alerts} {...specimenHeader(specimen)} />
      {empty ? <EmptyZone empty={empty} /> : children && <Zone name="form">{children}</Zone>}
      {footer && (
        <Zone name="footer" className={styles.formFooter}>
          <FormFooter>{footer}</FormFooter>
        </Zone>
      )}
    </Page>
  );
}

/** A Form while it loads: breadcrumbs, the title, and a surface of fields. */
export function FormSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <Page width="form" busy>
      <HeaderSkeleton breadcrumbs description />
      <FieldsSkeleton fields={fields} />
    </Page>
  );
}
