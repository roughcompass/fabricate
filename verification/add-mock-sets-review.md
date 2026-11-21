# Mock sets: text and screens for review

This document gathers the screens and text that `add-mock-sets` adds or changes, for review by DE design and PMs (task 13.2). It lists every new or changed label, description, notice, warning, refusal, and error message, grouped by surface. Each entry says where the text appears and which capture shows it.

**Status: every entry is awaiting approval.** None of this text is approved. These surfaces don't reach end users until DE design and PMs approve them, and the approval is recorded in `CHANGELOG.md`.

How to read the entries:
- Text in `code` is shown exactly. `{name}` marks a value filled in when the text is shown, such as a mock set's name. `{rule}` is a rule's method and pattern, such as `GET /v1/accounts/:id`, with `ANY` for a rule matching any method.
- **Captures** are in [`screenshots/`](screenshots/), in the light and dark themes. Page captures are at desktop and 375-pixel widths; toolbar captures are at desktop width. The fleet check's captures are in [`add-mock-sets-fleet/`](add-mock-sets-fleet/).
- **Not captured** means the text shows only after an action, such as a toast, or in a state no capture reaches. Each such entry names the browser test that shows it.
- Every browser title also ends with ` · Frontend Registry`.
- Text written by the fixture applications themselves, such as Orders portal's "Recent orders unavailable", belongs to the fixtures, not the product, and isn't listed.

Captures are named by surface:

| Surface | Captures |
| --- | --- |
| An application's page: the Mock sets section, the overview's Mock set row, the failed-calls alert, and the Previews table's Mock set column | `15-application-*`; with no sets yet: `15-application-building-*`, `15-application-failed-*` |
| A set's page | `16-mock-set-*` |
| New rule and Edit rule | `16-mock-rule-new-*`, `16-mock-rule-*` |
| New mock set, from failed calls, and Edit mock set | `16-mock-set-new-*`, `16-mock-set-new-failed-calls-*`, `16-mock-set-edit-*` |
| Upload HAR and Review HAR | `16-mock-set-upload-*`, `16-mock-set-review-*` |
| A saved preview's mock set | `16-saved-preview-mock-set-*` |
| Onboarding's Data step | `16-onboarding-data-*` |
| The Applications page, with Reset workspace | `15-applications-*` |
| The toolbar's Data tool | `toolbar-data/orders-portal-data-*`, `toolbar-data/orders-portal-data-create-rule-*`; with no set: `toolbar-states/panel-data-*`; refused: `toolbar-data/quotes-desk-data-refused-*` |
| The pill's marker and the menu | `toolbar-data/orders-portal-data-pill-*`, `toolbar-states/menu-*`, `toolbar-states/panel-shortcuts-*` |
| Preview mode's line | `toolbar-data/orders-portal-preview-mode-line-*`, `15-application-preview-*`, `15-application-preview-saved-*` |
| Share | `toolbar-data/orders-portal-share-*` |

## 1. The application page's Mock sets section

Captures: `15-application-*`; the empty state: `15-application-building-*`, `15-application-failed-*`.

| Text | Where | Status |
| --- | --- | --- |
| `Mock sets` | The section's heading, between Previews and Builds | Awaiting approval |
| `Recorded or written answers to the application's API calls, applied in previews and screenshots.` | The section's description | Awaiting approval |
| `Upload HAR`, `New mock set` | The section's actions; also the empty state's | Awaiting approval |
| `No mock sets` | The empty state's title | Awaiting approval |
| `Mock sets answer the application's API calls in previews, so its pages show data without a backend. Upload a HAR file recorded against a test environment to start one.` | The empty state's text | Awaiting approval |
| `Mock sets of {application}` | The table's accessible name | Awaiting approval |
| `Name`, `Rules`, `Size`, `Source`, `Last changed`, `Actions` | The table's columns; Actions is for assistive technology only | Awaiting approval |
| `Default` | The tag beside the default set's name | Awaiting approval |
| `Uploaded HAR`, `Written`, `From failed calls` | A set's Source; also the set page's meta row | Awaiting approval |
| `by {person}` | Under Last changed, when the workspace that changed it has a display name | Awaiting approval |
| `Actions for {set}` | The row's overflow menu button | Awaiting approval |
| `Set as default`, `Stop using as default`, `Export HAR`, `Delete mock set` | The row's overflow menu | Awaiting approval |
| `Delete the mock set {set}?` | The delete confirmation's title | Awaiting approval |
| `{set} and its rule are deleted for everyone who opens the application. Views that chose it apply their default set again.` / `{set} and its {n} rules are deleted for everyone who opens the application. Views that chose it apply their default set again.` | The delete confirmation's text, for one rule and for any other number | Awaiting approval |
| `It's the application's default, so the application will have no default set, and its screenshots will show what loads without mocks.` | The delete confirmation's second paragraph, for the default set | Awaiting approval |
| `Delete mock set`, `Cancel` | The delete confirmation's buttons | Awaiting approval |
| `Mock set` / `{set}`, `None` | The overview's new row: the default set's name, linked to its page, or None | Awaiting approval |

## 2. The failed-calls alert

Captures: `15-application-*`, with five failed calls captured with "Happy path" (the list of calls is in a closed disclosure); New mock set from these calls: `16-mock-set-new-failed-calls-*`. The variant without a set, and its actions, are shown by `e2e/mock-sets.spec.ts`, "No mock set yet".

