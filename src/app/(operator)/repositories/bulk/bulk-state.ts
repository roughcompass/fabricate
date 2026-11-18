import type { FormState } from "@/components/ui/form";
import type { BulkFailure } from "@/lib/catalog/bulk-add";

/** The bulk form after a submission: the lines left to fix, and what was added and refused. */
export interface BulkFormState extends FormState<{ urls: string }> {
  readonly added: number;
  readonly failed: readonly BulkFailure[];
}
