import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FilterBar } from "@/components/ui/filter-bar";
import { FilterRail } from "@/components/ui/filter-rail";
import { Select } from "@/components/ui/form";
import { Menu, MenuAction, MenuItem } from "@/components/ui/menu";
import { PageHeader } from "@/components/ui/page";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { Status } from "@/components/ui/status";
import { Tag } from "@/components/ui/tag";
import { Tooltip } from "@/components/ui/tooltip";
import { confirmDemo, noopDemo, validateDemo } from "../actions";
import { AlertDemo, FocusDemo, ToastDemo } from "../demos";
import { Row, Specimen } from "../specimen";
import styles from "../design-system.module.css";
import { HOUR, ago } from "./samples";

/** Menus, tooltips, progress, and the filter bar and rail, which apply +tone+ and +kinds+ from the address. */
export function ControlSpecimens({ tone, kinds }: { tone: string; kinds: string[] }) {
  return (
    <>
      <Specimen
        id="menu"
        title="Menu"
        description="Actions in a popover; it opens without JavaScript, closes on Escape, an outside click, or a choice."
        render={(theme) => (
          <Row label="Triggers">
            <Menu label={`Row actions, ${theme}`}>
              <MenuItem href="#menu" icon="edit">
                Edit
              </MenuItem>
              <MenuAction action={noopDemo}>Re-profile</MenuAction>
            </Menu>
            <Menu label={`More actions, ${theme}`} triggerText="More" variant="secondary" size="md" align="start">
              <MenuItem href="#menu">Add Repositories</MenuItem>
              <MenuItem href="#menu">Edit name and purpose</MenuItem>
            </Menu>
          </Row>
        )}
      />

      <Specimen
        id="tooltip"
        title="Tooltip and relative time"
        description="Tooltips appear on hover and keyboard focus. Times read relatively within a week, with the full UTC time in the tooltip."
        render={() => (
          <>
            <Row label="Tooltip">
              <Tooltip content="Explains the control">
                <Button size="sm">Hover or focus</Button>
              </Tooltip>
            </Row>
            <Row label="Relative time">
              <RelativeTime value={ago(90_000)} />
              <RelativeTime value={ago(3 * HOUR)} />
              <RelativeTime value={ago(30 * HOUR)} />
              <RelativeTime value={new Date("2025-08-26T09:30:00Z")} />
              <RelativeTime value={null} />
            </Row>
          </>
        )}
      />

      <Specimen
        id="progress"
        title="Progress and skeleton"
        description="Progress shows finished work out of the total; skeletons hold the layout while a page loads."
        render={() => (
          <>
            <ProgressBar value={3} max={6} label="3 of 6 repositories finished" />
            <div className={styles.stack}>
              <Skeleton width="short" height="title" />
              <Skeleton width="long" />
              <Skeleton height="control" />
            </div>
          </>
        )}
      />

      <Specimen
        id="filter-bar"
        title="Filter bar"
        description="Filters above their results; a change applies immediately, or with Apply when JavaScript is off."
        single
        render={() => (
          <div className={styles.stack}>
            <FilterBar key={tone} action="/design-system" label="Filter demo" filtered={Boolean(tone)} clearHref="/design-system#filter-bar">
              <Select
                id="filter-tone"
                name="tone"
                label="Tone"
                size="sm"
                defaultValue={tone}
                options={[
                  { value: "", label: "Any tone" },
                  { value: "success", label: "Success" },
                  { value: "error", label: "Error" },
                ]}
              />
            </FilterBar>
            <p role="status">{tone ? `Filtered to ${tone}` : "No filter"}</p>
          </div>
        )}
      />

      <Specimen
        id="filter-rail"
        title="Filter rail"
        description="A heading with Clear, collapsible groups that show how many options are checked, and tinted option rows with counts; a disclosure above the results on narrow screens."
        single
        render={() => (
          <div className={styles.railDemo}>
            <FilterRail
              key={kinds.join(",")}
              action="/design-system"
              label="Filter rail demo"
              title="Filter records"
              headingLevel={3}
              groups={[
                {
                  name: "kind",
                  legend: "Kind",
                  options: [
                    { value: "policy", label: "Policy", count: 4 },
                    { value: "plugin", label: "Plugin", count: 2 },
                    { value: "retired", label: "Retired", count: 0, disabled: true },
                  ],
                },
              ]}
              selected={{ kind: kinds }}
              activeCount={kinds.length}
              filtered={kinds.length > 0}
              clearHref="/design-system#filter-rail"
            />
            <p role="status">{kinds.length ? `Filtered to ${kinds.join(" and ")}` : "No filter"}</p>
          </div>
        )}
      />
    </>
  );
}