| Text | Where | Status |
| --- | --- | --- |
| `1 API call failed when this build loaded` / `{n} API calls failed when this build loaded` | The alert's title, when the capture applied no set | Awaiting approval |
| `1 API call failed when this build loaded with "{set}"` / `{n} API calls failed when this build loaded with "{set}"` | The alert's title, when the capture applied a set | Awaiting approval |
| `The build's calls to its APIs failed, so parts of the screenshot may be empty. A mock set can answer them.` | The alert's text, with no set | Awaiting approval |
| `Calls no rule of the set answered failed, so parts of the screenshot may be empty.` | The alert's text, with a set | Awaiting approval |
| `Upload HAR`, `Dismiss` | The alert's actions | Awaiting approval |
| `Start a mock set from these calls` | The alert's action with no set, when a call other than a WebSocket failed | Awaiting approval |
| `Add rules to {set}` | The alert's action with a set, under the same condition | Awaiting approval |
| `The call` / `The {n} calls` | The disclosure's summary | Awaiting approval |
| `Failed API calls` | The list's accessible name | Awaiting approval |
| `{method} {address} · {what happened}`, with ` · {n} times` for a call that repeated | Each call in the list | Awaiting approval |
| `Answered {status}`, `Couldn't connect`, `Blocked by CORS`, `Answered as not mocked`, `The WebSocket never opened` | What happened to a call; also on New mock set from failed calls | Awaiting approval |
| `and {n} more` | The list's last item, when more calls failed than were kept | Awaiting approval |

## 3. A set's page

Captures: `16-mock-set-*`.

| Text | Where | Status |
| --- | --- | --- |
| `{set} · Mock sets · {application}` | The browser title | Awaiting approval |
| `Mock set not found` | The browser title of a set that doesn't exist | Awaiting approval |
| `Default` | The header's status, for the application's default set | Awaiting approval |
| `{n} rule · {size}` / `{n} rules · {size}` | The meta row: rules and size | Awaiting approval |
| `Changed {time}`, `Changed {time} by {person}` | The meta row: the last change | Awaiting approval |
| `New rule` | The primary action, left out while the empty state offers it; then the empty state's action | Awaiting approval |
| `Upload HAR`, `Export HAR`, `Edit mock set` | The header's secondary actions; Upload HAR is also the empty state's | Awaiting approval |
| `1 rule needs a response` / `{n} rules need a response` | The warning alert's title | Awaiting approval |
| `Show them` | The alert's link, to the rules filtered by Needs a response | Awaiting approval |
| `A rule made from a call answers nothing until a response is written for it and it's turned on.` | The alert's text | Awaiting approval |
| `No rules yet` | The empty state's title | Awaiting approval |
| `A rule answers the calls it matches with its responses. Write one, or upload a HAR file to add a rule for each call it recorded.` | The empty state's text | Awaiting approval |
| `{n} rule, most specific first when they match one call` / `{n} rules, most specific first when they match one call` | The count above the table | Awaiting approval |
| `{n} of {total} rules` | The count, while filtered | Awaiting approval |
| `Filter rules`, `Path`, `Filter by path`, `Method`, `State` | The filters' accessible names, labels, and placeholder | Awaiting approval |
| `Any method`, `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `Rules for any method` | The method filter's options | Awaiting approval |
| `Any state`, `On`, `Off`, `Needs a response` | The state filter's options | Awaiting approval |
| `Rules of {set}` | The table's accessible name | Awaiting approval |
| `Method`, `Pattern`, `Matching`, `Responses`, `State`, `Actions` | The table's columns; Actions is for assistive technology only | Awaiting approval |
| `No rules match these filters.` | The table, when the filters match nothing | Awaiting approval |
| `Rules pages` | The pagination's accessible name | Awaiting approval |
| `ANY` | The method of a rule matching any method | Awaiting approval |
| `On`, `Off`, `Needs a response`, `Never reached` | A rule's state | Awaiting approval |
| `An earlier rule with the same request always answers first.` | Under a rule that's never reached | Awaiting approval |
| `Edit {rule}` | The pattern link's accessible name | Awaiting approval |
| `{origin} · ` (only when the set maps hosts), then `Any query`, `Query: {name=value&…}`, or `Query: none`, with `, ignores {names}`, then ` · Any body`, ` · Body: exact`, or ` · Body: JSON` | A rule's Matching | Awaiting approval |
| `Needs a response`, `{statuses}` (up to four), `{n} responses, {status} first` | A rule's Responses | Awaiting approval |
| `Actions for {rule}` | The row's overflow menu button | Awaiting approval |
| `Edit rule`, `Turn off`, `Turn on`, `Move up`, `Move down`, `Duplicate` | The row's overflow menu; Turn on is unavailable without a response | Awaiting approval |

## 4. New rule and Edit rule

Captures: `16-mock-rule-new-*`, `16-mock-rule-*`.

| Text | Where | Status |
| --- | --- | --- |
| `New rule` | New rule's title and browser title | Awaiting approval |
| `A rule answers the calls it matches with its responses. It's added at the end of {set}.` | New rule's description | Awaiting approval |
| `Edit {rule}`, `Edit rule` | Edit rule's title, and its browser title | Awaiting approval |
| `Created {time}, last changed {time}.` | Edit rule's description; each part can read `by {person} {time}` | Awaiting approval |
| `Request` / `The calls the rule answers. A rule matches a call when its method, pattern, query, and body all match.` | The request section's heading and description | Awaiting approval |
| `Method` | A field; its options are `GET` to `OPTIONS`, then `Any method` | Awaiting approval |
| `Pattern` / `The path from the API's root, such as /v1/accounts/:id. Name each part that changes with :name, and end with * to match the rest of the path.` | A field and its help | Awaiting approval |
| `Recorded origin` / `Where the call was recorded, such as https://dev-api.example.test. It counts only when the mock set maps hosts.` | A field and its help | Awaiting approval |
| `Query`: `Exactly these parameters` (`The same names and values, in any order.`), `These parameters, ignoring some` (`Exact, apart from the parameters named below, such as a cache buster.`), `Any query` | The query choice | Awaiting approval |
| `Query parameters` / `One name=value a line.` | A field and its help | Awaiting approval |
| `Ignored parameters` / `Names separated by commas, such as _.` | A field and its help | Awaiting approval |
| `Body`: `Any body`, `Exactly this text`, `The same JSON` (`Members in any order, and any spacing.`) | The body choice | Awaiting approval |
| `Body to compare` / `Up to 64 KB, compared as the body option says.` | A field and its help | Awaiting approval |
| `Responses` / `Repeated calls get the responses in order, then the last again. The order starts over when the page loads again, and when the rule changes.` | The responses section's heading and description | Awaiting approval |
| `No response yet. The rule answers nothing until it has one and it's turned on.` | The responses section, with none | Awaiting approval |
| `Response`, `Response {n}` | Each response's heading, alone or among several | Awaiting approval |
| `Status`, `Content type`, `Latency in milliseconds` | A response's fields | Awaiting approval |
| `Headers` / `One Name: value a line. Set-Cookie isn't allowed, and Content-Length is computed.` | A response's field and its help | Awaiting approval |
| `Body` / `Up to 5 MB. A JSON content type needs valid JSON.` | A response's field and its help | Awaiting approval |
| `The body is kept as stored: {content type}, {size}. It can't be edited here.` | In place of Body, for a large or binary body; the type reads `binary` when there's none | Awaiting approval |
| `Remove this response when saving` | Each response's checkbox | Awaiting approval |
| `Add response` | The responses section's button | Awaiting approval |
| `Turned on` / `A rule that's off, or has no response, answers nothing.` | The checkbox and its help | Awaiting approval |
| `Create rule`, `Save changes`, `Cancel` | The footer | Awaiting approval |
| `Danger zone` / `Deleting a rule can't be undone.` | Edit rule's danger section | Awaiting approval |
| `Delete rule` / `Removes {rule} from {set} for everyone.` | The danger section's title, button, and text | Awaiting approval |
| `Delete {rule}?` / `{rule} is deleted from {set} for everyone who opens the application. Calls it answered pass through, or match another rule.` | The confirmation's title and text | Awaiting approval |

