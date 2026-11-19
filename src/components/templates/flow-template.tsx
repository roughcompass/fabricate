import { FormFooter } from "@/components/ui/form";
import { Page, PageHeader, type TemplateHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { StepIndicator } from "@/components/ui/step-indicator";
import { EmptyZone, FieldsSkeleton, HeaderSkeleton, type SpecimenOption, type TemplateEmpty, Zone, specimenHeader } from "./parts";
import styles from "./templates.module.css";

interface FlowProps extends SpecimenOption {
  /** Breadcrumbs and a title naming the task, the same on every step. */
  header: TemplateHeader<"flow">;
  alerts?: React.ReactNode;
  /** Three to five step titles; the last is the review. */
  steps: readonly string[];
  /** The step shown, from 1. */
  current: number;
  /** The step's content; the review step lists every value with a link to change it. */
  children?: React.ReactNode;
  /** Cancel, which asks before discarding entered values, Previous, and Next or the finishing action. */
  footer?: React.ReactNode;
  /** Shown in place of the steps when the task can't start yet, with the action that makes it possible. */
  empty?: TemplateEmpty;
}

/**
 * Flow (page-templates spec): a task of three to five steps, ending in a
 * review. The page header, then the step indicator, the step's title and
 * content, and a footer with Cancel, Previous, and Next or the finishing
 * action. Modeled on Cloudscape's multipage create and Salt's Wizard.
 */
export function FlowTemplate({ header, alerts, steps, current, children, footer, empty, specimen }: FlowProps) {
  const step = steps[current - 1] ?? steps[0]!;
  return (
    <Page width="form">
      <PageHeader template="flow" {...header} alerts={alerts} {...specimenHeader(specimen)} />
      {empty ? (
        <EmptyZone empty={empty} />
      ) : (
        <>
          <Zone name="steps">
            <StepIndicator steps={steps} current={current} />
          </Zone>
          <Zone name="step">
            <Panel title={step} level={specimen ? 3 : 2} footer={footer && <FormFooter>{footer}</FormFooter>}>
              {children}
            </Panel>
          </Zone>
        </>
      )}
    </Page>
  );
}

/** A Flow while it loads: the header, the step indicator, and the step's fields. */
export function FlowSkeleton() {
  return (
    <Page width="form" busy>
      <HeaderSkeleton breadcrumbs />
      <span className={styles.stepsSkeleton}>
        <Skeleton width="long" />
      </span>
      <FieldsSkeleton fields={2} />
    </Page>
  );
}
