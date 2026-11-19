import { Button } from "@/components/ui/button";
import { Checkbox, ChoiceGroup, FormFooter, FormSection, Select, Switch, TextArea, TextInput } from "@/components/ui/form";
import { SearchField } from "@/components/ui/search-field";
import { IndeterminateCheckbox } from "../demos";
import { Row, Specimen } from "../specimen";
import styles from "../design-system.module.css";

/** Form controls and the search field. */
export function FormSpecimens() {
  return (
    <>
      <Specimen
        id="form-controls"
        title="Form controls"
        description="Label, control, then description or error. Every control shares one boundary, fill, and focus ring."
        render={(theme) => (
          <div className={styles.stack}>
            <FormSection title="Section" description="A titled group of fields.">
              <TextInput id={`${theme}-name`} label="Name" description="A display name." defaultValue="orders" />
              <TextInput id={`${theme}-url`} label="Clone URL" mono placeholder="https://git.example.com/acme/orders.git" />
              <TextInput id={`${theme}-invalid`} label="Reference" optional mono defaultValue="--upload-pack" errors={["A reference cannot start with a hyphen."]} />
              <TextInput id={`${theme}-disabled`} label="Disabled" disabled defaultValue="Cannot change" />
              <TextArea id={`${theme}-objective`} label="Objective" optional rows={2} defaultValue="Assess the fleet" />
              <Select
                id={`${theme}-severity`}
                label="Severity"
                defaultValue="medium"
                options={[
                  { value: "critical", label: "Critical" },
                  { value: "medium", label: "Medium" },
                ]}
              />
              <Select id={`${theme}-small`} label="Small select" size="sm" options={[{ value: "", label: "Any outcome" }]} />
            </FormSection>
            <Row label="Check boxes">
              <Checkbox id={`${theme}-check`} label="Checked" defaultChecked />
              <Checkbox id={`${theme}-uncheck`} label="Unchecked" />
              <IndeterminateCheckbox id={`${theme}-indeterminate`} />
              <Checkbox id={`${theme}-check-disabled`} label="Disabled" disabled defaultChecked />
            </Row>
            <Row label="Switches">
              <Switch id={`${theme}-switch-on`} label="On" defaultChecked />
              <Switch id={`${theme}-switch-off`} label="Off" />
              <Switch id={`${theme}-switch-disabled`} label="Disabled" disabled defaultChecked />
            </Row>
            <ChoiceGroup
              id={`${theme}-scope`}
              name={`${theme}-scope`}
              legend="Repository scope"
              type="radio"
              columns
              selected={["all"]}
              choices={[
                { value: "all", label: "All Repositories", description: "Every Repository in the catalog when a Run starts." },
                { value: "explicit", label: "Selected Repositories", description: "Exactly the Repositories chosen below." },
              ]}
            />
            <ChoiceGroup
              id={`${theme}-platform`}
              name={`${theme}-platform`}
              legend="Platform, with icons"
              type="radio"
              columns
              selected={theme === "light" ? ["web"] : []}
              errors={theme === "light" ? undefined : ["Choose the Portal's platform"]}
              choices={[
                { value: "web", label: "Web", description: "Opens in a browser", icon: "globe" },
                { value: "mobile", label: "Mobile", description: "Runs on phones and tablets", icon: "smartphone" },
                { value: "desktop", label: "Desktop", description: "Runs as an installed application", icon: "monitor", disabled: theme === "dark" },
              ]}
            />
            <ChoiceGroup
              id={`${theme}-releases`}
              name={`${theme}-releases`}
              legend="Standard Releases"
              type="checkbox"
              optional
              selected={["one"]}
              errors={theme === "light" ? undefined : ["Choose at least one Release."]}
              choices={[
                { value: "one", label: "Engineering baseline v2", description: "5 Controls" },
                { value: "two", label: "Service readiness v1", description: "3 Controls" },
                { value: "three", label: "Unavailable", description: "Not published", disabled: true },
              ]}
            />
            <FormFooter>
              <Button>Cancel</Button>
              <Button variant="primary">Save changes</Button>
            </FormFooter>
          </div>
        )}
      />

      <Specimen
        id="search-field"
        title="Search field"
        description="A search icon, the input, and a clear control while it has a value. It submits with its form, so it works without JavaScript."
        render={(theme) => (
          <div className={styles.stack}>
            <SearchField id={`${theme}-search-sm`} label="Small" size="sm" placeholder="Search by name or clone URL" />
            <SearchField id={`${theme}-search-md`} label="Medium" placeholder="Search templates" defaultValue="onboarding" clearHref="/design-system#search-field" />
            <SearchField id={`${theme}-search-lg`} label="Large" size="lg" placeholder="Search templates" description="Matches titles, descriptions, tags, and authors." />
            <SearchField id={`${theme}-search-disabled`} label="Disabled" disabled defaultValue="Cannot change" />
          </div>
        )}
      />
    </>
  );
}