## 5. New mock set and Edit mock set

Captures: `16-mock-set-new-*`, `16-mock-set-new-failed-calls-*`, `16-mock-set-edit-*`.

| Text | Where | Status |
| --- | --- | --- |
| `New mock set` | The title and browser title | Awaiting approval |
| `An empty mock set of {application}. Add rules to it, or upload a HAR file into it.` | New mock set's description | Awaiting approval |
| `Start a mock set from the API calls that failed when the current build loaded. Write a response for each rule afterward.` | Its description, from failed calls | Awaiting approval |
| `Name` / `Unique among the application's mock sets, such as Happy path or Errors.` | A field and its help; also Edit mock set | Awaiting approval |
| `Description` | A field | Awaiting approval |
| `Calls to start from` / `A rule is added for each call chosen. Each needs a response written before it answers anything.` | The section from failed calls | Awaiting approval |
| `{method} {address}`, with `{what happened}` or `{what happened}. WebSockets can't be mocked yet.` | Each call's checkbox and its help | Awaiting approval |
| `Create mock set`, `Cancel` | The footer | Awaiting approval |
| `Edit {set}`, `Edit mock set` | Edit mock set's title, and its browser title | Awaiting approval |
| `Hosts` / `Which hosts the set's rules answer. Rules written without a recorded origin answer any host.` | The hosts section's heading and description; also the choice's legend | Awaiting approval |
| `Any host` / `Paths are compared, whatever host the build calls.` | The first hosts option; also on Review HAR | Awaiting approval |
| `Map the hosts recorded` / `Each rule answers only calls to the origin its recorded origin maps to.` | The second hosts option | Awaiting approval |
| `Recorded origin`, `Origin the build calls` / `Or self, for the preview's own origin, which relative calls use.` | Each host's fields, and the first row's help | Awaiting approval |
| `Calls no rule matches` | A choice's legend | Awaiting approval |
| `Pass through` / `They go to their own address, as they would without a mock set.` | Its first option | Awaiting approval |
| `Answer as not mocked` / `They get status 501 with X-Frontend-Registry-Mock: not-matched, and nothing is sent.` | Its second option | Awaiting approval |
| `Save changes` | Edit mock set's footer | Awaiting approval |
| `Danger zone` / `Deleting a mock set can't be undone.` | The danger section | Awaiting approval |
| `Delete mock set` / `Deletes {set} and its rules for everyone who opens the application. Views that chose it apply their default set again.`, and for the default ` It's the application's default, so the application will have no default set.` | The danger section's title, button, and text | Awaiting approval |
| `Type {set} to confirm` | The confirmation field's label, and its error when the name doesn't match | Awaiting approval |

## 6. Upload HAR

Captures: `16-mock-set-upload-*`.

