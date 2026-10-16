import type { FormState } from "@/components/ui/form";

export interface ComposerValues {
  intent: string;
  scope: string;
  personas: string[];
  variants: string;
  /** The attached template's id, or empty. */
  template: string;
}

export type ComposerState = FormState<ComposerValues>;
