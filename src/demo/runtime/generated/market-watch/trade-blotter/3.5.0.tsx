import { useState } from "react";
import {
  Button,
  Card,
  FlexLayout,
  H2,
  StackLayout,
  StatusIndicator,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Text,
} from "@salt-ds/core";
import { RefreshIcon } from "@salt-ds/icons";
import { planted, useProfile } from "@deweb/portal";
import { TRADES } from "../data";

function Metric({
  label,
  value,
  detail,
  emphasis,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasis?: boolean;
}) {
  return (
    <StackLayout gap={0.5}>
      <Text color="secondary">{label}</Text>
      <Text styleAs={emphasis ? "display3" : "h2"} aria-live="polite">
        {value}
      </Text>
      {detail && (
        <Text styleAs="label" color="secondary">
          {detail}
        </Text>
      )}
    </StackLayout>
  );
}

export default function TradeBlotter() {
  const approver = useProfile().persona === "Approver";
  const [allocated, setAllocated] = useState<readonly string[]>([]);
  const [exposure, setExposure] = useState("$1.42M");

  return (
    <Card data-demo-anchor="blotter-panel">
      <StackLayout gap={3}>
        <FlexLayout justify="space-between" align="center" wrap gap={2}>
          <H2>Trade blotter</H2>
          <Button
            sentiment="neutral"
            appearance="bordered"
            onClick={() => {
              planted.blockMainThread(650);
              setExposure("$1.43M");
            }}
            data-demo-anchor="recalculate-exposure"
          >
            <RefreshIcon aria-hidden />
            Recalculate exposure
          </Button>
        </FlexLayout>

        <FlexLayout gap={3} wrap align="end">
          <Metric
            label="Awaiting allocation"
            value={`${2 - allocated.length}`}
            detail="Approver allocates"
            emphasis
          />
          <Metric label="Gross exposure" value={exposure} />
          <Metric label="Trades today" value="4" />
        </FlexLayout>

        <TableContainer>
          <Table aria-label="Trades">
            <THead>
              <TR>
                <TH>Trade</TH>
                <TH>Symbol</TH>
                <TH>Side</TH>
                <TH style={{ textAlign: "right" }}>Quantity</TH>
                <TH style={{ textAlign: "right" }}>Price</TH>
                <TH>Status</TH>
                {approver && <TH>Allocation</TH>}
              </TR>
            </THead>
            <TBody>
              {TRADES.map((trade) => {
                const status: string = allocated.includes(trade.id) ? "Allocated" : trade.status;
                const awaiting = status === "Awaiting allocation";
                return (
                  <TR key={trade.id} data-demo-anchor={`trade-${trade.id}`}>
                    <TD>{trade.id}</TD>
                    <TD>{trade.symbol}</TD>
                    <TD>{trade.side}</TD>
                    <TD style={{ textAlign: "right" }}>{trade.quantity}</TD>
                    <TD style={{ textAlign: "right" }}>{trade.price}</TD>
                    <TD>
                      <FlexLayout gap={1} align="center">
                        <StatusIndicator status={awaiting ? "info" : "success"} />
                        <Text>{status}</Text>
                      </FlexLayout>
                    </TD>
                    {approver && (
                      <TD>
                        {awaiting ? (
                          <Button
                            sentiment="accented"
                            onClick={() => setAllocated((ids) => [...ids, trade.id])}
                            data-demo-anchor={`approve-${trade.id}`}
                          >
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
    </Card>
  );
}