| Text | Where | Status |
| --- | --- | --- |
| `Upload HAR` | The title, browser title, and submit button | Awaiting approval |
| `Upload a HAR file recorded in a browser's network panel. You review the API calls it would keep before anything is added to a mock set.` | The description | Awaiting approval |
| `Use recordings of test environments with synthetic data only` | The warning's title, in the alerts zone; also on the Data step | Awaiting approval |
| `Never upload real customer, employee, or account data. Mock sets are unencrypted, and everyone who can open the application can see them. The Frontend Registry removes credentials it recognizes, such as tokens and cookies, but it can't recognize personal data.` | The warning's text; also on the Data step | Awaiting approval |
| `HAR file` / `Up to 50 MB and 5,000 entries. In Chrome or Edge, choose Export HAR in the network panel; in Firefox, Save All As HAR; in Safari, Export.` | The file field and its help | Awaiting approval |
| `Add the calls to` / `A new mock set`, `{set}` | The target choice and its options | Awaiting approval |
| `New mock set's name` / `Needed for a new mock set, such as Happy path. You can change it in the review.` | A field and its help | Awaiting approval |
| `This recording holds only synthetic test data` / `Required. It was recorded against a test environment, with no real customer, employee, or account data.` | The confirmation and its help; the Data step has the checkbox without the help | Awaiting approval |
| `Cancel` | The footer | Awaiting approval |
| `This confirmation is required. Confirm that the recording holds only synthetic test data.` | The confirmation's error | Awaiting approval |
| `Choose a HAR file.` | The file field's error | Awaiting approval |
| `A HAR file can have up to 50 MB. Export only the calls you need, or record a shorter session.` | The file field's error for a large file | Awaiting approval |
| `This file isn't a HAR file. Export one from the browser's network panel: in Chrome or Edge, choose Export HAR; in Firefox, Save All As HAR; in Safari, Export.` | The file field's error | Awaiting approval |
| `Two uploads are being read. Try again in a minute.` | The file field's error while two uploads are parsed | Awaiting approval |
| `Enter a name for the new mock set.`, `Use at most 60 characters.` | The name field's errors | Awaiting approval |
| `That mock set no longer exists. Someone else deleted it. Choose another, or a new mock set.` | The target's error | Awaiting approval |

## 7. Review HAR

Captures: `16-mock-set-review-*`, for Orders portal's Chrome recording (the left-out entries are in a closed disclosure). The expired state is shown by `e2e/mock-set-import.spec.ts`.

| Text | Where | Status |
| --- | --- | --- |
| `Review HAR` | The title and browser title | Awaiting approval |
| `{file}: 1 API call to keep. Nothing is saved until you select Create mock set.` / `{file}: {n} API calls to keep. Nothing is saved until you select Create mock set.` | The description, for a new set | Awaiting approval |
| `{file}: 1 API call to keep, added to {set}. Nothing is saved until you select Add rules.` / `{file}: {n} API calls to keep, added to {set}. Nothing is saved until you select Add rules.` | The description, for an existing set | Awaiting approval |
| `Credentials were removed before anything was stored` / `No credentials were found` | The summary alert's title | Awaiting approval |
| `Headers dropped: {header}, {header} ({n})` | A summary item, and under each call; the count shows for a header dropped more than once | Awaiting approval |
| `{n} cookie dropped` / `{n} cookies dropped` | A summary item | Awaiting approval |
| `{n} value redacted` / `{n} values redacted` | A summary item | Awaiting approval |
| `{n} token-like value replaced. An application that reads a token's contents needs a synthetic token written into the rule.` / `{n} token-like values replaced. …` | A summary item | Awaiting approval |
| `Personal data can't be detected. Check each call before saving.` | The summary alert's text | Awaiting approval |
| `Calls to keep` / `Each kept call becomes a rule. Unchecked calls aren't saved.` | The section's heading and description | Awaiting approval |
| `{origin}` | The heading before each host's calls | Awaiting approval |
| `{method} {pattern}{?query}` | Each call's checkbox | Awaiting approval |
| `Status {status}`, `{n} responses: {statuses}`, then ` · {size}` | Each call's help | Awaiting approval |
| `Ignores {names}`, `Matches its body as JSON`, `Matches its body exactly`, `{n} calls`, `Keeps its first {n} responses and its last; {n} more left out` | Each call's matching lines | Awaiting approval |
| `Its body can't be checked for credentials or personal data.` | The binary note, on a call left unchecked | Awaiting approval |
| `Removed from {call}` | The accessible name of a call's removed list | Awaiting approval |
| `Pages of calls`, `Page {n} of {pages}`, `Previous page`, `Next page` | The paging | Awaiting approval |
| `Hosts` / `The origins the kept calls were recorded on.` | The hosts section, for a new set | Awaiting approval |
| `The new set matches`: `Any host` (`Paths are compared, whatever host the build calls.`), `The hosts below` (`Each recorded origin answers calls to the origin the build calls instead.`) | The hosts choice | Awaiting approval |
| `The build calls, for {origin}` / `{n} call recorded. Enter an origin, or self for the preview's own origin.` / `{n} calls recorded. …` | Each host's field and its help | Awaiting approval |
| `This set needs mapped hosts, because both origins answer {requests} differently. Enter the origin the build calls for each.` / `… because several origins answer {requests} differently. …` | The hosts section's note, when the recording needs them | Awaiting approval |
| `Name and default` | The section's heading | Awaiting approval |
| `Mock set's name` | A field, for a new set; also on the Data step | Awaiting approval |
| `The kept calls are added after the rules of {set}.` | In place of the name, for an existing set | Awaiting approval |
| `Make it the application's default mock set, since it has none` / `Make it the application's default mock set` | The default checkbox, without and with a default | Awaiting approval |
| `The default applies to views no one chose a set for, and to screenshots.` | The default checkbox's help | Awaiting approval |
| `Cancel`, `Create mock set`, `Add rules` | The footer | Awaiting approval |
| `Left out: {n} entry` / `Left out: {n} entries` | The disclosure's summary | Awaiting approval |
| `{n} entry past the 5,000th was left out.` / `{n} entries past the 5,000th were left out.` | In the disclosure, for a long recording | Awaiting approval |
| `Left out`, `{method} {address} · {reason}` | The list's accessible name, and each entry | Awaiting approval |
| `The page's own file, which mock sets never answer`; `A CORS preflight, which mocked calls don't need`; `WebSocket connections can't be mocked yet`; `No response was recorded`; `Its body wasn't exported. Export the HAR with content.`; `Its body is over 5 MB`; `Answered from the browser's cache, with no body recorded`; `Not an address a mock set can answer` | The reasons an entry was left out | Awaiting approval |
| `This upload expired` / `This upload expired after 24 hours. Upload the HAR file again.` / `Upload HAR` | The expired state's title, text, and action | Awaiting approval |

