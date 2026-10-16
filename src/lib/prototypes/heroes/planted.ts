import type { PlantedRule } from "@/lib/demo/catalog";
import type { GateExemption } from "../types";

/**
 * The catalog's planted rules, as hero generation plants them
 * (converge-templates-and-prototypes, design decision 6; portal-runtime
 * spec, "Hero source passes DE FabLab's gates"). Each rule's instruction asks
 * for exactly that defect, and its exemption names the gate issues the
 * defect may cause, so a planted version breaks only its own rules. The
 * accessibility rules are found by the audit, not the gates, so they exempt
 * nothing.
 */
export const PLANTED: Readonly<Record<PlantedRule, { readonly instruction: string; readonly codes: readonly string[] }>> = {
  label: { instruction: "Leave the search field without a visible or accessible label: no FormField label, no aria-label.", codes: [] },
  "color-contrast": {
    instruction: "Show the secondary text in one literal light gray, #b0b0b0, through a style prop, so it fails WCAG contrast on the light background. Use no other literal color.",
    codes: ["salt-only/literal-color", "salt-only/style-value"],
  },
  "button-name": { instruction: "Make the row actions icon-only buttons with no accessible name: no text, and no aria-label, aria-labelledby, or title on the button. Leave this one defect even though it is wrong.", codes: [] },
  "image-alt": { instruction: "Show the logo image without an alt attribute.", codes: [] },
};

/** What a planted version's gates may waive, by rule. */
export function plantedExemptions(rules: readonly string[] | undefined): GateExemption[] {
  return (rules ?? []).flatMap((rule) => {
    const planted = PLANTED[rule as PlantedRule];
    return planted ? [{ rule, codes: planted.codes }] : [];
  });
}
