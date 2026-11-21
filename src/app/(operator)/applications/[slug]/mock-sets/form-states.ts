import type { FormState } from "@/components/ui/form";
import type { HostMapping } from "@/lib/mocks/model";
import type { RuleFields } from "@/lib/mocks/views";

/** New rule and Edit rule: the rule's fields, and the version an edit was made from, which a stale edit moves on. */
export type RuleFormState = FormState<RuleFields> & { lockVersion: number };

/** New mock set and Edit mock set: its settings, and for an edit, its version. */
export type SetFormState = FormState<{ name: string; description: string; hostMode: string; hosts: readonly HostMapping[]; unmatched: string; calls: readonly string[] }> & { lockVersion: number };

/** Review HAR: the new set's name, its hosts, and the default box, as the review last had them. */
export type ReviewFormState = FormState<{ name: string; makeDefault: boolean; hostMode: string; hosts: readonly HostMapping[] }>;

/** Delete mock set on its edit page: the name typed to confirm. */
export type DeleteSetFormState = FormState<{ confirmation: string }>;

/** A saved preview's Mock set form: its choice. */
export type PreviewSetFormState = FormState<{ choice: string }>;
