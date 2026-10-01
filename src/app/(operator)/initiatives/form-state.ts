import type { FormState } from "@/components/ui/form";
import type { SelectionMode } from "@/lib/db/schema";

export interface InitiativeFormValues {
  name: string;
  objective: string;
  selectionMode: SelectionMode;
  sourcePublicIds: string[];
  standardReleasePublicIds: string[];
}

export type InitiativeFormState = FormState<InitiativeFormValues>;

export interface LaunchState {
  problems: string[];
}
