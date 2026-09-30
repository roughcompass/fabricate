import type { FormState } from "@/components/ui/form";

export interface StandardFormValues {
  name: string;
  purpose: string;
}

export type StandardFormState = FormState<StandardFormValues>;

export interface DraftIssue {
  field: string;
  message: string;
}

/** The result of saving a draft: its new lock version and the complete validation result. */
export interface DraftSaveState {
  lockVersion: number;
  issues: DraftIssue[];
  status: "unsaved" | "saved" | "stale" | "rejected";
  message: string | null;
  submission: number;
}