/** Toasts, alerts, the confirmation dialog, form feedback, and the page header. */
export function FeedbackSpecimens() {
  return (
    <>
      <Specimen
        id="feedback"
        title="Toast"
        description="The outcome of a completed action, once. Success and info dismiss themselves; warnings and errors stay until dismissed."
        single
        render={() => <ToastDemo />}
      />

      <Specimen
        id="alert"
        title="Alert"
        description="A condition of this record that needs attention, in the slot below the page header; one per condition."
        render={(theme) => (
          <>
            <Alert tone="warning" title="1 of 6 repositories could not be assessed">
              billing could not be reached. Its relationships are missing from the map, and Evaluations treat what it could contain as unknown.
            </Alert>
            <Alert tone="info" title="This is a historical Profile" actions={<Button size="sm">View the newest Profile</Button>}>
              A newer Profile of this repository exists.
            </Alert>
            <Alert tone="error" title="The Evaluation failed">
              The Release reads a Profile schema this Assessment does not have.
            </Alert>
            {theme === "light" && (
              <Row label="Raised by a client component">
                <AlertDemo />
              </Row>
            )}
          </>
        )}
      />

      <Specimen
        id="dialog"
        title="Confirmation dialog"
        description="Destructive and irreversible actions are confirmed in the interface: the action, its consequence once, Cancel, and the verb."
        single
        render={() => (
          <Row label="Triggers">
            <ConfirmDialog action={confirmDemo} trigger={{ label: "Cancel Run", icon: "slash" }} title="Cancel Run #3?" confirmLabel="Cancel Run" tone="danger">
              <p>Repositories that have not finished stop at their next check. Completed Profiles are kept.</p>
            </ConfirmDialog>
            <ConfirmDialog action={confirmDemo} trigger={{ label: "Publish v2", icon: "lock", variant: "primary" }} title="Publish Engineering baseline v2?" confirmLabel="Publish v2">
              <p>Release v2 will be published from draft version 7. A published Release can never be edited or deleted.</p>
            </ConfirmDialog>
          </Row>
        )}
      />

      <Specimen
        id="form-feedback"
        title="Form feedback"
        description="A rejected submission shows each field error once, under its field, and moves focus to the first invalid field or to the form alert."
        single
        render={() => (
          <div className={styles.narrow}>
            <FocusDemo action={validateDemo} />
          </div>
        )}
      />

      <Specimen
        id="page-header"
        title="Page header"
        description="Breadcrumbs, the title and status, a meta line, one sentence, and the actions: one primary, with secondary links in a menu on narrow screens."
        render={() => (
          <>
            <PageHeader
              alerts={false}
              headingLevel={3}
              breadcrumbs={[
                { href: "#page-header", label: "Assessments" },
                { href: "#page-header", label: "Checkout platform migration" },
              ]}
              title="Run #3"
              status={<Status state="complete_with_issues" />}
              meta={[<span key="scope">6 Repositories</span>, <RelativeTime key="started" value={ago(2 * HOUR)} />, <Tag key="release">0.1.0</Tag>]}
              description="Each repository is pinned to a commit and analyzed without running its code."
              secondaryActions={[{ href: "#page-header", label: "Edit", icon: "edit" }]}
              primaryAction={
                <Button variant="primary" icon="play">
                  Start Evaluation
                </Button>
              }
            />
            <PageHeader
              alerts={false}
              headingLevel={3}
              title="Repositories"
              secondaryActions={[{ href: "#page-header", label: "Add in bulk", icon: "layers" }]}
              primaryAction={
                <Button variant="primary" icon="plus">
                  New Repository
                </Button>
              }
            />
          </>
        )}
      />
    </>
  );
}
