import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import type { ContractDifference } from "@/lib/onboarding/contracts";

const WORDS: Record<string, string> = {
  module_federation_2: "Module Federation 2",
  esm: "ESM",
  iframe: "iframe",
  ownerTeam: "Owning team",
  sealId: "SEAL ID",
  allowedOrigins: "Allowed origins",
  inheritFrom: "Inherited from",
  requireIntegrity: "Integrity required",
  runtimeVersion: "Federation runtime versions",
  requiredCapabilities: "Required capabilities",
  hostContract: "Host contract",
  workspacePath: "Workspace path",
  defaultRequested: "Default requested",
  menuParent: "Menu group",
  appId: "appId",
  viewId: "viewId",
};

/** "modes.esm.shared.react.version" as "ESM › Shared › react › Version". */
export function differencePath(path: string): string {
  return path
    .split(".")
    .filter(Boolean)
    .map((part) => WORDS[part] ?? (/^[a-z]+$/.test(part) ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" › ");
}

const CHANGES = { added: "Added", removed: "Removed", changed: "Changed" } as const;

/** What changed between two revisions, one readable row per change. */
export function DifferencesTable({ differences, label, empty }: { differences: readonly ContractDifference[]; label: string; empty: string }) {
  return (
    <Panel flush>
      {differences.length > 0 ? (
        <Table
          label={label}
          head={
            <>
              <Th>Field</Th>
              <Th>Change</Th>
              <Th>Before</Th>
              <Th>After</Th>
            </>
          }
        >
          {differences.map((difference, index) => (
            <tr key={`${difference.path}-${index}`}>
              <Td label="Field">{differencePath(difference.path) || "Document"}</Td>
              <Td label="Change">{CHANGES[difference.change]}</Td>
              <Td label="Before">{difference.before === null ? "—" : <Tag label="before">{difference.before}</Tag>}</Td>
              <Td label="After">{difference.after === null ? "—" : <Tag label="after">{difference.after}</Tag>}</Td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState title="No changes">{empty}</EmptyState>
      )}
    </Panel>
  );
}
