import type { Assessment } from "@/lib/assessments/assessment-records";
import { routes } from "@/lib/web/routes";

export interface RunContext {
  /** The Run's name: "Run #3". */
  readonly name: string;
  /** Where the Run sits: its Assessment. */
  readonly parents: readonly { readonly href: string; readonly label: string }[];
  /** What the browser title names after the Run: its Assessment. */
  readonly owner: string;
}

/** How pages under a Run name it and lead back to it. */
export function runContext(assessment: Pick<Assessment, "publicId" | "name">, number: number): RunContext {
  return {
    name: `Run #${number}`,
    parents: [
      { href: "/assessments", label: "Assessments" },
      { href: routes.assessment(assessment.publicId), label: assessment.name },
    ],
    owner: assessment.name,
  };
}
