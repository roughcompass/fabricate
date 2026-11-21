import { notFound } from "next/navigation";
import { FlowTemplate } from "@/components/templates/flow-template";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/components/ui/count";
import { Checkbox, FormFooter, FormSection, HiddenFields, TextInput, formStyles } from "@/components/ui/form";
import { findApplication } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { applicationApis } from "@/lib/mocks/profile-apis";
import { routes } from "@/lib/web/routes";
import { skipDataAction } from "./actions";
import styles from "./onboarding.module.css";

const STEPS = ["Repository", "Branch", "Eligibility", "Details", "Data"] as const;

/** Inline code in the Profile's words, such as "MSW handlers in `src/mocks/handlers.ts`". */
function withCode(text: string): React.ReactNode[] {
  return text.split(/`([^`]+)`/).map((part, index) => (index % 2 ? <code key={index}>{part}</code> : part));
}

/**
 * Onboarding's Data step (add-mock-sets, design decision 19; onboarding
 * spec, "Onboarding offers an optional Data step"): after Create
 * application, when the Profile of the commit eligibility checked reports a
 * Service Dependency or a test substitute. It lists up to 10 of the APIs the
 * code calls, each with up to 5 operations, and the test substitutes found,
 * and holds the upload form, whose saved review makes the new set the
 * application's default and opens the Applications page. Skip for now opens
 * the Applications page as Create application does. Nothing in it is
 * required, and it works without JavaScript.
 */
export function DataStep({ slug }: { slug: string }) {
  const application = findApplication(getDb(), slug);
  if (!application) notFound();
  const apis = applicationApis(getDb(), application.publicId);
  return (
    <FlowTemplate
      focused
      header={{ title: "New application", description: `${application.name} was created, and its first build is building.` }}
      // The warning sits in the alerts zone, as Upload HAR's does, never inside the step's panel.
      alerts={
        <Alert tone="warning" title="Use recordings of test environments with synthetic data only">
          {"Never upload real customer, employee, or account data. Mock sets are unencrypted, and everyone who can open the application can see them. The Frontend Registry removes credentials it recognizes, such as tokens and cookies, but it can't recognize personal data."}
        </Alert>
      }
      steps={STEPS}
      current={5}
    >
      <div className={styles.step}>
        <p>{`${application.name}'s code calls APIs that a static preview can't reach, so its pages may load empty. A mock set answers those calls in previews and screenshots. This step is optional.`}</p>
        {apis.services.length > 0 && (
          <FormSection title="The APIs the code calls" description="From the Profile of the commit that was checked.">
            <ul className={styles.apis} aria-label="APIs the code calls">
              {apis.services.map((service, index) => (
                <li key={index} data-api={service.endpoint}>
                  <code>{service.endpoint}</code>
                  {` · ${service.client}`}
                  {service.operations.length > 0 && (
                    <ul>
                      {service.operations.map((operation) => (
                        <li key={operation}>
                          <code>{operation}</code>
                        </li>
                      ))}
                      {service.more > 0 && <li>{`and ${formatNumber(service.more)} more`}</li>}
                    </ul>
                  )}
                </li>
              ))}
              {apis.moreServices > 0 && <li>{`and ${formatNumber(apis.moreServices)} more`}</li>}
            </ul>
          </FormSection>
        )}
        {apis.substitutes.length > 0 && (
          <FormSection title="Test substitutes found">
            <ul className={styles.apis} aria-label="Test substitutes found">
              {apis.substitutes.map((substitute) => (
                <li key={substitute}>{withCode(substitute)}</li>
              ))}
            </ul>
            <p>{"Turning them into a mock set isn't available yet. Upload a HAR file instead."}</p>
          </FormSection>
        )}
        <form method="post" action={routes.mockSetImportsApi(application.slug)} encType="multipart/form-data" noValidate className={formStyles.form} aria-label="Upload HAR">
          <HiddenFields values={{ from: "onboarding", target: "new", application: application.slug }} />
          <TextInput id="data-file" name="file" type="file" label="HAR file" optional accept=".har,application/json" description="Record one in a browser's network panel against a test environment: Export HAR in Chrome or Edge, Save All As HAR in Firefox, or Export in Safari." />
          <TextInput id="data-name" name="name" label="Mock set's name" optional maxLength={60} defaultValue="Happy path" />
          <Checkbox id="data-confirm" name="confirm" value="yes" label="This recording holds only synthetic test data" />
          <FormFooter>
            <Button type="submit" formAction={skipDataAction}>
              Skip for now
            </Button>
            <Button type="submit" variant="primary" icon="arrowUp">
              Upload HAR
            </Button>
          </FormFooter>
        </form>
      </div>
    </FlowTemplate>
  );
}
