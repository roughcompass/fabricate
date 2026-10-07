import { DescriptionList } from "@/components/ui/description-list";
import { TagList } from "@/components/ui/tag";
import { CAPABILITY_LABELS, RENDERING_MODE_LABELS, type RuntimeContract } from "@/lib/onboarding/documents";

const needs = (part: RuntimeContract["requires"]) => [...part.capabilities.map((capability) => CAPABILITY_LABELS[capability]), ...part.events.map((event) => `${event} event`), ...part.context.map((key) => `${key} context`)];

/** A runtime contract as its hosts and children read it: exports, requirements, what it provides children, and shared dependencies. */
export function RuntimeContractSummary({ contract }: { contract: RuntimeContract }) {
  return (
    <DescriptionList
      surface
      items={[
        ["Exports", contract.exports.length ? <TagList key="exports" values={contract.exports.map((entry) => `${entry.name} (${entry.modes.map((mode) => RENDERING_MODE_LABELS[mode]).join(", ")})`)} /> : "None"],
        ["Requires", needs(contract.requires).join(", ") || "Nothing"],
        ["Provides children", needs(contract.provides).join(", ") || "Nothing"],
        ["Shared", contract.shared.length ? <TagList key="shared" values={contract.shared.map((item) => `${item.name}@${item.version}${item.singleton ? " singleton" : ""}`)} /> : "Nothing"],
      ]}
    />
  );
}
