import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentTemplate } from "@/components/templates/content-template";
import { type Outcome, OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
import { InjectedError } from "./demos";
import { ContentSpecimens, StatusSpecimens } from "./specimens/content";
import { ChartSpecimens, TableSpecimens } from "./specimens/data";
import { FormSpecimens } from "./specimens/forms";
import { FoundationSpecimens } from "./specimens/foundations";
import { ControlSpecimens, FeedbackSpecimens } from "./specimens/interaction";
import { TEMPLATE_SECTIONS, TemplateSpecimens } from "./specimens/templates";
import styles from "./design-system.module.css";

export const metadata: Metadata = { title: "Design system" };

const OUTCOMES: Record<string, Omit<Outcome, "id">> = {
  demo: { tone: "success", title: "The demo action finished." },
  confirmed: { tone: "success", title: "The confirmed action ran." },
};

/**
 * Every shared component in every variant and state, and every page template
 * with its empty and loading states, in both themes, on the Content template
 * with the components' index beside them. Available in development and test
 * environments only.
 */
export default async function DesignSystemPage({ searchParams }: PageProps<"/design-system">) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const tone = param(query, "tone") ?? "";
  const kinds = [query.kind].flat().filter((value): value is string => typeof value === "string");
  const code = param(query, "notice");
  const outcome = code && Object.hasOwn(OUTCOMES, code) ? { id: code, ...OUTCOMES[code]! } : undefined;

  const sections: [id: string, title: string][] = [
    ["color", "Color"],
    ["icons", "Icons"],
    ["buttons", "Buttons"],
    ["form-controls", "Form controls"],
    ["search-field", "Search field"],
    ["status", "Status and severity"],
    ["tags", "Tags and copy"],
    ["sections", "Section and panel"],
    ["description-list", "Description list"],
    ["stat-group", "Stat group"],
    ["bar-chart", "Bar chart"],
    ["media-card", "Media card"],
    ["empty-state", "Empty state"],
    ["disclosure", "Disclosure"],
    ["code-block", "Code block"],
    ["table", "Table"],
    ["tabs", "Tabs and breadcrumbs"],
    ["pagination", "Pagination"],
    ["diagram", "Diagram"],
    ["menu", "Menu"],
    ["tooltip", "Tooltip and relative time"],
    ["progress", "Progress and skeleton"],
    ["filter-bar", "Filter bar"],
    ["filter-rail", "Filter rail"],
    ["feedback", "Toast"],
    ["alert", "Alert"],
    ["dialog", "Confirmation dialog"],
    ["form-feedback", "Form feedback"],
    ["page-header", "Page header"],
    ...TEMPLATE_SECTIONS,
  ];
  const step = Number(param(query, "flowStep"));
  const flow = { step: step >= 1 && step <= 3 ? Math.trunc(step) : 1, name: param(query, "flowName") ?? "", kind: param(query, "flowKind") ?? "" };

  return (
    <ContentTemplate
      header={{
        title: "Design system",
        description: "Every shared component and page template in its variants and states, in both themes, as docs/design-system.md describes them.",
      }}
      alerts={<OutcomeToast outcome={outcome} />}
      navLabel="Components"
      nav={
        <ul className={styles.index} aria-label="Components">
          {sections.map(([id, title]) => (
            <li key={id}>
              <a href={`#${id}`}>{title}</a>
            </li>
          ))}
        </ul>
      }
    >
      <div className={styles.gallery}>
        {param(query, "inject") === "pageerror" && <InjectedError />}

        <FoundationSpecimens />
        <FormSpecimens />
        <StatusSpecimens />
        <ContentSpecimens />
        <TableSpecimens />
        <ChartSpecimens />
        <ControlSpecimens tone={tone} kinds={kinds} />
        <FeedbackSpecimens />
        <TemplateSpecimens flow={flow} />
      </div>
    </ContentTemplate>
  );
}
