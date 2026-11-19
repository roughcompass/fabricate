import type { FormState } from "@/components/ui/form";

/** The Repository page's preview form: a branch or tag from the remote ("configured" for the configured reference), or a commit SHA. */
export type PrepareFormState = FormState<{ ref: string; commit: string }>;
