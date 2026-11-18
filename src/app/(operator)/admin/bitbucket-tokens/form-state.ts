import type { FormState } from "@/components/ui/form";

/** What the Add token form shows again after a refused submission: never the token. */
export type TokenFormState = FormState<{ name: string; serverUrl: string }>;
