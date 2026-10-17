# Applications walkthrough (make-applications-first-class, task 11.2)

Run on 2026-10-16 against an empty database, with `npx playwright test e2e/applications-walkthrough.spec.ts`. The spec drives every step through the UI. The one exception is the worker: it doesn't run beside the browser tests, so the spec runs the queued jobs itself, as the worker would.

| Step | What happened |
| --- | --- |
| 1. Create the Portal Access | Create Portal from the Navigation list opened the dialog. After Web, SEAL ID 88001, Access, Access Platform, and a description, Access's Navigation page opened with "Access was created as a Prototype." and Access current in the switcher. |
| 2. Add Payee Hub from Salt Starter | On Add application, Salt Starter opened Create Application with its scaffold steps beside the form. The local `file://` repository in the allowed root, with single-spa `bootstrap`, `mount`, and `unmount` exports, was accepted, and Access was preselected. Create Application opened Payee Hub's dashboard with "Payee Hub was created." and the assessment Queued. |
| 3. Watch the dashboard reach Assessed and ESM | When the DE Web Run finished, the dashboard changed to Assessed, linked to the Run, with the rendering ESM, without a reload. |
| 4. Make it Access's default item | Applications not in the menu listed Payee Hub. Add to menu added Payees at `/payees`, and Make default marked it Default. |
| 5. Promote Access | Promote to Production, confirmed, showed "Access is in Production." |
| 6. Confirm the results | Payee Hub's Production checklist read 6/6. The Repositories list named Payee Hub in its Application column. Home's Applications group counted 1 Application and 1 Production Portal. |

Result: passed in 12.6s.
