import type { Initiative } from "@/lib/initiatives/initiative-records";
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
export function runContext(initiative: Pick<Initiative, "publicId" | "name">, number: number): RunContext {
  return {
    name: `Run #${number}`,
    parents: [
      { href: "/assessments", label: "Assessments" },
      { href: routes.assessment(initiative.publicId), label: initiative.name },
    ],
    owner: initiative.name,
  };
}
