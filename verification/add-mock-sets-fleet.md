# Mock sets: fleet check

This records task 13.3 of `add-mock-sets`. Two repositories of the seeded fleet were onboarded as applications: `fleet/mf-admin`, a Module Federation remote, and `fleet/mf-shell`, its host. The check followed them through onboarding's Data step, their first builds and screenshots, the failed-calls alert, and New mock set from failed calls. It then timed a large HAR upload, the compiled set, and choosing that set in Data in a running view. The screenshots are in [`add-mock-sets-fleet/`](add-mock-sets-fleet/), 1280 pixels wide.

**Run:** 2026-11-20, 20:36 to 20:53 Pacific time. The branch was `add-mock-sets` at abfd1ff. The fixes in [Defects found](#defects-found) were in the working tree for the run shown, and are committed with this record.

**Result:**
- Both repositories were offered the Data step, built, and captured. As built, neither page makes an API call while it loads, so neither has failed calls or an alert.
- After a scratch-clone commit made mf-admin call two APIs, the rebuild's screenshot recorded both calls as failed. The application page showed the alert, and New mock set from failed calls offered both calls.
- A 5,000-entry HAR became a 500-rule set in about 3 seconds. The view worker received it in under half a second, and choosing it in Data took under a second.
- The check found two defects, now fixed with tests (see [Defects found](#defects-found)). It also found one slow capture, which isn't part of this change and isn't fixed (see [Found, not fixed](#found-not-fixed)).

## Setup

The app ran apart from every other server and database. Everything below was deleted afterward.

| Setting | Value |
| --- | --- |
| Data | A fresh directory, `tmp/fleet-check/` in the worktree, with its own database and repository storage, never `storage/` |
| Web | `next dev` on port 3700, building into `.next-fleetcheck` |
| Worker | `scripts/dev-worker.mjs`, at the default concurrency of 3 |
| Previews | On. Node 20.20.2, 22.23.5, and 24.22.0 from mise, as `fabricate/.env.previews` names them |
| Preview storage | `/private/tmp/fr-fleet-check/previews`, outside the checkout |
| Repositories | Scratch clones of `fleet/mf-admin` and `fleet/mf-shell` under `/private/tmp/fr-fleet-check/sources/`, the only allowed root. The fleet itself wasn't changed |
| Package registry | The seeded fleet registry on `127.0.0.1:4873` that the fleet's `.npmrc` names |
| Browser | Chrome, driven by Playwright, as a first-time visitor who dismissed the guided hints |

The fleet's applications make no API call while their pages load, so two commits were made in the scratch clone of mf-admin only:
- `1ad19e7` loads the access roles from `https://api.acme.test/v1/roles` and tracks opening the page through its analytics client, which posts to `/__analytics`. The `.test` domain never resolves.
- `65829ea` only changes the Access tab's text, giving the rebuild after the fixes a new commit.

## Outcomes

| Repository | Commit | Profile's APIs | Build | Outcome |
| --- | --- | --- | --- | --- |
| `fleet/mf-admin`, `main` | `cccbc40` | The application's own origin, through a packaged client (`@acme/analytics`) | Node 22.23.5, pnpm 11.21.0, 6.3 s | **Ready**, screenshot ready, no failed calls |
| `fleet/mf-shell`, `main` | `3b4eb13` | The same packaged client | Node 20.20.2, npm, 6.7 s | **Ready**, screenshot ready, no failed calls |
| mf-admin (scratch clone) | `1ad19e7` | Adds `GET /v1/roles` on `https://api.acme.test`, through fetch | Node 22.23.5, pnpm 11.21.0, 2.4 s | **Ready**, 2 failed calls |
| mf-admin (scratch clone) | `65829ea` | The same | Node 22.23.5, pnpm 11.21.0, 2.4 s | **Ready**, 2 failed calls |

### What the operator saw

1. **Onboarding's Data step** ([01](add-mock-sets-fleet/01-mf-admin-data-step.jpg), [02](add-mock-sets-fleet/02-mf-shell-data-step.jpg)). From Clone URL to the Data step, including the eligibility check, took 3.5 s for mf-admin and 3.2 s for mf-shell. Both were offered the step, since each Profile reports a Service Dependency. mf-shell's step lists "The application's own origin · A packaged client". These captures were taken again after the fix to the step and the scratch commits. The step reads the Profile of the application's latest build, so mf-admin's now also lists `https://api.acme.test · fetch` with `GET /v1/roles`.
2. **The application pages after the first builds** ([03](add-mock-sets-fleet/03-mf-admin-application-page.jpg), [04](add-mock-sets-fleet/04-mf-shell-application-page.jpg)). Each is Ready, with its screenshot, Mock set None, and the empty Mock sets section. There's no failed-calls alert.
3. **The failed-calls alert** ([05](add-mock-sets-fleet/05-mf-admin-failed-calls.jpg)). After Rebuild at `65829ea`, the alert reads "2 API calls failed when this build loaded", listing:
   - `POST /__analytics` · Answered 404;
   - `GET https://api.acme.test/v1/roles` · Couldn't connect (`net::ERR_NAME_NOT_RESOLVED`).
   
   From Rebuild to the recorded screenshot took 25.0 s, 20.2 s of it in the capture (see [Found, not fixed](#found-not-fixed)).
4. **New mock set from failed calls** ([06](add-mock-sets-fleet/06-mf-admin-start-from-failed-calls.jpg)). Both calls are offered and checked, each with its failure.
5. **Upload HAR and Review HAR** ([07](add-mock-sets-fleet/07-review-generated-har.jpg), [08](add-mock-sets-fleet/08-load-test-set.jpg)). A generated HAR held 5,000 GET entries over 500 addresses on `https://api.acme.test`, as Chrome exports them. Review HAR read "generated-5000.har: 500 API calls to keep" and found no credentials. Create mock set made Load test, with 500 rules of 10 responses each, 389.6 KB.
6. **Data in a running view** ([09](add-mock-sets-fleet/09-mf-admin-data-load-test.jpg)). In mf-admin's running view, Load test was chosen under Mock set. The list shows the page's two calls, neither answered by Load test's rules:
   - `GET https://api.acme.test/v1/roles`, failed with no answer;
   - `POST http://127.0.0.1:3700/__analytics`, failed with 404. Data shows the address the browser called, on the Frontend Registry's origin. The alert and a rule made from the call use its path, which matches on any origin.

### Timings

| Step | Time |
| --- | --- |
| Onboarding to the Data step: mf-admin, mf-shell | 3.5 s, 3.2 s |
| First build and screenshot: mf-admin, mf-shell | 6.3 s and 0.7 s; 6.7 s and 0.7 s |
| Rebuild at `65829ea` to its screenshot, with 2 failed calls | 25.0 s, with a 2.4 s build and a 20.2 s capture |
| Upload HAR of 5,000 entries (3,457,965 bytes) to Review HAR | 1.6 s |
| Create mock set from it, 500 rules | 1.5 s |
| The compiled set as the view worker fetches it: 500 rules, 1,151,364 bytes | 484 ms the first time, then 78, 75, 71, and 72 ms |
| Choosing Load test in Data until the pill's marker rests | 0.8 s |

## Defects found

**1. A failed call to the build's own server was recorded at the capture server's address.** mf-admin's analytics client posts to `/__analytics`, on the page's own origin. The alert listed it as `POST http://127.0.0.1:<port>/__analytics`.
- **Why:** the screenshot's recorder kept each address as Chromium reported it. The worker serves the build from a static server on an ephemeral port, so the address existed only during that capture. A rule made from the call recorded that origin too, so a set that maps hosts would have needed to map an origin that no longer exists.
- **Fix:**
  - A call to the capture's own server is recorded by the path a mock set matches it by: the part after the build's base for a call under it, or the path for a root-relative call, with the query either way.
  - A rule made from a call recorded by its path has no origin, so it matches on any origin.
  - New mock set from failed calls and Add rules now accept such calls rather than marking them unsupported.
- **Tests:** `test/previews/capture-mocks.test.ts` ("a failed call's address") and `test/mocks/records.test.ts` (a path-only call's rule).

**2. The Data step set its descriptions of an endpoint as code.** "The application's own origin" and "An address the code works out as it runs" were shown in the code font, as if they were addresses.
- **Fix:** only an origin or a configured key is set as code.
- **Test:** `test/applications/onboarding-data.test.ts` (a packaged client calling the application's own origin).

The run above is from after both fixes. Before them, step 3 listed `POST http://127.0.0.1:<port>/__analytics`, and step 1's own-origin line was in the code font.

## Found, not fixed

**A capture waits its full 20 seconds when the page leaves a response unread.** mf-admin's analytics client checks only the status of its `/__analytics` post and never reads the body. Chromium then never reports that request as finished, so the capture's wait for network idle runs to its limit. A capture of `1ad19e7` or `65829ea` took 20.2 s, against 0.7 s at `cccbc40`.
- A probe against the capture's static server confirmed it. A `fetch` whose response body was read finished at once, whether GET or POST. One whose body was never read never finished, so network idle never came.
- The screenshot and its failed calls are still right; only the capture's time is long.
- The wait is from `add-applications` (design.md, "waits for load and network idle up to 20 seconds"), and mock sets don't change it. A set's rule answering such a call would take as long.
- Changing what counts as settled is a design decision, so it's reported rather than changed here. At the fleet's scale, a page like this costs 20 s of the worker's time on each capture.
