import { useProfile } from "@deweb/portal";
import { Button, Display3, FlexLayout, GridLayout, H2, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { RefreshIcon } from "@salt-ds/icons";
import { useState } from "react";
import { EXPOSURE, TRADES } from "../data";
import styles from "./3.5.0.module.css";

const AWAITING = "Awaiting allocation";
const shares = (quantity: number) => quantity.toLocaleString("en-US");
const usd = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const millions = (value: number) => `USD ${(value / 1_000_000).toFixed(2)}M`;

function Figure({ label, value, detail, live }: { label: string; value: string; detail: string; live?: boolean }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Display3 className={styles.figure}>{value}</Display3>
      <Text styleAs="label" color="secondary" role={live ? "status" : undefined}>
        {detail}
      </Text>
    </StackLayout>
  );
}

export default function TradeBlotter() {
  const approver = useProfile().persona === "Approver";
  const [allocated, setAllocated] = useState<readonly string[]>([]);
  const [recalculated, setRecalculated] = useState(false);
  const statusOf = (trade: (typeof TRADES)[number]) => (allocated.includes(trade.id) ? "Allocated" : trade.status);
  const awaiting = TRADES.filter((trade) => statusOf(trade) === AWAITING).length;

  return (
    <Panel data-demo-anchor="blotter-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={2} wrap>
          <H2>Trade blotter</H2>
          <Button sentiment="neutral" appearance="bordered" onClick={() => setRecalculated(true)} data-demo-anchor="recalculate-exposure">
            <RefreshIcon aria-hidden />
            Recalculate exposure
          </Button>
        </FlexLayout>

        <GridLayout columns={{ xs: 1, sm: 3 }} gap={2}>
          <Figure label="Awaiting allocation" value={`${awaiting}`} detail="Approver allocates" />
          <Figure label="Gross exposure" value={millions(recalculated ? EXPOSURE.recalculated : EXPOSURE.calculated)} detail={recalculated ? `Recalculated at ${EXPOSURE.recalculatedAt}` : `Calculated at ${EXPOSURE.at}`} live />
          <Figure label="Trades today" value={`${TRADES.length}`} detail="Since the 09:30 ET open" />
        </GridLayout>

        <TableContainer>
          <Table aria-label="Trades">
            <THead sticky>
              <TR>
                <TH>Trade</TH>
                <TH>Time</TH>
                <TH>Symbol</TH>
                <TH>Side</TH>
                <TH textAlign="right">Quantity</TH>
                <TH textAlign="right">Price (USD)</TH>
                <TH textAlign="right">Notional (USD)</TH>
                <TH>Status</TH>
                {approver && <TH>Allocation</TH>}
              </TR>
            </THead>
            <TBody>
              {TRADES.map((trade) => {
                const status = statusOf(trade);
                const waiting = status === AWAITING;
                return (
                  <TR key={trade.id} data-demo-anchor={`trade-${trade.id}`}>
                    <TD>
                      <Text fontWeight="bolder">{trade.id}</Text>
                    </TD>
                    <TD>
                      <Text styleAs="label" color="secondary">
                        {trade.time}
                      </Text>
                    </TD>
                    <TD>{trade.symbol}</TD>
                    <TD>{trade.side}</TD>
                    <TD textAlign="right" className={styles.figure}>
                      {shares(trade.quantity)}
                    </TD>
                    <TD textAlign="right" className={styles.figure}>
                      {usd(trade.price)}
                    </TD>
                    <TD textAlign="right" className={styles.figure}>
                      {usd(trade.quantity * trade.price)}
                    </TD>
                    <TD>
                      <FlexLayout gap={1} align="center" wrap={false}>
                        <StatusIndicator status={waiting ? "warning" : "success"} />
                        <Text>{status}</Text>
                      </FlexLayout>
                    </TD>
                    {approver && (
                      <TD>
                        {waiting ? (
                          <Button sentiment="accented" appearance="transparent" onClick={() => setAllocated((ids) => [...ids, trade.id])} data-demo-anchor={`approve-${trade.id}`}>
                            {`Approve ${trade.id}`}
                          </Button>
                        ) : (
                          <Text color="secondary">None needed</Text>
                        )}
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>

        {!approver && <Text color="secondary">Allocations are approved by the Approver role.</Text>}
      </StackLayout>
    </Panel>
  );
}
