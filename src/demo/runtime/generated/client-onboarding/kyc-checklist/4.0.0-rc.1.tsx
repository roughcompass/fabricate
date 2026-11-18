import { useBus } from "@deweb/portal";
import { Button, Display4, FlexItem, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, H2, H3, LinearProgress, MultilineInput, Panel, StackLayout, StatusIndicator, Tag, Text } from "@salt-ds/core";
import { CheckmarkIcon } from "@salt-ds/icons";
import { useState } from "react";
import { CHECKS, CLIENTS, type Client } from "../data";
import styles from "./4.0.0-rc.1.module.css";

const findClient = (id: string) => CLIENTS.find((client) => client.id === id);
const GROUPS = [...new Set(CHECKS.map((check) => check.group))];

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
  const remaining = CHECKS.length - done.length;
  const progress = Math.round((done.length / CHECKS.length) * 100);

  return (
    <Panel data-demo-anchor="kyc-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={1} wrap>
          <H2>{`KYC · ${client.name}`}</H2>
          <Tag>{`Preview: ${done.length} of ${CHECKS.length} complete`}</Tag>
        </FlexLayout>
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            Steps remaining
          </Text>
          <Display4 className={styles.figure}>{`${remaining}`}</Display4>
          <LinearProgress className={styles.meter} value={progress} hideLabel aria-label={`KYC for ${client.name} ${progress}% complete`} />
          <Text color="secondary">{remaining ? "Complete every step before approval." : "Ready for approval."}</Text>
        </StackLayout>
        {GROUPS.map((group) => (
          <StackLayout key={group} gap={1}>
            <H3>{group}</H3>
            <StackLayout as="ul" gap={1} separators className={styles.list}>
              {CHECKS.filter((check) => check.group === group).map((check) => (
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
                        Complete
                      </Button>
                    )}
                  </FlexItem>
                </FlexLayout>
              ))}
            </StackLayout>
          </StackLayout>
        ))}
        <FormField>
          <FormFieldLabel>Reviewer note</FormFieldLabel>
          <MultilineInput rows={2} textAreaProps={{ "data-demo-anchor": "kyc-note" }} />
          <FormFieldHelperText>Everyone reviewing this client can read the note.</FormFieldHelperText>
        </FormField>
      </StackLayout>
    </Panel>
  );
}