## 8. A saved preview's mock set

Captures: the Previews table in `15-application-*`; the form: `16-saved-preview-mock-set-*`.

| Text | Where | Status |
| --- | --- | --- |
| `Mock set` | The Previews table's new column | Awaiting approval |
| `{set}`, `None`, `Application default ({set})`, `Application default (none)` | A row's Mock set | Awaiting approval |
| `Choose mock set` | The row's overflow menu | Awaiting approval |
| `Mock set for {ref}`, `Mock set for a saved preview` | The form's title, and its browser title | Awaiting approval |
| `The mock set {ref}'s views apply when no visitor chose one, and its screenshots.` | The form's description | Awaiting approval |
| `Mock set` | The choice's legend | Awaiting approval |
| `Application default ({set})` / `Application default (none)` with `It follows when the application's default changes.` | The first option and its help | Awaiting approval |
| `None` / `The application's own network, even when the application has a default.` | The second option and its help | Awaiting approval |
| `{set}` / `{description}` | One option for each set | Awaiting approval |
| `Cancel`, `Save changes` | The footer | Awaiting approval |
| `That mock set no longer exists. Someone else deleted it.`, `That saved preview no longer exists. Someone else removed it.` | The form's errors | Awaiting approval |

## 9. Onboarding's Data step

Captures: `16-onboarding-data-*`, for a Profile that reports calls to `https://api.orders.test` and MSW handlers; the fleet's real Profiles: `add-mock-sets-fleet/`.

| Text | Where | Status |
| --- | --- | --- |
| `Data` | The flow's new fifth step | Awaiting approval |
| `{application} was created, and its first build is building.` | The step's description, under New application | Awaiting approval |
| `{application}'s code calls APIs that a static preview can't reach, so its pages may load empty. A mock set answers those calls in previews and screenshots. This step is optional.` | The step's first paragraph | Awaiting approval |
| `The APIs the code calls` / `From the Profile of the commit that was checked.` | The section's heading and description; `APIs the code calls` is the list's accessible name | Awaiting approval |
| `{endpoint} · {client}` | Each API | Awaiting approval |
| `The application's own origin`, `An address the code works out as it runs` | An API's endpoint, besides an origin or `{source}.{key}`. These two are set as text; an origin or `{source}.{key}` is set as code | Awaiting approval |
| `fetch`, `axios`, `EventSource`, `WebSocket`, `GraphQL`, `A generated client`, `A packaged client`, `Unknown client` | An API's client | Awaiting approval |
| `{method} {path}`, `Event stream {path}`, `WebSocket {path}` | Each operation | Awaiting approval |
| `and {n} more` | After the operations, and after the APIs | Awaiting approval |
| `Test substitutes found` | The section's heading, and its list's accessible name | Awaiting approval |
| `Fixtures in {path}`, `MSW handlers in {file}`, `{library} interceptors in {file}`, `Request interceptors in {file}`, `An MSW worker in {file}`, `A mock server in {file}`, `{library} mocks in {file}`, `Test substitutes in {file}` | Each test substitute; ` in {file}` is left out when no file is known | Awaiting approval |
| `Turning them into a mock set isn't available yet. Upload a HAR file instead.` | Under the test substitutes | Awaiting approval |
| The warning of section 6 | In the alerts zone, above the steps | Awaiting approval |
| `Upload HAR`, `HAR file` / `Record one in a browser's network panel against a test environment: Export HAR in Chrome or Edge, Save All As HAR in Firefox, or Export in Safari.` | The upload form's accessible name and button, and the file field and its help | Awaiting approval |
| `Mock set's name` (prefilled `Happy path`), `This recording holds only synthetic test data` | The upload form's fields | Awaiting approval |
| `Skip for now` | The step's other button | Awaiting approval |

## 10. Notices

Not captured: each shows once after its action, as `e2e/mock-sets.spec.ts`, `e2e/mock-set-import.spec.ts`, `e2e/saved-previews.spec.ts`, and `e2e/onboarding.spec.ts` show.

| Text | Where | Status |
| --- | --- | --- |
| `{application} was created, with a mock set.` / `Its first build is queued, and its screenshot applies the mock set, its default.` | The Applications page, after saving the Data step's upload | Awaiting approval |
| `The default mock set was changed.` / `Views no one chose a set for apply it, and the current build is captured again with it.` | The application page, after Set as default | Awaiting approval |
| `{application} has no default mock set.` / `Views no one chose a set for use the application's own network.` | After Stop using as default | Awaiting approval |
| `The mock set was deleted.` / `It's gone for everyone who opens the application. Views that chose it apply their default set again.` | After Delete mock set | Awaiting approval |
| `The upload was cancelled.` / `Nothing of the file was kept.` | After Cancel on Review HAR | Awaiting approval |
| `{ref}'s mock set was changed.` / `Its views no one chose a set for apply it, and its current build is captured again.` | After saving a saved preview's mock set | Awaiting approval |
| `{set} was created.` / `Each rule needs a response before it answers anything.` or `Add rules, or upload a HAR file.` | The set's page, after New mock set, with and without rules | Awaiting approval |
| `{set} was created from the HAR file.` | After Review HAR creates a set | Awaiting approval |
| `The HAR file's rules were added to {set}.` | After Review HAR adds to a set | Awaiting approval |
| `{set} was updated.` | After Edit mock set | Awaiting approval |
| `The rule was added at the end of the set.`, `The rule was saved.`, `The rule was deleted.` | After New rule, Edit rule, and Delete rule | Awaiting approval |
| `Rules for the failed calls were added to {set}.` / `Each needs a response before it answers anything.` | After Add rules to {set} | Awaiting approval |
| `Rules for the failed calls couldn't be added.` / `A mock set can have 500 rules. Delete rules it no longer needs first.` | After Add rules to {set}, past the set's limit (new in task 13.1) | Awaiting approval |
| `That rule can't be turned on yet.` / `Write a response for it first.` | After Turn on, for a rule without a response | Awaiting approval |
| `That rule couldn't be duplicated.` / `A mock set can have 500 rules. Delete rules it no longer needs first.` | After Duplicate, at the limit | Awaiting approval |

