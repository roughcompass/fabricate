import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { Status } from "@/components/ui/status";
import { Secondary, Table, Td, Th } from "@/components/ui/table";
import type { ValidationIssue } from "@/lib/onboarding/issues";

/**
 * Validation issues, each at the step and field it's about, linked there so a
 * person can fix it. Blocking issues stop submission; warnings don't.
 */
export function ValidationIssues({ issues, stepOf, label = "Validation issues" }: { issues: readonly ValidationIssue[]; stepOf: (location: string) => { href: string; label: string }; label?: string }) {
  if (issues.length === 0) {
    return (
      <Panel flush>
        <EmptyState title="No issues" icon="checkCircle">
          Every check passes. Submitting freezes this revision.
        </EmptyState>
      </Panel>
    );
  }
  return (
    <Panel flush>
      <Table
        label={label}
        head={
          <>
            <Th>Issue</Th>
            <Th>Where</Th>
            <Th>Kind</Th>
          </>
        }
      >
        {issues.map((issue, index) => {
          const step = stepOf(issue.location);
          return (
            <tr key={`${issue.code}-${issue.location}-${index}`}>
              <Td label="Issue">
                {issue.message}
                <Secondary mono>{issue.code}</Secondary>
              </Td>
              <Td label="Where">
                <Link href={step.href}>{step.label}</Link>
              </Td>
              <Td label="Kind">
                <Status state={issue.severity} />
              </Td>
            </tr>
          );
        })}
      </Table>
    </Panel>
  );
}
