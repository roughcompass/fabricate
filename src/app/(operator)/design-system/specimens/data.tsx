import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Menu, MenuAction, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { Status } from "@/components/ui/status";
import { EmptyRow, Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { BarChart } from "@/components/ui/bar-chart";
import { Diagram } from "@/components/relationships/diagram";
import { type DiagramEdge, diagramModel } from "@/lib/relationships/diagram";
import type { DiagramData } from "@/lib/relationships/levels";
import { noopDemo } from "../actions";
import { Specimen } from "../specimen";

/** A runtime system's diagram for the Diagram specimen: a host above the repositories it loads, and the library they share. */
function sampleDiagram(): DiagramData {
  const box = (nodeId: string, row: number, marks: string[] = []) => ({ nodeId, label: nodeId, detail: null, marks, href: "#diagram", row });
  const edge = (edgeId: string, from: string, to: string, type: string, rule: string): DiagramEdge => ({ edgeId, from, to, type, state: "resolved", rule, basis: "observed", evidence: [], kind: "architecture", referenceIdentifier: {}, candidates: [] });
  const rows = [
    [box("access-shell", 0, ["Host"])],
    [box("fx-board", 1), box("payee-hub", 1), box("rates", 1)],
    [box("design-tokens", 2)],
  ];
  const groups = new Map(rows.flat().map((item) => [item.nodeId, `repo:${item.nodeId}`]));
  const edges = [
    edge("e1", "access-shell", "fx-board", "composition", "composition.federation-name"),
    edge("e2", "access-shell", "fx-board", "composition", "composition.import-map-specifier"),
    edge("e3", "access-shell", "payee-hub", "composition", "composition.federation-name"),
    edge("e4", "access-shell", "rates", "composition", "composition.federation-name"),
    edge("e5", "fx-board", "design-tokens", "package_dependency", "package.exact-name"),
    edge("e6", "rates", "design-tokens", "package_dependency", "package.exact-name"),
    { ...edge("e7", "payee-hub", "", "iframe", "iframe.served-origin"), to: null, state: "unresolved", referenceIdentifier: { url: "https://legacy.invalid" } },
  ];
  return { rows, model: diagramModel(groups, edges, (id) => id), thirdParty: [{ name: "react", href: "#diagram" }] };
}

/** Tables. */
export function TableSpecimens() {
  return (
    <>
      <Specimen
        id="table"
        title="Table"
        description="A quiet header, a linked primary cell, row actions in a menu that keeps rows one height, and stacked rows on narrow screens."
        render={(theme) => (
          <>
            <Panel flush>
              <Table
                label={`Repositories, ${theme}`}
                head={
                  <>
                    <Th>Name</Th>
                    <Th>Status</Th>
                    <Th align="numeric">Runs</Th>
                    <Th align="actions" hidden>
                      Actions
                    </Th>
                  </>
                }
              >
                <tr data-row-sample={theme === "light" ? "actions" : undefined}>
                  <Td label="Name">
                    <Primary>
                      <a href="#table">orders</a>
                    </Primary>
                    <Secondary mono>https://git.example.com/acme/orders.git</Secondary>
                  </Td>
                  <Td label="Status">
                    <Status state="complete" label="Profiled" />
                  </Td>
                  <Td label="Runs" align="numeric">
                    3
                  </Td>
                  <Td align="actions">
                    <RowActions>
                      <Menu label="Actions for orders">
                        <MenuItem href="#table" icon="edit">
                          Edit
                        </MenuItem>
                        <MenuAction action={noopDemo}>Re-profile</MenuAction>
                      </Menu>
                    </RowActions>
                  </Td>
                </tr>
                <tr data-row-sample={theme === "light" ? "plain" : undefined}>
                  <Td label="Name">
                    <Primary>
                      <a href="#table">billing</a>
                    </Primary>
                    <Secondary mono>https://git.example.com/acme/billing.git</Secondary>
                  </Td>
                  <Td label="Status">
                    <Status state="queued" />
                  </Td>
                  <Td label="Runs" align="numeric">
                    0
                  </Td>
                  <Td align="actions" />
                </tr>
              </Table>
            </Panel>
            <Panel flush>
              <Table label={`Empty table, ${theme}`} head={<Th>Name</Th>}>
                <EmptyRow columns={1}>
                  <EmptyState title="No disabled Repositories">Every Repository is enabled.</EmptyState>
                </EmptyRow>
              </Table>
            </Panel>
            <Panel flush>
              <Table
                label={`Wide table, ${theme}`}
                scroll
                head={
                  <>
                    <Th>Release</Th>
                    {["Gap", "Indeterminate", "Meets", "Not applicable", "Total findings"].map((column) => (
                      <Th key={column} align="numeric">
                        {column}
                      </Th>
                    ))}
                    <Th align="actions" hidden>
                      Actions
                    </Th>
                  </>
                }
              >
                <tr>
                  <Td label="Release">
                    <Primary>Engineering baseline v1 with a deliberately long name</Primary>
                  </Td>
                  {([["Gap", 13], ["Indeterminate", 7], ["Meets", 5], ["Not applicable", 5], ["Total findings", 30]] as const).map(([column, count]) => (
                    <Td key={column} label={column} align="numeric">
                      {count}
                    </Td>
                  ))}
                  <Td align="actions">
                    <RowActions>
                      <Menu label={`Actions in a scrolling table, ${theme}`}>
                        <MenuItem href="#table">Open Release</MenuItem>
                        <MenuSeparator />
                        <MenuAction action={noopDemo} tone="danger" icon="trash">
                          Remove
                        </MenuAction>
                      </Menu>
                    </RowActions>
                  </Td>
                </tr>
              </Table>
            </Panel>
          </>
        )}
      />
    </>
  );
}

/** Bar charts, tabs and breadcrumbs, pagination, and the diagram. */
export function ChartSpecimens() {
  return (
    <>
      <Specimen
        id="bar-chart"
        title="Bar chart"
        description="A stacked bar per group, each series with its own tone and pattern, a legend, and a hidden table with the same figures."
        render={(theme) => (
          <BarChart
            id={`${theme}-trend`}
            label="Evaluations completed each week, by conclusion"
            groupLabel="Week"
            series={[
              { id: "gaps", label: "Gaps found", tone: "error", pattern: "stripes" },
              { id: "undetermined", label: "Undetermined", tone: "warning", pattern: "dots" },
              { id: "conforms", label: "Conforms", tone: "success", pattern: "solid" },
            ]}
            groups={[
              { label: "Sep 28", values: { gaps: 1, conforms: 2 } },
              { label: "Oct 5", values: { gaps: 2, undetermined: 1, conforms: 1 } },
              { label: "Oct 12", values: {} },
              { label: "Oct 19", values: { gaps: 2, conforms: 1 } },
            ]}
          />
        )}
      />

      <Specimen
        id="tabs"
        title="Tabs and breadcrumbs"
        description="Tabs switch views of one page and show counts; a toggle group picks one of a few choices, with labels or as icons with tooltips; breadcrumbs link a record's ancestors."
        render={() => (
          <>
            <Tabs label="Filter Assessments">
              <TabLink href="#tabs" active count={7}>
                All
              </TabLink>
              <TabLink href="#tabs" active={false} count={6}>
                Gaps found
              </TabLink>
              <TabLink href="#tabs" active={false} count={1}>
                Conforms
              </TabLink>
            </Tabs>
            <ToggleGroup
              action="/design-system"
              label="Device"
              name="device"
              selected="tablet"
              options={[
                { value: "mobile", label: "Mobile", icon: "smartphone" },
                { value: "tablet", label: "Tablet", icon: "tablet" },
                { value: "desktop", label: "Desktop", icon: "monitor" },
              ]}
            />
            <ToggleGroup
              action="/design-system"
              label="Device, as icons"
              name="device"
              selected="desktop"
              iconOnly
              options={[
                { value: "mobile", label: "Mobile", icon: "smartphone" },
                { value: "tablet", label: "Tablet", icon: "tablet" },
                { value: "desktop", label: "Desktop", icon: "monitor" },
              ]}
            />
            <Breadcrumbs
              items={[
                { href: "#tabs", label: "Assessments" },
                { href: "#tabs", label: "Checkout platform migration" },
                { href: "#tabs", label: "Run #1" },
              ]}
            />
          </>
        )}
      />

      <Specimen
        id="pagination"
        title="Pagination"
        description="Links between the pages of a long list, with the page in the address."
        render={() => <Pagination label="Relationships pages" page={4} pages={12} href={(page) => `?page=${page}#pagination`} />}
      />

      <Specimen
        id="diagram"
        title="Diagram"
        description="A Relationship Map diagram: boxes link to their focus, one arrow merges every signal between two repositories, a dashed stub marks an unmatched reference, and the text equivalent replaces the drawing on narrow screens."
        render={(theme) => <Diagram id={`diagram-${theme}`} label="access-shell runtime system" data={sampleDiagram()} />}
      />
    </>
  );
}