## 11. Validation and limits

Not captured; the browser tests named show them.

| Text | Where | Status |
| --- | --- | --- |
| `Enter a name`; `Use at most 60 characters`; `Use at most 280 characters` | A set's name and description (`e2e/mock-sets.spec.ts`) | Awaiting approval |
| `Another mock set of this application has that name. Choose another.` | A set's name ("Duplicate name") | Awaiting approval |
| `An application can have 10 mock sets. Delete one first.` | New mock set and Review HAR ("The 11th set") | Awaiting approval |
| `A mock set can have 500 rules. Delete rules it no longer needs first.` | New rule, New mock set, and Review HAR | Awaiting approval |
| `A mock set's responses can hold 20 MB in all. Remove large responses, or put them in another mock set.` | The rule forms and Review HAR | Awaiting approval |
| `Mock set storage is full. Deleting mock sets that are no longer used frees it.` | The rule forms and Review HAR | Awaiting approval |
| `A mock set can map up to 20 hosts`; `Enter an origin, such as https://dev-api.example.test`; `Map each recorded origin once`; `Enter the origin the build calls, such as https://api.example.test, or choose this preview's own origin` | A set's hosts | Awaiting approval |
| `Choose a method, or any method` | A rule's method | Awaiting approval |
| `Enter a path starting with /, such as /v1/accounts/:id. Name each part that changes with :name, and end with * to match the rest of the path.`; `Use at most 2,048 characters` | A rule's pattern | Awaiting approval |
| `Enter an origin, such as https://api.example.test` | A rule's recorded origin | Awaiting approval |
| `Choose how the query is matched`; `A rule can match up to 200 query parameters` | A rule's query | Awaiting approval |
| `Choose how the body is matched`; `Enter the body to compare, or ignore the body`; `A body to compare can have up to 64 KB`; `The body to compare isn't valid JSON. Compare it exactly, or fix it.` | A rule's body to compare | Awaiting approval |
| `A rule can have up to 20 responses` | A rule's responses | Awaiting approval |
| `Enter a status from 200 to 599`; `Enter a latency from 0 to 30,000 milliseconds` | A response's status and latency | Awaiting approval |
| `A response can have up to 50 headers`; `A mocked response can't set cookies. Remove the Set-Cookie header.`; `"{header}" isn't a header name`; `The value of {header} can't have line breaks or more than 4,096 characters` | A response's headers ("A Set-Cookie header") | Awaiting approval |
| `A response's body can have up to 5 MB`; `The body isn't valid JSON. Check its brackets, quotes, and commas.` | A response's body ("Invalid JSON") | Awaiting approval |
| `A response's stored body is no longer there. Write the body again.` | Edit rule | Awaiting approval |
| `Someone else changed this mock set since you opened it. Its newer settings are shown; make your change again.` | Edit mock set, on a stale edit | Awaiting approval |
| `Someone else changed this rule since you opened it. Its newer values are shown; make your change again.` | Edit rule, on a stale edit ("Two people edit one rule") | Awaiting approval |
| `That mock set no longer exists. Someone else deleted it.`, `That rule no longer exists. Someone else deleted it.` | A change to a set or rule deleted meanwhile; also the toolbar's Data | Awaiting approval |
| `This browser has no workspace yet. Reload the page and try again.` | Data, when the browser has no workspace | Awaiting approval |

## 12. The toolbar's Data tool

Captures: `toolbar-data/orders-portal-data-*` (the set, latency, and requests), `toolbar-data/orders-portal-data-create-rule-*` (a failed call's detail and Create rule), `toolbar-states/panel-data-*` (no set, with New mock set), `toolbar-data/quotes-desk-data-refused-*` (refused beside the build's own service worker). The other refusals, the share link's source, and the WebSocket rows are shown by `e2e/mock-data.spec.ts` and `test/components/data-panel.test.ts`.

