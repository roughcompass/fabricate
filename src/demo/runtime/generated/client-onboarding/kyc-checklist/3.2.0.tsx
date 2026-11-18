import { useBus } from "@deweb/portal";
import { Button, FlexItem, FlexLayout, FormField, FormFieldLabel, H2, MultilineInput, Panel, StackLayout, StatusIndicator, Text } from "@salt-ds/core";
import { CheckmarkIcon } from "@salt-ds/icons";
import { useState } from "react";
import { CHECKS, CLIENTS, type Client } from "../data";
import styles from "./3.2.0.module.css";

const findClient = (id: string) => CLIENTS.find((client) => client.id === id);

function useSelectedClient(): Client {
  const [id, setId] = useState(CLIENTS[0]!.id);
  useBus("client:selected", "kyc-checklist", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && findClient(next)) setId(next);
  });
  return findClient(id)!;
}

export default function KycChecklist() {
  const client = useSelectedClient();
  const [done, setDone] = useState<readonly string[]>(CHECKS.filter((check) => check.done).map((check) => check.id));

  return (
    <Panel data-demo-anchor="kyc-panel">
      <StackLayout gap={2}>
        <H2>{`KYC · ${client.name}`}</H2>
        <StackLayout as="ul" gap={1} separators className={styles.list}>
          {CHECKS.map((check) => (
            <FlexLayout as="li" key={check.id} justify="space-between" align="center" gap={1} data-demo-anchor={`check-${check.id}`}>
              <Text>{check.label}</Text>
              <FlexItem shrink={0}>
                {done.includes(check.id) ? (
                  <FlexLayout gap={1} align="center">
                    <StatusIndicator status="success" aria-hidden />
                    <Text>Done</Text>
                  </FlexLayout>
                ) : (
                  <Button sentiment="neutral" appearance="transparent" aria-label={`Complete: ${check.label}`} onClick={() => setDone((ids) => [...ids, check.id])} data-demo-anchor={`complete-${check.id}`}>
                    <CheckmarkIcon aria-hidden />
                  </Button>
                )}
              </FlexItem>
            </FlexLayout>
          ))}
        </StackLayout>
        <FormField>
          <FormFieldLabel>Reviewer note</FormFieldLabel>
          <MultilineInput rows={2} textAreaProps={{ "data-demo-anchor": "kyc-note" }} />
        </FormField>
      </StackLayout>
    </Panel>
  );
}
