import { TabLink, Tabs } from "@/components/ui/tabs";

export interface Step {
  id: string;
  label: string;
  href: string;
  /** Blocking issues the latest check found at this step. */
  issues?: number;
}

/** A Draft's steps, each a page with its own form; the counts are the issues at each step. */
export function DraftSteps({ steps, current, label }: { steps: readonly Step[]; current: string; label: string }) {
  return (
    <Tabs label={label}>
      {steps.map((step) => (
        <TabLink key={step.id} href={step.href} active={step.id === current} count={step.issues || undefined}>
          {step.label}
        </TabLink>
      ))}
    </Tabs>
  );
}