| Text | Where | Status |
| --- | --- | --- |
| `Data` / `The answers {application}'s API calls get in this view: its own network, or one of its mock sets.` | The panel's title and description | Awaiting approval |
| `Mock set` | The choice's legend | Awaiting approval |
| `None: the application's own network` / `Every call goes to its own address.` | The first option and its help | Awaiting approval |
| `{set}` / `{n} rule` or `{n} rules`, with ` · Default` | Each set and its help | Awaiting approval |
| `The application's default.` | Where the set came from: the application's default | Awaiting approval |
| `The saved preview's default.` / `The saved preview's default: None.` | From a saved preview's own default | Awaiting approval |
| `Your choice for this view.` | From the visitor's choice | Awaiting approval |
| `From the share link that opened this view. Choosing here applies your own choice instead.` / `The share link that opened this view chose None. Choosing here applies your own choice instead.` | From a share link | Awaiting approval |
| `The application has no default mock set, so calls go to their own addresses.` | With no set from anywhere | Awaiting approval |
| `{reason} The frame loaded without the mock set.` | When the set couldn't be made ready; the reasons are below | Awaiting approval |
| `The mock set no longer exists.`, `The mock set couldn't be fetched: the Frontend Registry answered {status}.`, `The mock set couldn't be fetched from the Frontend Registry.`, `The Frontend Registry's service worker didn't say the mock set was ready.` | The reasons | Awaiting approval |
| `Latency` / `Calls that go to their own addresses never wait. Kept in this browser for this view.` | The latency choice's legend and help | Awaiting approval |
| `Off` / `Mocked answers come at once.` | A latency option | Awaiting approval |
| `As recorded` / `Each mocked answer waits as long as its response was recorded taking, up to 10 seconds.` | A latency option | Awaiting approval |
| `Slow` / `Each mocked answer waits 2 seconds.` | A latency option | Awaiting approval |
| `Requests`, `Clear requests` | The requests section's heading and button | Awaiting approval |
| `The page's fetch, XHR, and event-stream calls since it loaded, newest first, up to 500, with what answered each. WebSockets aren't mocked yet. The list shows each WebSocket connection, never its messages.` | The requests section's note | Awaiting approval |
| `Filter requests`: `All`, `Mocked`, `Passed through`, `Not matched`, `Failed`, each with its count | The filters | Awaiting approval |
| `Requests` | The list's accessible name | Awaiting approval |
| `Mocked by rule {rule}` | A call a rule answered | Awaiting approval |
| `Passed through` | A call answered at its own address | Awaiting approval |
| `Not matched` | A call the set answered as not mocked | Awaiting approval |
| `Failed, couldn't connect or was blocked by CORS`, `Failed, {status}`, `Failed, no answer` | A call that failed at its own address | Awaiting approval |
| `{status} · {n} ms`; `No answer`, `Opaque` | A call's status and time; the status of a call with none, and of a no-cors call | Awaiting approval |
| `WebSocket`, `Failed. WebSockets aren't mocked yet.`, `Passed through. WebSockets aren't mocked yet.`, `Connecting`, `Open`, `Closed`, `Never opened` | A WebSocket connection's row | Awaiting approval |
| `No API calls since the page loaded.`, `No {outcome} calls.` | The list, empty | Awaiting approval |
| `Address`, `What answered`, `Status`, `Time` | A call's detail | Awaiting approval |
| `{summary}, response {n}` | What answered a mocked call | Awaiting approval |
| `Edit rule`, `Create rule` | A call's detail's actions; Edit rule opens the rule's form in a new tab | Awaiting approval |
| `Calls are listed while a mock set applies. A mock set answers {application}'s API calls with recorded or written responses, in this view and its screenshots.` | The requests section with no set | Awaiting approval |
| `Calls are listed while a mock set applies.` | The requests section when a refusal applies | Awaiting approval |
| `Calls are listed once the mock set applies.` | The requests section while the set isn't ready | Awaiting approval |
| `New mock set` | The requests section's button with no set; the form's accessible name | Awaiting approval |
| `Name` / `It's empty at first, and applies to this view of {application} once created.` | The New mock set form's field and help | Awaiting approval |
| `Create mock set`, `Cancel`, `The mock set was not created`, `Enter a name` | The New mock set form's buttons, alert, and error | Awaiting approval |
| `Manage mock sets` | The panel's link to the application's Mock sets section, in a new tab | Awaiting approval |
| `Create rule` / `Adds a rule to {set} that answers this call from the next one. Leave the status and body empty to add it needing a response, which answers nothing until one is written.` | The Create rule form's heading and note | Awaiting approval |
| `Method`, `Path` / `Name a part that changes with :name, such as /v1/accounts/:id, or end with * for the rest of the path.` | The form's fields | Awaiting approval |
| `Query` / `This call's: {query}`: `Exact: the same parameters and values`, `Ignore listed parameters`, `Ignore the query` | The form's query choice, for a call with a query | Awaiting approval |
| `Parameters to ignore` / `Names, separated by commas.` | The form's field | Awaiting approval |
| `Request body`: `Ignore the body`, `JSON-equal`, `Exact text` | The form's body choice, for a call with a body | Awaiting approval |
| `Status`, `Content type`, `Body` | The form's response fields | Awaiting approval |
| `Create rule`, `Cancel`, `Done` | The form's buttons, and after saving | Awaiting approval |
| `The rule was not created`; `Enter a path that starts with /, such as /v1/accounts/:id`; `Enter a status from 200 to 599`; `The body isn't valid JSON` | The form's alert and errors | Awaiting approval |
| `Added {method} {pattern} to {set}. The next call uses it.` / `Added {method} {pattern} to {set}, needing a response. It answers nothing until one is written on its page.` | After saving | Awaiting approval |
| `The choice couldn't be saved. Try again.`, `The mock sets couldn't be reached. Check your connection and try again.`, `The mock set couldn't be created. Try again.`, `The rule couldn't be created. Try again.` | Network errors | Awaiting approval |
| `The rule's body couldn't be fetched: the Frontend Registry answered {status}.` | A call's failure, when a rule's stored body can't be fetched | Awaiting approval |

### Where a mock set can't apply

Captures: `toolbar-data/quotes-desk-data-refused-*`; preview mode's: shown by `e2e/application-preview.spec.ts`.

