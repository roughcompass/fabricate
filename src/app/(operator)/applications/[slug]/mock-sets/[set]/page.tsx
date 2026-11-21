import type { Metadata } from "next";
import Link from "next/link";
import { DetailsTemplate } from "@/components/templates/details-template";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { formatBytes, formatNumber } from "@/components/ui/count";
import { FilterBar } from "@/components/ui/filter-bar";
import { HiddenFields, Select } from "@/components/ui/form";
import { Menu, MenuButton, MenuItem } from "@/components/ui/menu";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { SearchField } from "@/components/ui/search-field";
import { Status } from "@/components/ui/status";
import { EmptyRow, Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { findApplication, getApplicationRow } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { compileSet, rulesNeverReached } from "@/lib/mocks/compile";
import { applicationDefaultSetId } from "@/lib/mocks/defaults";
import type { MockRule } from "@/lib/mocks/model";
import { RULES_PAGE_SIZE, type RuleFilter, findSet, pageOfRules } from "@/lib/mocks/records";
import { SOURCE_LABELS, matchingSummary, responsesSummary, setSummary } from "@/lib/mocks/views";
import { oneOf, param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { ruleDownAction, ruleDuplicateAction, ruleOffAction, ruleOnAction, ruleUpAction } from "../actions";
import { pageSet, setOutcome } from "../shared";
import styles from "../mock-sets.module.css";

export async function generateMetadata({ params }: PageProps<"/applications/[slug]/mock-sets/[set]">): Promise<Metadata> {
  const { slug, set } = await params;
  const application = findApplication(getDb(), slug);
  const found = application && findSet(getDb(), getApplicationRow(getDb(), application.publicId).id, set);
  return { title: found ? `${found.name} · Mock sets · ${application.name}` : "Mock set not found" };
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const STATES = ["on", "off", "needs-response"] as const;
const STATE_LABELS: Record<(typeof STATES)[number], string> = { on: "On", off: "Off", "needs-response": "Needs a response" };

/**
 * A mock set's page (add-mock-sets, design decision 18; mock-sets spec, "A
 * mock set's page lists its rules"), on the Details template: breadcrumbs
 * to Applications and the application, the set's name with its Default
 * status, and a meta row of its rules, size, and last change. Its primary
 * action is New rule, left out while the empty state offers it; Upload HAR,
 * Export HAR, and Edit mock set follow. Its rules are listed in the set's
 * order, 50 to a page, filtered by path, method, and state, each with its
 * method, pattern, matching, responses, and state, and row actions in an
 * overflow menu. An alert says how many rules need a response.
 */
export default async function MockSetPage({ params, searchParams }: PageProps<"/applications/[slug]/mock-sets/[set]">) {
  const [{ slug, set: setId }, query] = await Promise.all([params, searchParams]);
  const { application, set } = pageSet(slug, setId);
  const isDefault = applicationDefaultSetId(getDb(), application.id) === set.id;
  const filter: RuleFilter = { path: param(query, "path")?.trim().slice(0, 200) || undefined, method: oneOf(query, "method", [...METHODS, "*"]), state: oneOf(query, "state", STATES) };
  const filtered = Boolean(filter.path || filter.method || filter.state);
  const page = Math.max(1, Number(param(query, "page")) || 1);
  const { rules, total, needingResponse } = pageOfRules(getDb(), set.id, filter, page);
  const pages = Math.max(1, Math.ceil(total / RULES_PAGE_SIZE));
  const shadowed = rulesNeverReached(compileSet(getDb(), set));
  const here = (values: { page?: number } = {}) => routes.mockSet(slug, set.publicId, { path: filter.path ?? null, method: filter.method ?? null, state: filter.state ?? null, page: values.page && values.page > 1 ? values.page : null });
  const empty = set.ruleCount === 0;
  const newRule = (
    <ButtonLink href={routes.newMockRule(slug, set.publicId)} variant={empty ? "secondary" : "primary"} icon="plus">
      New rule
    </ButtonLink>
  );

  return (
    <DetailsTemplate
      header={{
        breadcrumbs: [
          { href: routes.applications, label: "Applications" },
          { href: routes.applicationMockSets(slug), label: application.name },
        ],
        title: set.name,
        status: isDefault ? <Status state="ready" label="Default" /> : undefined,
        meta: [
          <span key="summary">{setSummary(set)}</span>,
          <span key="source">{SOURCE_LABELS[set.source]}</span>,
          <span key="changed">
            Changed <RelativeTime value={set.updatedAt} />
            {set.updatedByName && ` by ${set.updatedByName}`}
          </span>,
        ],
        description: set.description || undefined,
        primaryAction: empty ? undefined : newRule,
        secondaryActions: [
          { label: "Upload HAR", href: routes.mockSetUpload(slug, { set: set.publicId }), icon: "arrowUp" },
          { label: "Export HAR", href: routes.mockSetHar(slug, set.publicId), icon: "download" },
          { label: "Edit mock set", href: routes.mockSetEdit(slug, set.publicId), icon: "edit" },
        ],
      }}
      alerts={
        <>
          <OutcomeToast outcome={setOutcome(param(query, "notice"), set)} />
          {needingResponse > 0 && (
            <Alert tone="warning" title={needingResponse === 1 ? "1 rule needs a response" : `${formatNumber(needingResponse)} rules need a response`} actions={<Link href={routes.mockSet(slug, set.publicId, { state: "needs-response" })}>Show them</Link>}>
              {"A rule made from a call answers nothing until a response is written for it and it's turned on."}
            </Alert>
          )}
        </>
      }
      empty={
        empty
          ? {
              title: "No rules yet",
              icon: "network",
              action: (
                <>
                  {newRule}
                  <ButtonLink href={routes.mockSetUpload(slug, { set: set.publicId })} icon="arrowUp">
                    Upload HAR
                  </ButtonLink>
                </>
              ),
              children: "A rule answers the calls it matches with its responses. Write one, or upload a HAR file to add a rule for each call it recorded.",
            }
          : undefined
      }
    >
      <div className={styles.toolbar}>
        <p className={styles.count} role="status">
          {filtered ? `${formatNumber(total)} of ${formatNumber(set.ruleCount)} rules` : `${formatNumber(set.ruleCount)} ${set.ruleCount === 1 ? "rule" : "rules"}, most specific first when they match one call`}
        </p>
        <FilterBar key={`${filter.path}:${filter.method}:${filter.state}`} action={routes.mockSet(slug, set.publicId)} label="Filter rules" filtered={filtered} clearHref={routes.mockSet(slug, set.publicId)}>
          <SearchField id="rule-path" name="path" label="Path" hideLabel size="sm" placeholder="Filter by path" defaultValue={filter.path ?? ""} />
          <Select id="rule-method" name="method" label="Method" hideLabel size="sm" defaultValue={filter.method ?? ""} options={[{ value: "", label: "Any method" }, ...METHODS.map((method) => ({ value: method, label: method })), { value: "*", label: "Rules for any method" }]} />
          <Select id="rule-state" name="state" label="State" hideLabel size="sm" defaultValue={filter.state ?? ""} options={[{ value: "", label: "Any state" }, ...STATES.map((state) => ({ value: state, label: STATE_LABELS[state] }))]} />
        </FilterBar>
      </div>
      <Panel flush>
        <Table
          label={`Rules of ${set.name}`}
          head={
            <>
              <Th>Method</Th>
              <Th>Pattern</Th>
              <Th>Matching</Th>
              <Th>Responses</Th>
              <Th>State</Th>
              <Th align="actions" hidden>
                Actions
              </Th>
            </>
          }
        >
          {rules.length === 0 ? (
            <EmptyRow columns={6}>No rules match these filters.</EmptyRow>
          ) : (
            rules.map((rule) => <RuleRow key={rule.publicId} slug={slug} setId={set.publicId} rule={rule} mapped={set.hostMode === "mapped"} shadowed={shadowed.has(rule.publicId)} back={here({ page })} />)
          )}
        </Table>
      </Panel>
      <Pagination label="Rules pages" page={Math.min(page, pages)} pages={pages} href={(number) => here({ page: number })} />
    </DetailsTemplate>
  );
}

function RuleRow({ slug, setId, rule, mapped, shadowed, back }: { slug: string; setId: string; rule: MockRule; mapped: boolean; shadowed: boolean; back: string }) {
  const label = `${rule.method === "*" ? "ANY" : rule.method} ${rule.pattern}`;
  const state = rule.responses.length === 0 ? <Status state="warning" label="Needs a response" size="sm" /> : !rule.enabled ? <Status state="absent" label="Off" size="sm" /> : shadowed ? <Status state="stale" label="Never reached" size="sm" /> : <Status state="ready" label="On" size="sm" />;
  return (
    <tr data-rule={label}>
      <Td label="Method">
        <Tag>{rule.method === "*" ? "ANY" : rule.method}</Tag>
      </Td>
      <Td label="Pattern">
        <Primary>
          <Link href={routes.mockRule(slug, setId, rule.publicId)} aria-label={`Edit ${label}`}>
            <code className={styles.pattern}>{rule.pattern}</code>
          </Link>
        </Primary>
        {shadowed && <Secondary>An earlier rule with the same request always answers first.</Secondary>}
      </Td>
      <Td label="Matching">
        <span className={styles.secondary}>{matchingSummary(rule, mapped)}</span>
      </Td>
      <Td label="Responses">
        {responsesSummary(rule)}
        {rule.responses.some((response) => response.body) && <Secondary>{formatBytes(rule.responses.reduce((sum, response) => sum + (response.body?.size ?? 0), 0))}</Secondary>}
      </Td>
      <Td label="State">{state}</Td>
      <Td align="actions">
        <RowActions>
          <form action={ruleOnAction} className={styles.rowForm}>
            <HiddenFields values={{ application: slug, set: setId, rule: rule.publicId, back }} />
            <Menu label={`Actions for ${label}`}>
              <MenuItem href={routes.mockRule(slug, setId, rule.publicId)} icon="edit">
                Edit rule
              </MenuItem>
              {rule.enabled ? (
                <MenuButton formAction={ruleOffAction} icon="eyeOff">
                  Turn off
                </MenuButton>
              ) : (
                <MenuButton formAction={ruleOnAction} icon="eye" disabled={rule.responses.length === 0}>
                  Turn on
                </MenuButton>
              )}
              <MenuButton formAction={ruleUpAction} icon="arrowUp">
                Move up
              </MenuButton>
              <MenuButton formAction={ruleDownAction} icon="arrowDown">
                Move down
              </MenuButton>
              <MenuButton formAction={ruleDuplicateAction} icon="copy">
                Duplicate
              </MenuButton>
            </Menu>
          </form>
        </RowActions>
      </Td>
    </tr>
  );
}
