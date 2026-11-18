import { useBus } from "@deweb/portal";
import { Button, Divider, FlexLayout, GridLayout, H2, H3, Panel, StackLayout, Tag, Text } from "@salt-ds/core";
import { BookmarkIcon, BookmarkSolidIcon, ChevronRightIcon } from "@salt-ds/icons";
import { useState } from "react";
import { REPORTS } from "../data";
import styles from "./1.0.0.module.css";

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

export default function ResearchReader() {
  const [id, setId] = useState(REPORTS[0]!.id);
  const [saved, setSaved] = useState<readonly string[]>([]);
  useBus("report:selected", "research-reader", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && REPORTS.some((report) => report.id === next)) setId(next);
  });
  const report = REPORTS.find((entry) => entry.id === id)!;
  const isSaved = saved.includes(report.id);

  return (
    <Panel data-demo-anchor="research-reader-panel">
      <StackLayout gap={2}>
        <StackLayout gap={1}>
          <H2>{report.title}</H2>
          <Text color="secondary">{`${report.analyst}, ${report.region}`}</Text>
          <Text styleAs="label" color="secondary">{`Published ${report.published}, ${report.time}`}</Text>
        </StackLayout>
        <FlexLayout gap={1} wrap>
          <Tag category={1}>{report.sector}</Tag>
          <Tag category={2} variant="secondary">
            {report.rating}
          </Tag>
        </FlexLayout>
        <GridLayout columns={2} gap={2}>
          <Figure label="Pages" value={`${report.pages}`} />
          <Figure label="Companies covered" value={`${report.companies}`} />
        </GridLayout>
        <Divider />
        <StackLayout gap={1}>
          <H3>Summary</H3>
          <Text>{report.summary}</Text>
        </StackLayout>
        <StackLayout gap={1}>
          <H3 id="research-key-points">Key points</H3>
          <StackLayout as="ul" gap={1} aria-labelledby="research-key-points" className={styles.list}>
            {report.keyPoints.map((point) => (
              <FlexLayout as="li" key={point} gap={1} align="start">
                <ChevronRightIcon aria-hidden />
                <Text>{point}</Text>
              </FlexLayout>
            ))}
          </StackLayout>
        </StackLayout>
        <StackLayout gap={1} align="start">
          <Button sentiment={isSaved ? "neutral" : "accented"} appearance={isSaved ? "bordered" : "solid"} onClick={() => setSaved(isSaved ? saved.filter((entry) => entry !== report.id) : [...saved, report.id])}>
            {isSaved ? <BookmarkSolidIcon aria-hidden /> : <BookmarkIcon aria-hidden />}
            {isSaved ? "Remove from reading list" : "Save to reading list"}
          </Button>
          <Text role="status" color="secondary">
            {isSaved ? `Saved. ${saved.length} ${saved.length === 1 ? "report" : "reports"} in your reading list.` : ""}
          </Text>
        </StackLayout>
      </StackLayout>
    </Panel>
  );
}
