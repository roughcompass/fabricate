import type { FormState } from "@/components/ui/form";

/** Onboarding's forms: a clone URL to register or find, the branch to check, and the details to create with. */
export type CloneUrlState = FormState<{ cloneUrl: string }>;
export type BranchState = FormState<{ branch: string }>;
export type DetailsState = FormState<{ name: string; description: string; trusted: boolean }>;
