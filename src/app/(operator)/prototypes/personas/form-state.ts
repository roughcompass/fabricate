import type { FormState } from "@/components/ui/form";

export interface PersonaFormValues {
  name: string;
  role: string;
  organizationType: string;
  /** One per line. */
  goals: string;
  context: string;
  /** One per line. */
  constraints: string;
  distinction: string;
}

export type PersonaFormState = FormState<PersonaFormValues>;
