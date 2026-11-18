import { usePublish } from "@deweb/portal";
import { Badge, Button, Dropdown, FlexLayout, FormField, FormFieldLabel, GridLayout, H2, Input, Option, Panel, StackLayout, TBody, TD, TH, THead, TR, Tab, TabBar, TabList, TabPanel, TabTrigger, Table, TableContainer, Tabs, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, type SyntheticEvent, useState } from "react";
import { REGIONS, REPORTS, type Report, SECTORS } from "../data";
import styles from "./1.1.0.module.css";

const ALL_REGIONS = "All regions";
const ALL_SECTORS = "All sectors";

export default function ResearchLibrary() {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState(ALL_REGIONS);
  const [sector, setSector] = useState(ALL_SECTORS);
  const [selected, setSelected] = useState(REPORTS[0]!.id);
  const publish = usePublish("research-library");
  const search = query.trim().toLowerCase();
  const matching = REPORTS.filter(
    (report) => (region === ALL_REGIONS || report.region === region) && [report.title, report.analyst, report.sector].some((field) => field.toLowerCase().includes(search)),
  );
  const rows = matching.filter((report) => sector === ALL_SECTORS || report.sector === sector);
  const count = (tab: string) => (tab === ALL_SECTORS ? matching.length : matching.filter((report) => report.sector === tab).length);

  const choose = (report: Report) => {
    setSelected(report.id);
    publish("report:selected", { id: report.id, name: report.title });
  };

  const scope = [sector === ALL_SECTORS ? "" : ` in ${sector}`, region === ALL_REGIONS ? "" : ` for ${region}`].join("");
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
            <Dropdown selected={[region]} onSelectionChange={(_event, next: string[]) => setRegion(next[0] ?? ALL_REGIONS)}>
              {[ALL_REGIONS, ...REGIONS].map((option) => (
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
              {[ALL_SECTORS, ...SECTORS].map((tab) => (
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
                <Table aria-label={`${sector === ALL_SECTORS ? "Published" : sector} reports`}>
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
                        <TR key={report.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`report-${report.id}`}>
                          <TD>
                            <Button sentiment="neutral" appearance="transparent" className={styles.recordName} aria-pressed={current} onClick={() => choose(report)}>
                              {report.title}
                            </Button>
                          </TD>
                          <TD>{report.sector}</TD>
                          <TD>{report.analyst}</TD>
                          <TD>{report.region}</TD>
                          <TD className={styles.figure}>{report.published}</TD>
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
