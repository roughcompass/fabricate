// Research hub: the Research route as one page, composed from its microfrontends at their conformant versions:
// research-library 1.1.0 (main)
// research-reader 1.0.0 (side)
import { useBus, usePublish } from "@deweb/portal";
import { Badge, Button, Divider, Dropdown, FlexLayout, FormField, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, Option, Panel, StackLayout, Tab, TabBar, Table, TableContainer, TabList, TabPanel, Tabs, TabTrigger, Tag, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { BookmarkIcon, BookmarkSolidIcon, ChevronRightIcon, SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, type SyntheticEvent, useState } from "react";
import { REGIONS, type Report, REPORTS, SECTORS } from "./data";
import styles from "./page.module.css";

const ResearchLibrary_ALL_REGIONS = "All regions";

const ResearchLibrary_ALL_SECTORS = "All sectors";

function ResearchLibrary() {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState(ResearchLibrary_ALL_REGIONS);
  const [sector, setSector] = useState(ResearchLibrary_ALL_SECTORS);
  const [selected, setSelected] = useState(REPORTS[0]!.id);
  const publish = usePublish("research-library");
  const search = query.trim().toLowerCase();
  const matching = REPORTS.filter(
    (report) => (region === ResearchLibrary_ALL_REGIONS || report.region === region) && [report.title, report.analyst, report.sector].some((field) => field.toLowerCase().includes(search)),
  );
  const rows = matching.filter((report) => sector === ResearchLibrary_ALL_SECTORS || report.sector === sector);
  const count = (tab: string) => (tab === ResearchLibrary_ALL_SECTORS ? matching.length : matching.filter((report) => report.sector === tab).length);

  const choose = (report: Report) => {
    setSelected(report.id);
    publish("report:selected", { id: report.id, name: report.title });
  };

  const scope = [sector === ResearchLibrary_ALL_SECTORS ? "" : ` in ${sector}`, region === ResearchLibrary_ALL_REGIONS ? "" : ` for ${region}`].join("");
  const empty = search
    ? `No reports match "${query.trim()}"${scope}. Clear the search or choose All sectors to see more reports.`
    : `No reports are published${scope}. Choose All sectors or All regions to see more reports.`;

  return (
    <Panel data-demo-anchor="research-library-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Research library</H2>
          <Text styleAs="label" color="secondary">{`${REPORTS.length} reports, latest ${REPORTS[0]!.published}`}</Text>
        </FlexLayout>
        <GridLayout columns={{ xs: 1, sm: 2 }} gap={2}>
          <FormField>
            <FormFieldLabel>Find a report</FormFieldLabel>
            <Input
              startAdornment={<SearchIcon aria-hidden />}
              placeholder="Title, analyst, or sector"
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
              inputProps={{ type: "search", "data-demo-anchor": "research-search" }}
            />
          </FormField>
          <FormField>
            <FormFieldLabel>Region</FormFieldLabel>
            <Dropdown selected={[region]} onSelectionChange={(_event, next: string[]) => setRegion(next[0] ?? ResearchLibrary_ALL_REGIONS)}>
              {[ResearchLibrary_ALL_REGIONS, ...REGIONS].map((option) => (
                <Option key={option} value={option}>
                  {option}
                </Option>
              ))}
            </Dropdown>
          </FormField>
        </GridLayout>
        <Tabs value={sector} onChange={(_event: SyntheticEvent | null, next: string) => setSector(next)}>
          <TabBar divider>
            <TabList aria-label="Sectors" appearance="transparent">
              {[ResearchLibrary_ALL_SECTORS, ...SECTORS].map((tab) => (
                <Tab key={tab} value={tab}>
                  <TabTrigger>
                    {tab}
                    <Badge value={count(tab)} />
                  </TabTrigger>
                </Tab>
              ))}
            </TabList>
          </TabBar>
          <TabPanel value={sector}>
            {rows.length === 0 ? (
              <Text color="secondary">{empty}</Text>
            ) : (
              <TableContainer>
                <Table aria-label={`${sector === ResearchLibrary_ALL_SECTORS ? "Published" : sector} reports`}>
                  <THead sticky>
                    <TR>
                      <TH>Report</TH>
                      <TH>Sector</TH>
                      <TH>Analyst</TH>
                      <TH>Region</TH>
                      <TH>Published</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((report) => {
                      const current = report.id === selected;
                      return (
                        <TR key={report.id} aria-current={current ? "true" : undefined} className={current ? styles["ResearchLibrary_selected"] : undefined} data-demo-anchor={`report-${report.id}`}>
                          <TD>
                            <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(report)}>
                              {report.title}
                            </Button>
                          </TD>
                          <TD>{report.sector}</TD>
                          <TD>{report.analyst}</TD>
                          <TD>{report.region}</TD>
                          <TD className={styles["ResearchLibrary_figure"]}>{report.published}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableContainer>
            )}
          </TabPanel>
        </Tabs>
      </StackLayout>
    </Panel>
  );
}

function ResearchReader_Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text className={styles["ResearchReader_figure"]}>{value}</Text>
    </StackLayout>
  );
}

function ResearchReader() {
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
          <ResearchReader_Figure label="Pages" value={`${report.pages}`} />
          <ResearchReader_Figure label="Companies covered" value={`${report.companies}`} />
        </GridLayout>
        <Divider />
        <StackLayout gap={1}>
          <H3>Summary</H3>
          <Text>{report.summary}</Text>
        </StackLayout>
        <StackLayout gap={1}>
          <H3 id="research-key-points">Key points</H3>
          <StackLayout as="ul" gap={1} aria-labelledby="research-key-points" className={styles["ResearchReader_list"]}>
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

export default function ResearchHub() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <ResearchLibrary />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <ResearchReader />
      </GridItem>
    </GridLayout>
  );
}
