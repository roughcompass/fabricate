// Credit facility tracker: the Facilities route as one page, composed from its microfrontends at their conformant versions:
// facility-list 1.1.0 (main)
// covenant-checks 1.0.0 (side)
import { useBus, usePublish } from "@deweb/portal";
import { Banner, BannerContent, Button, Display3, Display4, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, LinearProgress, MultilineInput, Panel, StackLayout, StatusIndicator, Table, TableContainer, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { AS_OF, type CovenantResult, COVENANTS, FACILITIES, type Facility } from "./data";
import styles from "./page.module.css";

const FacilityList_money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FacilityList_utilization = (facility: Facility) => `${((facility.drawn / facility.limit) * 100).toFixed(1)}%`;

const FacilityList_millions = (currency: string, value: number) => `${currency} ${(value / 1000000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}m`;

const FacilityList_COMMITTED = FACILITIES.reduce((total, facility) => total + facility.limit, 0);

const FacilityList_DRAWN = FACILITIES.reduce((total, facility) => total + facility.drawn, 0);

const FacilityList_PORTFOLIO = Math.round((FacilityList_DRAWN / FacilityList_COMMITTED) * 100);

const FacilityList_NEAR_LIMIT = FACILITIES.filter((facility) => facility.drawn / facility.limit >= 0.9).length;

function FacilityList_Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Display3 className={styles["FacilityList_figure"]}>{value}</Display3>
    </StackLayout>
  );
}

function FacilityList() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(FACILITIES[0]!.id);
  const publish = usePublish("facility-list");
  const search = query.trim().toLowerCase();
  const rows = FACILITIES.filter((facility) => facility.borrower.toLowerCase().includes(search) || facility.type.toLowerCase().includes(search));

  const choose = (facility: Facility) => {
    setSelected(facility.id);
    publish("facility:selected", { id: facility.id, name: facility.borrower });
  };

  return (
    <Panel data-demo-anchor="facility-list-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Credit facilities</H2>
          <Text styleAs="label" color="secondary">{`Balances as of ${AS_OF}`}</Text>
        </FlexLayout>
        <StackLayout gap={2} as="section" aria-labelledby="facility-list-portfolio">
          <H3 id="facility-list-portfolio">{`Portfolio, ${FACILITIES.length} facilities`}</H3>
          <GridLayout columns={{ xs: 1, sm: 3 }} gap={2}>
            <FacilityList_Figure label="Committed" value={FacilityList_millions("USD", FacilityList_COMMITTED)} />
            <FacilityList_Figure label="Drawn" value={FacilityList_millions("USD", FacilityList_DRAWN)} />
            <FacilityList_Figure label="Available" value={FacilityList_millions("USD", FacilityList_COMMITTED - FacilityList_DRAWN)} />
          </GridLayout>
          <StackLayout gap={1}>
            <Text styleAs="label" color="secondary">
              Portfolio utilization
            </Text>
            <LinearProgress className={styles["FacilityList_meter"]} value={FacilityList_PORTFOLIO} aria-label={`Portfolio utilization, ${FacilityList_PORTFOLIO}% drawn`} />
          </StackLayout>
          <FlexLayout gap={1} align="center">
            <StatusIndicator status={FacilityList_NEAR_LIMIT > 0 ? "warning" : "success"} />
            <Text>{FacilityList_NEAR_LIMIT > 0 ? `${FacilityList_NEAR_LIMIT} ${FacilityList_NEAR_LIMIT === 1 ? "facility is" : "facilities are"} 90% or more drawn` : "No facility is 90% or more drawn"}</Text>
          </FlexLayout>
        </StackLayout>
        <FormField>
          <FormFieldLabel>Find a facility</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Borrower or facility type"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "facility-search" }}
          />
        </FormField>
        {rows.length === 0 ? (
          <Text color="secondary">{`No facilities match "${query.trim()}". Clear the search to see every facility.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Credit facilities">
              <THead sticky>
                <TR>
                  <TH>Borrower</TH>
                  <TH textAlign="right">Limit</TH>
                  <TH textAlign="right">Drawn</TH>
                  <TH textAlign="right">Utilization</TH>
                  <TH>Maturity</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((facility) => {
                  const current = facility.id === selected;
                  return (
                    <TR key={facility.id} aria-current={current ? "true" : undefined} className={current ? styles["FacilityList_selected"] : undefined} data-demo-anchor={`facility-${facility.id}`}>
                      <TD>
                        <StackLayout gap={1} align="start">
                          <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(facility)}>
                            {facility.borrower}
                          </Button>
                          <Text styleAs="label" color="secondary">
                            {facility.type}
                          </Text>
                        </StackLayout>
                      </TD>
                      <TD textAlign="right" className={styles["FacilityList_figure"]}>
                        {FacilityList_money(facility.currency, facility.limit)}
                      </TD>
                      <TD textAlign="right" className={styles["FacilityList_figure"]}>
                        {FacilityList_money(facility.currency, facility.drawn)}
                      </TD>
                      <TD textAlign="right" className={styles["FacilityList_figure"]}>
                        {FacilityList_utilization(facility)}
                      </TD>
                      <TD>{facility.maturity}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </StackLayout>
    </Panel>
  );
}

const CovenantChecks_money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CovenantChecks_RESULT: Record<CovenantResult, "success" | "warning" | "error"> = { Pass: "success", Watch: "warning", Breach: "error" };

function CovenantChecks_Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text className={styles["CovenantChecks_figure"]}>{value}</Text>
    </StackLayout>
  );
}

function CovenantChecks_ReferForm({ facility, referred, onRefer }: { facility: Facility; referred: string | undefined; onRefer: () => void }) {
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

function CovenantChecks() {
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
          <Display4 className={styles["CovenantChecks_figure"]}>{CovenantChecks_money(facility.currency, facility.limit - facility.drawn)}</Display4>
          <Text color="secondary">{`${drawn}% of a ${CovenantChecks_money(facility.currency, facility.limit)} limit drawn`}</Text>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <CovenantChecks_Figure label="Maturity" value={facility.maturity} />
          <CovenantChecks_Figure label="Next covenant test" value={facility.nextTest} />
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
            <StackLayout as="ol" gap={2} className={styles["CovenantChecks_list"]}>
              {covenants.map((covenant) => (
                <StackLayout as="li" key={covenant.id} gap={1}>
                  <FlexLayout justify="space-between" align="center" gap={1} wrap>
                    <Text fontWeight="bolder">{covenant.name}</Text>
                    <FlexLayout gap={1} align="center" wrap={false}>
                      <StatusIndicator status={CovenantChecks_RESULT[covenant.result]} />
                      <Text>{covenant.result}</Text>
                    </FlexLayout>
                  </FlexLayout>
                  <Text className={styles["CovenantChecks_figure"]}>{`${covenant.actual}, required ${covenant.threshold.charAt(0).toLowerCase()}${covenant.threshold.slice(1)}`}</Text>
                  <Text styleAs="label" color="secondary">{`Tested ${covenant.tested}`}</Text>
                </StackLayout>
              ))}
            </StackLayout>
          )}
        </StackLayout>
        {flagged ? (
          <CovenantChecks_ReferForm key={facility.id} facility={facility} referred={referrals[facility.id]} onRefer={refer} />
        ) : (
          <Text color="secondary">Every covenant passed its latest test, so there's nothing to refer to credit risk.</Text>
        )}
      </StackLayout>
    </Panel>
  );
}

export default function CreditFacilityTracker() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <FacilityList />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <CovenantChecks />
      </GridItem>
    </GridLayout>
  );
}
