import { useState } from "react";
import {
  Button,
  H2,
  MultilineInput,
  Panel,
  StackLayout,
  FlexLayout,
  StatusIndicator,
  Text,
  Divider,
} from "@salt-ds/core";
import { CheckmarkIcon } from "@salt-ds/icons";
import { useBus } from "@deweb/portal";
import { CLIENTS, CHECKS } from "../data";
import type { Client } from "../data";

const findClient = (id: string) => CLIENTS.find((entry) => entry.id === id);

function useSelectedClient(): Client {
  const [id, setId] = useState<string>(CLIENTS[0]!.id);
  useBus("client:selected", "kyc-checklist", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && findClient(next)) setId(next);
  });
  return findClient(id)!;
}

/**
 * PLANTED DEFECTS (KYC checklist 3.2.0): the note field has no label and the
 * check descriptions use a literal faint gray. Version 3.3.0 fixes both.
 */
export default function KycChecklist() {
  const current = useSelectedClient();
  const [done, setDone] = useState<readonly string[]>(
    CHECKS.filter((check) => check.done).map((check) => check.id),
  );

  return (
    <Panel data-demo-anchor="kyc-panel">
      <StackLayout gap={1}>
        <H2 styleAs="h3">{`KYC · ${current.name}`}</H2>
        <StackLayout as="ul" gap={0} role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {CHECKS.map((check, index) => (
            <li key={check.id} data-demo-anchor={`check-${check.id}`}>
              {index > 0 && <Divider variant="tertiary" />}
              <FlexLayout
                justify="space-between"
                align="center"
                gap={1}
                style={{ paddingBlock: "var(--salt-spacing-50)" }}
              >
                <Text style={{ color: "#b0b0b0" }}>{check.label}</Text>
                {done.includes(check.id) ? (
                  <FlexLayout gap={0.5} align="center" style={{ flexShrink: 0 }}>
                    <StatusIndicator status="success" />
                    <Text>Done</Text>
                  </FlexLayout>
                ) : (
                  <Button
                    sentiment="neutral"
                    appearance="transparent"
                    onClick={() => setDone((ids) => [...ids, check.id])}
                    data-demo-anchor={`complete-${check.id}`}
                    style={{ flexShrink: 0 }}
                  >
                    <CheckmarkIcon aria-hidden />
                  </Button>
                )}
              </FlexLayout>
            </li>
          ))}
        </StackLayout>
        <Text color="secondary">Reviewer note</Text>
        <MultilineInput rows={2} textAreaProps={{ "data-demo-anchor": "kyc-note" } as Record<string, string>} />
      </StackLayout>
    </Panel>
  );
}
