import { useBus } from "@deweb/portal";
import { Banner, BannerContent, Button, Display4, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridLayout, H2, H3, MultilineInput, Panel, StackLayout, StatusIndicator, Text } from "@salt-ds/core";
import { type FormEvent, useState } from "react";
import { COVENANTS, type CovenantResult, FACILITIES, type Facility } from "../data";
import styles from "./1.0.0.module.css";

const money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const RESULT: Record<CovenantResult, "success" | "warning" | "error"> = { Pass: "success", Watch: "warning", Breach: "error" };

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text className={styles.figure}>{value}</Text>
    </StackLayout>
  );
}

function ReferForm({ facility, referred, onRefer }: { facility: Facility; referred: string | undefined; onRefer: () => void }) {
  const [note, setNote] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (referred) return;
    if (note.trim() === "") {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onRefer();
  };

  return (
    <form onSubmit={submit} aria-labelledby="covenant-checks-refer">
      <StackLayout gap={2}>
        <H3 id="covenant-checks-refer">Refer to credit risk</H3>
        <FormField validationStatus={invalid ? "error" : undefined}>
          <FormFieldLabel>Note to credit risk</FormFieldLabel>
          <MultilineInput value={note} textAreaProps={{ onChange: (event) => setNote(event.target.value) }} rows={3} readOnly={referred !== undefined} />
          <FormFieldHelperText>{invalid ? `Say what ${facility.borrower} has told you about the result, then refer it.` : "Credit risk sees the covenant results with your note."}</FormFieldHelperText>
        </FormField>
        <FlexLayout gap={2} align="center" wrap>
          {referred === undefined && (
            <Button type="submit" sentiment="accented">
              Refer to credit risk
            </Button>
          )}
          <Text role="status" color="secondary">
            {referred ?? ""}
          </Text>
        </FlexLayout>
      </StackLayout>
    </form>
  );
}

export default function CovenantChecks() {
  const [id, setId] = useState(FACILITIES[0]!.id);
  const [referrals, setReferrals] = useState<Record<string, string>>({});
  useBus("facility:selected", "covenant-checks", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && FACILITIES.some((facility) => facility.id === next)) setId(next);
  });
  const facility = FACILITIES.find((entry) => entry.id === id)!;
  const covenants = COVENANTS[facility.id] ?? [];
  const breaches = covenants.filter((covenant) => covenant.result === "Breach");
  const flagged = covenants.some((covenant) => covenant.result !== "Pass");
  const drawn = Math.round((facility.drawn / facility.limit) * 100);

  const refer = () => setReferrals((current) => ({ ...current, [facility.id]: `Referred at 14:32 ET as case CR-${5210 + Object.keys(current).length + 1}. Credit risk replies within one business day.` }));

  return (
    <Panel data-demo-anchor="covenant-checks-panel">
      <StackLayout gap={3}>
        <StackLayout gap={1}>
          <H2>{facility.borrower}</H2>
          <Text color="secondary">{`${facility.type} · FAC-${facility.id}`}</Text>
        </StackLayout>
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            Available to draw
          </Text>
          <Display4 className={styles.figure}>{money(facility.currency, facility.limit - facility.drawn)}</Display4>
          <Text color="secondary">{`${drawn}% of a ${money(facility.currency, facility.limit)} limit drawn`}</Text>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <Figure label="Maturity" value={facility.maturity} />
          <Figure label="Next covenant test" value={facility.nextTest} />
        </GridLayout>
        {breaches.length > 0 && (
          <Banner status="error">
            <BannerContent>
              <Text>{`${breaches.map((covenant) => covenant.name).join(", ")} breached at the ${breaches[0]!.tested} test. Refer it to credit risk before the borrower draws again.`}</Text>
            </BannerContent>
          </Banner>
        )}
        <StackLayout gap={2} as="section" aria-labelledby="covenant-checks-list">
          <H3 id="covenant-checks-list">Covenants</H3>
          {covenants.length === 0 ? (
            <Text color="secondary">This facility has no financial covenants to test.</Text>
          ) : (
            <StackLayout as="ol" gap={2} className={styles.list}>
              {covenants.map((covenant) => (
                <StackLayout as="li" key={covenant.id} gap={1}>
                  <FlexLayout justify="space-between" align="center" gap={1} wrap>
                    <Text fontWeight="bolder">{covenant.name}</Text>
                    <FlexLayout gap={1} align="center" wrap={false}>
                      <StatusIndicator status={RESULT[covenant.result]} />
                      <Text>{covenant.result}</Text>
                    </FlexLayout>
                  </FlexLayout>
                  <Text className={styles.figure}>{`${covenant.actual}, required ${covenant.threshold.charAt(0).toLowerCase()}${covenant.threshold.slice(1)}`}</Text>
                  <Text styleAs="label" color="secondary">{`Tested ${covenant.tested}`}</Text>
                </StackLayout>
              ))}
            </StackLayout>
          )}
        </StackLayout>
        {flagged ? (
          <ReferForm key={facility.id} facility={facility} referred={referrals[facility.id]} onRefer={refer} />
        ) : (
          <Text color="secondary">Every covenant passed its latest test, so there's nothing to refer to credit risk.</Text>
        )}
      </StackLayout>
    </Panel>
  );
}
