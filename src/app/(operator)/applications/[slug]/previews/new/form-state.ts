import type { FormState } from "@/components/ui/form";

/** New preview: the branch or tag to keep built. */
export type NewPreviewFormState = FormState<{ ref: string }>;
