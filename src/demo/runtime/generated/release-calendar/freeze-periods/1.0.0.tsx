import { useBus } from "@deweb/portal";
import { Banner, BannerContent, Display4, FlexLayout, GridLayout, H2, H3, Panel, StackLayout, StatusIndicator, Tag, Text } from "@salt-ds/core";
import { useState } from "react";
import { FREEZES, RELEASES, WEEKS, WINDOWS } from "../data";
import styles from "./1.0.0.module.css";

const WINDOW_STATUS = {
  open: { indicator: "success", label: "Open for releases" },
  restricted: { indicator: "warning", label: "Restricted by a partial freeze" },
  frozen: { indicator: "error", label: "Frozen" },
} as const;

const APPROVAL = {
  approved: { indicator: "success", label: "Approved" },
  pending: { indicator: "info", label: "Awaiting approval" },
  blocked: { indicator: "error", label: "Blocked by freeze" },
} as const;

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Display4 className={styles.figure}>{value}</Display4>
    </StackLayout>
  );
}

export default function FreezePeriods() {
  const [id, setId] = useState(WINDOWS[0]!.id);
  useBus("release:selected", "freeze-periods", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && WINDOWS.some((slot) => slot.id === next)) setId(next);
  });
  const slot = WINDOWS.find((entry) => entry.id === id)!;
  const week = WEEKS.find((entry) => entry.id === slot.week)!;
  const releases = RELEASES.filter((release) => release.window === slot.id);
  const freezes = FREEZES.filter((freeze) => slot.freezes.includes(freeze.id));
  const full = freezes.find((freeze) => freeze.kind === "full");
  const status = WINDOW_STATUS[full ? "frozen" : freezes.length ? "restricted" : "open"];

  return (
    <Panel data-demo-anchor="freeze-periods-panel">
      <StackLayout gap={2}>
        <StackLayout gap={1}>
          <H2>{slot.date}</H2>
          <Text color="secondary">{`${week.label}, ${slot.time}`}</Text>
          <FlexLayout gap={1} align="center">
            <StatusIndicator status={status.indicator} />
            <Text>{status.label}</Text>
          </FlexLayout>
        </StackLayout>
        {full ? (
          <Banner status="warning">
            <BannerContent>{`${full.name} covers this window. Only emergency changes approved by the change board can go ahead.`}</BannerContent>
          </Banner>
        ) : null}
        <GridLayout columns={3} gap={2}>
          <Figure label="Releases" value={releases.length} />
          <Figure label="Approved" value={releases.filter((release) => release.approval === "approved").length} />
          <Figure label="Blocked" value={releases.filter((release) => release.approval === "blocked").length} />
        </GridLayout>
        <StackLayout gap={1}>
          <H3 id="freeze-periods-releases">Releases</H3>
          {releases.length === 0 ? (
            <Text color="secondary">No releases are booked in this window.</Text>
          ) : (
            <StackLayout as="ul" gap={2} aria-labelledby="freeze-periods-releases" className={styles.list}>
              {releases.map((release) => (
                <StackLayout as="li" key={release.id} gap={1}>
                  <Text fontWeight="bolder">{release.name}</Text>
                  <Text styleAs="label" color="secondary">{`${release.team}, ${release.change}`}</Text>
                  <FlexLayout gap={1} align="center">
                    <StatusIndicator status={APPROVAL[release.approval].indicator} />
                    <Text>{APPROVAL[release.approval].label}</Text>
                  </FlexLayout>
                </StackLayout>
              ))}
            </StackLayout>
          )}
        </StackLayout>
        <StackLayout gap={1}>
          <H3 id="freeze-periods-freezes">Freezes affecting this window</H3>
          {freezes.length === 0 ? (
            <Text color="secondary">No freezes overlap this window, so every approved release can go ahead.</Text>
          ) : (
            <StackLayout as="ul" gap={2} aria-labelledby="freeze-periods-freezes" className={styles.list}>
              {freezes.map((freeze) => (
                <StackLayout as="li" key={freeze.id} gap={1}>
                  <FlexLayout gap={1} align="center" wrap>
                    <Text fontWeight="bolder">{freeze.name}</Text>
                    <Tag category={freeze.kind === "full" ? 5 : 3} variant="secondary">
                      {freeze.kind === "full" ? "Full freeze" : "Partial freeze"}
                    </Tag>
                  </FlexLayout>
                  <Text styleAs="label" color="secondary">{`${freeze.starts} to ${freeze.ends}`}</Text>
                  <Text color="secondary">{freeze.scope}</Text>
                </StackLayout>
              ))}
            </StackLayout>
          )}
        </StackLayout>
      </StackLayout>
    </Panel>
  );
}
