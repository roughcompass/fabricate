# Restore toolbar tools: fleet check

This records task 12.3 of `restore-toolbar-tools-and-branch-previews`. Two repositories of the seeded fleet were onboarded as applications: `fleet/mf-shell`, a Module Federation host, and `fleet/mf-admin`, the remote it names `mfAdmin`. Under the toolbar, Microfrontends then routed mf-shell's `mfAdmin` first to mf-admin's current build and then to a saved preview of one of mf-admin's branches. The screenshots are in [`restore-toolbar-tools-fleet/`](restore-toolbar-tools-fleet/), 1280 by 900 pixels.

**Run:** 2026-11-19, 21:55 to 22:15 Pacific time. The branch was `restore-toolbar-tools-and-branch-previews` at 46f2335, after the merge of both agents' work.

**Result:**
- mf-shell renders mf-admin's exposed module through routing, from mf-admin's current build of `main` and from its saved preview of `feature/admin-approvals`.
- Without routing, mf-shell's page stays empty, as it did before this change.
- Preview mode isn't routed.
- `mfBilling` still can't render: nothing in the Frontend Registry can stand in for it (see [Outcomes](#outcomes)).
- The check found one defect: a remote entry whose `import()` failed was shown as Loaded. It's now fixed, with a test (see [Defect found](#defect-found)).

## Setup

The app ran apart from every other server and database. Everything below was deleted afterward.

| Setting | Value |
| --- | --- |
| Data | A fresh directory, `tmp/fleet-check/` in the worktree, with its own database and repository storage, never `storage/` |
| Web | `next dev` on port 3700, building into `.next-fleetcheck` |
| Worker | `scripts/dev-worker.mjs`, at the default concurrency of 3 |
| Previews | On. Node 20.20.2, 22.23.5, and 24.22.0 from mise, as `fabricate/.env.previews` names them |
| Preview storage | `/private/tmp/fr-fleet-check/previews`, outside the checkout, since Yarn refuses to build under it |
| Remotes | Scratch clones of `fleet/mf-shell` and `fleet/mf-admin` under `/private/tmp/fr-fleet-check/sources/`, the only allowed root. The fleet itself wasn't changed. |
| Enrolled remotes | None in `previews.trustedSources`. Onboarding enrolled both |
| Package registry | The seeded fleet registry on `127.0.0.1:4873` that the fleet's `.npmrc` names |
| Browser | Chrome, driven by Playwright, as a first-time visitor who dismissed the guided hints |

The branch `feature/admin-approvals` was committed only in the scratch clone of mf-admin. It changes the Access tab's text from "Review roles and entitlements." to "Review roles, entitlements, and pending approvals.", so the rendered page shows which build it came from.

## Outcomes

| Repository | Commit | What it is | Build | Outcome |
| --- | --- | --- | --- | --- |
| `fleet/mf-admin`, `main` | `cccbc40` | Rspack, a Module Federation remote `mfAdmin` that exposes `./Admin` | Node 22.23.5, pnpm 11.21.0 | **Ready**, as the application mf-admin |
| `fleet/mf-shell`, `main` | `3b4eb13` | webpack, a Module Federation host that names `mfAdmin@http://127.0.0.1:9101/remoteEntry.js` and loads `mfBilling` by code | Node 20.20.2, npm | **Ready**, as the application mf-shell. As built, its page stays empty, since nothing listens on `127.0.0.1:9101` |
| mf-admin, `feature/admin-approvals` (scratch clone) | `94c8352` | The same remote, with the Access tab's text changed | Node 22.23.5, pnpm 11.21.0 | **Ready**, as mf-admin's saved preview `feature-admin-approvals` |

### Routing mf-shell's remotes

1. **As built** ([01](restore-toolbar-tools-fleet/01-mf-shell-as-built.jpg), [02](restore-toolbar-tools-fleet/02-microfrontends-as-built.jpg)). Microfrontends reads "mf-shell · 2 microfrontends":
   - `mfAdmin`, a Module Federation remote at `http://127.0.0.1:9101/remoteEntry.js`: **Failed to load**;
   - `mfBilling`, a Module Federation remote whose address code chooses: **Loaded by code**;
   - `remoteEntry.js`, found on the page at `http://127.0.0.1:9102/assets/remoteEntry.js`: **Failed to load**.

   The page is empty, because mf-shell's lazy `mfAdmin/Admin` fails before anything renders.
2. **Routed to mf-admin · main** ([03](restore-toolbar-tools-fleet/03-routed-to-mf-admin-main.jpg), [04](restore-toolbar-tools-fleet/04-mf-shell-with-mf-admin-main.jpg)).
   - The Version choice lists As built, mf-admin · main (`cccbc40bd8de`), and mf-admin · feature/admin-approvals (`94c8352fae3e`).
   - After Reload application, mf-shell renders its Operations shell, with Administration showing mf-admin's Access and Audit tabs and "Review roles and entitlements."
   - `mfAdmin` shows Routed, from `/previews/pvw_18qzv63waeojv4o7/remoteEntry.js`.
3. **Routed to mf-admin · feature/admin-approvals** ([05](restore-toolbar-tools-fleet/05-routed-to-saved-preview.jpg), [06](restore-toolbar-tools-fleet/06-mf-shell-with-saved-preview.jpg)). The Access tab now reads "Review roles, entitlements, and pending approvals.", and `mfAdmin` shows Routed to mf-admin · feature/admin-approvals · `94c8352fae3e`.
4. **Preview mode** ([07](restore-toolbar-tools-fleet/07-preview-mode-not-routed.jpg)). mf-shell's preview mode, in the same browser, loads `mfAdmin` as built, so its page stays empty. Routing reaches only the running application's view.

### Remotes that still can't render

- **`mfBilling`.** mf-shell loads it with `import("http://127.0.0.1:9102/assets/remoteEntry.js")`, which its Profile can't resolve. So Microfrontends offers it no Version choice and says "Loaded by code". `fleet/mf-billing` wasn't onboarded for this check. Its import fails, and mf-shell's Billing section stays empty.
- **The legacy portal.** It's an iframe of `http://127.0.0.1:9103`, not a microfrontend, so Microfrontends doesn't list it. It stays empty.

## Defect found

**A remote entry that failed to load through `import()` was shown as Loaded.** mf-shell's `mfBilling` is imported from `127.0.0.1:9102`, where nothing listens, and Microfrontends listed it as "Found on the page … Loaded".
- **Why:** the frame agent judged loading from Resource Timing. A failed `import()` records a status of 0 and leaves no element to report an error, just as a script tag's successful cross-origin load does.
- **Fix:** the agent now reads a page's unhandled rejection of a failed `import()`, which names the address in Chrome and Firefox, and reports that address as failed. A page that catches the rejection itself still shows Loaded, since nothing else in the page tells the two apart.
- **Test:** `test/components/microfrontend-members.test.ts`.

The run above is from after the fix. Before it, step 1 listed the found entry as Loaded.
