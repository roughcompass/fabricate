import type { FormState } from "@/components/ui/form";

/** A claim form's submitted values, by field: one value, or several for check boxes. */
export type ClaimFormValues = Record<string, string | string[]>;

export type ClaimFormState = FormState<ClaimFormValues>;

export type ClaimAction = (previous: ClaimFormState, formData: FormData) => Promise<ClaimFormState>;

/** The cookie that remembers the name or email a claimant entered, to fill it in next time. It isn't a credential. */
export const CLAIMANT_COOKIE = "fabricate-claimant";

export const empty = (values: ClaimFormValues = {}): ClaimFormState => ({ values, errors: {} });
