import type { Choice, FormState } from "@/components/ui/form";

/** A claim form's submitted values, by field: one value, or several for check boxes. */
export type ClaimFormValues = Record<string, string | string[]>;

export type ClaimFormState = FormState<ClaimFormValues> & {
  /** The applications that carry a SEAL ID the form named, when the person must choose between them. */
  applications?: Choice[];
};

export type ClaimAction = (previous: ClaimFormState, formData: FormData) => Promise<ClaimFormState>;

/** The cookie that remembers the name or email a claimant entered, to fill it in next time. It isn't a credential. */
export const CLAIMANT_COOKIE = "fabricate-claimant";

