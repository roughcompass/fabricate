import type { FormState } from "@/components/ui/form";
import type { SelectionMode } from "@/lib/db/schema";

export interface AssessmentFormValues {
  name: string;
  objective: string;
  selectionMode: SelectionMode;
  sourcePublicIds: string[];
  standardReleasePublicIds: string[];
}

export type AssessmentFormState = FormState<AssessmentFormValues>;

export interface LaunchState {
  problems: string[];
}
