import type { FormState } from "@/components/ui/form";

/** An application's settings form: its name, description, and tracked branch. */
export type ApplicationFormState = FormState<{ name: string; description: string; branch: string }>;
