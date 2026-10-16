import { useState } from "react";
import {
  Button,
  FormField,
  FormFieldLabel,
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

export default function KycChecklist() {
  const current = useSelectedClient();
  const [done, setDone] = useState<readonly string[]>(
    CHECKS.filter((check) => check.done).map((check) => check.id),
  );

  return (
    <Panel data-demo-anchor="kyc-panel">
      <StackLayout gap={2}>
        <H2 styleAs="h3">{`KYC · ${current.name}`}</H2>
        <StackLayout as="ul" gap={0} role="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {CHECKS.map((check, index) => (
            <li key={check.id} data-demo-anchor={`check-${check.id}`}>
              {index > 0 && <Divider variant="tertiary" />}
              <FlexLayout
                justify="space-between"
                align="center"
                gap={1}
                style={{ paddingBlock: "var(--salt-spacing-100)" }}
              >
                <Text>{check.label}</Text>
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
                    aria-label={`Complete: ${check.label}`}
                    style={{ flexShrink: 0 }}
                  >
                    <CheckmarkIcon aria-hidden />
                    Complete
                  </Button>
                )}
              </FlexLayout>
            </li>
          ))}
        </StackLayout>
        <FormField>
          <FormFieldLabel>Reviewer note</FormFieldLabel>
          <MultilineInput
            rows={2}
            textAreaProps={{ id: "kyc-note", "data-demo-anchor": "kyc-note" }}
          />
        </FormField>
      </StackLayout>
    </Panel>
  );
}