| Text | Where | Status |
| --- | --- | --- |
| `Mock sets need HTTPS. Browsers allow the service worker they use only on pages served over HTTPS or from localhost.` | Data and preview mode's line, outside a secure context | Awaiting approval |
| `This browser doesn't allow service workers here, so mock sets can't apply.` | Without service workers | Awaiting approval |
| `Mock sets can't apply beside the application's own service worker for its build's path.` | Beside the build's own worker | Awaiting approval |
| `The Frontend Registry's service worker couldn't start in this browser, so the mock set isn't applied.` | When the worker fails to start | Awaiting approval |
| `Screenshots of the build still apply its default mock set.` | After each refusal in Data, and after the next entry | Awaiting approval |
| `The application registered its own service worker, so mock sets stop applying at the next load.` | Data, when the build registers its own worker while a set applies | Awaiting approval |
| `WebSockets aren't mocked yet.` | Data's requests note, and a WebSocket's detail | Awaiting approval |

## 13. The pill and the menu

Captures: `toolbar-data/orders-portal-data-pill-*` (the marker and its tooltip), `toolbar-states/menu-*`, `toolbar-states/panel-shortcuts-*`.

| Text | Where | Status |
| --- | --- | --- |
| `Data · Mock set: {set}` | The pill's Data button while a set applies: its tooltip and accessible name, with the key D | Awaiting approval |
| `Data` (D) | The menu's Runtime group, between Session and Settings; the Shortcuts row; Keyboard shortcuts | Awaiting approval |
| Search words: `mock`, `mocks`, `mock set`, `har`, `api`, `network`, `requests`, `fixtures`, `stub`, `latency` | The menu's search matches these for Data; "har" highlights Data, though Share also matches | Awaiting approval |

## 14. Preview mode's line

Captures: `toolbar-data/orders-portal-preview-mode-line-*`, for a real build; `15-application-preview-*`, `15-application-preview-saved-*`, for seeded builds.

| Text | Where | Status |
| --- | --- | --- |
| `Mock set: {set}. Change it with Data in full screen.` | The line above the browser window, while a set applies | Awaiting approval |
| `Mock set: {set}. {refusal}` | The line, when a refusal of section 12 applies | Awaiting approval |
| `Mock set: {set}. {reason} The frame loaded without it.` | The line, when the set couldn't be made ready | Awaiting approval |

## 15. Share links

Captures: `toolbar-data/orders-portal-share-*`. The notice is shown by `e2e/share.spec.ts`, "The set was deleted" and "Several notices".

| Text | Where | Status |
| --- | --- | --- |
| `Opening the link applies the mock set "{set}", whose rules aren't in the link, through a service worker it registers in the recipient's browser.` | Share, when a set applies and it's the dialog's first sentence | Awaiting approval |
| `It applies the mock set "{set}", whose rules aren't in the link, through a service worker it registers in the recipient's browser.` | Share, after the routing, theme, or preset sentence | Awaiting approval |
| `The shared mock set "{set}" no longer exists, so this view uses your own choice.` | The notice when a link's set was deleted; it combines with the others | Awaiting approval |

## 16. Changed text

| Text | Where | Captures | Status |
| --- | --- | --- | --- |
| `Removes the comment threads in your views, your share links, your choices of session presets and mock sets, and your display name, and shows the guided hints again. Replies you left in views others shared with you stay there.` | Reset workspace's description (changed: adds mock sets) | `15-applications-*` | Awaiting approval |
| `Removes the comment threads in your views, your share links, your choices of session presets and mock sets, and your display name, so links you shared stop working. Replies you left in views others shared with you stay there.` | Reset workspace's confirmation (changed: adds mock sets) | Shown by `e2e/workspaces.spec.ts` | Awaiting approval |
| `{text}, with the mock set {set}` | Every screenshot's text alternative when the capture applied a set, such as `Screenshot of {application} at commit {commit}, with the mock set {set}` and `Screenshot of {application}, {ref}, at commit {commit}, with the mock set {set}` | Not visible; read by assistive technology | Awaiting approval |

## As the specs quote them

The specs quote some of the text above with values filled in. Each comes from an entry above:

| As quoted | Entry |
| --- | --- |
| `4 API calls failed when this build loaded` | `{n} API calls failed when this build loaded` (section 2) |
| `Application default (Happy path)` | `Application default ({set})` (section 8) |
| `Data · Mock set: Happy path` | `Data · Mock set: {set}` (section 13) |
| `Mock set: Happy path` | `Mock set: {set}. Change it with Data in full screen.` (section 14) |
| `Mock set` | Data's choice (section 12), the overview's row (section 1), and the Previews column (section 8) |
| `None: the application's own network` | Data's first option (section 12) |
| `mock`, `mocks`, `HAR`, `API`, `network`, `requests`, `fixtures`, `latency` | The menu's search words (section 13) |

The specs also quote example data, not interface text: the set names "Happy path", "happy path", "Errors", and "New nav data", the preset "Admin user", the search bodies "open" and "closed", and the planted secrets "password", "hunter2", "test01", "token", "user", and a JWT.

## Questions for reviewers

These came up while assembling the list. None is changed, since the text awaits review anyway:
- **Periods:** `Use at most 60 characters` ends without a period on the set forms, and with one, `Use at most 60 characters.`, on Upload HAR.
- **Choose or type:** a host's error says "or choose this preview's own origin", but the field asks you to type `self`.
- **Steps:** the flow shows "Step 1 of 4" through "Step 4 of 4", then "Step 5 of 5" on the Data step, which appears only when the Profile reports APIs or test substitutes.
- **The Data step's upload:** its HAR file field is marked optional, and its confirmation has no "Required." help, unlike Upload HAR's.

## Not listed

- **Unchanged text.** Text that this change shows in a new place but doesn't change, such as Cancel, the status words, the shared components' Previous and Next, and the Share dialog's existing sentences, isn't listed.
- **Messages for developers.** Errors meant only for developers, such as `useData must be used inside the data provider`, and endpoint bodies the pages never show, such as `Expected a JSON object`, aren't listed.
- **The exported HAR file.** Its creator name and its entries' comments aren't interface text.
