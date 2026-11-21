import type { Metadata } from "next";
import { FormTemplate } from "@/components/templates/form-template";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { formatNumber } from "@/components/ui/count";
import { Checkbox, FormFooter, HiddenFields, Select, TextInput, formStyles } from "@/components/ui/form";
import { getDb } from "@/lib/db/client";
import { HAR_ENTRY_LIMIT, HAR_UPLOAD_LIMIT } from "@/lib/mocks/har-import";
import { MB } from "@/lib/mocks/model";
import { listSets } from "@/lib/mocks/records";
import { uploadProblem } from "@/lib/mocks/upload";
import { param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { pageApplication } from "../shared";

export const metadata: Metadata = { title: "Upload HAR" };

/**
 * Upload HAR (add-mock-sets, design decisions 12 and 18; mock-set-import
 * spec), on the Form template: the warning about personal data in the
 * alerts zone, then the file, the set it goes into, a new set's name, and
 * the confirmation that the recording holds only synthetic test data. It
 * posts to the upload's route handler, which answers with the review, or
 * back here with what to fix, so it works without JavaScript. `?set=`
 * chooses a set to add to, and `?from=onboarding` returns to onboarding.
 */
export default async function UploadHarPage({ params, searchParams }: PageProps<"/applications/[slug]/mock-sets/upload">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const application = pageApplication(slug);
  const sets = listSets(getDb(), application.id);
  const problem = uploadProblem(param(query, "error"));
  const chosen = param(query, "set");
  const target = sets.some((set) => set.publicId === chosen) ? chosen! : "new";
  const onboarding = param(query, "from") === "onboarding";
  const errors = (field: string) => (problem?.field === field ? [problem.message] : undefined);
  const cancel = onboarding ? routes.applications : target === "new" ? routes.applicationMockSets(slug) : routes.mockSet(slug, target);

  return (
    <FormTemplate
      header={{
        breadcrumbs: [
          { href: routes.applications, label: "Applications" },
          { href: routes.applicationMockSets(slug), label: application.name },
        ],
        title: "Upload HAR",
        description: "Upload a HAR file recorded in a browser's network panel. You review the API calls it would keep before anything is added to a mock set.",
      }}
      alerts={
        <Alert tone="warning" title="Use recordings of test environments with synthetic data only">
          {"Never upload real customer, employee, or account data. Mock sets are unencrypted, and everyone who can open the application can see them. The Frontend Registry removes credentials it recognizes, such as tokens and cookies, but it can't recognize personal data."}
        </Alert>
      }
    >
      <form method="post" action={routes.mockSetImportsApi(slug)} encType="multipart/form-data" noValidate className={formStyles.form}>
        <HiddenFields values={{ from: onboarding ? "onboarding" : null }} />
        <TextInput
          id="upload-file"
          name="file"
          type="file"
          label="HAR file"
          accept=".har,application/json"
          errors={errors("file")}
          autoFocus={problem?.field === "file"}
          description={`Up to ${HAR_UPLOAD_LIMIT / MB} MB and ${formatNumber(HAR_ENTRY_LIMIT)} entries. In Chrome or Edge, choose Export HAR in the network panel; in Firefox, Save All As HAR; in Safari, Export.`}
        />
        <Select
          id="upload-target"
          name="target"
          label="Add the calls to"
          defaultValue={target}
          errors={errors("target")}
          autoFocus={problem?.field === "target"}
          options={[{ value: "new", label: "A new mock set" }, ...sets.map((set) => ({ value: set.publicId, label: set.name }))]}
        />
        <TextInput id="upload-name" name="name" label="New mock set's name" optional maxLength={60} defaultValue={param(query, "name") ?? ""} errors={errors("name")} autoFocus={problem?.field === "name"} description="Needed for a new mock set, such as Happy path. You can change it in the review." />
        <div>
          <Checkbox
            id="upload-confirm"
            name="confirm"
            value="yes"
            label="This recording holds only synthetic test data"
            description="Required. It was recorded against a test environment, with no real customer, employee, or account data."
            autoFocus={problem?.field === "confirm"}
            aria-invalid={problem?.field === "confirm" ? true : undefined}
            aria-describedby={problem?.field === "confirm" ? "upload-confirm-error" : "upload-confirm-description"}
          />
          {problem?.field === "confirm" && (
            <p id="upload-confirm-error" className={formStyles.error}>
              {problem.message}
            </p>
          )}
        </div>
        <FormFooter>
          <ButtonLink href={cancel}>Cancel</ButtonLink>
          <Button type="submit" variant="primary" icon="arrowUp">
            Upload HAR
          </Button>
        </FormFooter>
      </form>
    </FormTemplate>
  );
}
