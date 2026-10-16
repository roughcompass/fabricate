import type { DialogState } from "@/components/onboarding/form-dialog";

/** Create Application's form state: values and field errors, and a link for an error that names another Application. */
export type CreateApplicationState = DialogState & { links?: Record<string, { href: string; label: string }> };
