# Template demo

The template demo shows how a team could start an application from a pre-built solution: describe what they need or pick a template, preview it at a device's size, deploy it, and then inspect the running application with a Vercel-style toolbar. It runs inside DE FabLab, behind the `demo.enabled` setting (see [Configure DE FabLab](../README.md#template-demo)).

Everything in the demo is simulated. See [What is simulated](#what-is-simulated) before you present it.

## Before you present

1. Start DE FabLab with the demo on: `FABRICATE_DEMO=true npm run dev:web`, or use the hosted demo.
2. Open **Salt Patterns** in the sidebar, then **New application**. The create page, "Let's build something new", opens. The demo adds two sections: **Applications**, for your applications and the BitBucket import, and **Salt Patterns**, for the templates.
3. If you rehearsed in this browser, reset the demo first: on the create page, open **More actions** (⋯) and choose **Reset demo**.
4. Turn guided hints off, so they do not appear during the talk. Open any running application, for example a reference deployment from preview mode's **Open full screen**. Open **Settings** in the toolbar and clear **Show guided hints**. The choice applies to your whole workspace.
5. Use Chrome or Edge. Interaction timing uses the Event Timing API. Other browsers show approximate times, labeled as such.

The storyline is deterministic: templates, build stages, load order, audit results, and timings are the same on every run and in every workspace. Run `npx playwright test e2e/demo-storyline.spec.ts --repeat-each=3` to rehearse the whole flow automatically.

## Presenter script

Each beat lists what to do, then the point to make.

1. **Create page.** Show the prompt bar, the quick-start chips, and **Build your solution**. Teams start from words, a pasted repository URL, or a template.
2. **Build your solution.** Keep **Payments** chosen, then select **Browse all**. The gallery, "Salt Patterns", opens with the Payments filter applied. Templates are grouped by the portal brand they render in: Payments, Global Banking, and Other use J.P. Morgan Access; Markets uses J.P. Morgan Markets.
3. **Filter and search.** Add a provider filter, collapse a group, and select **Clear**. Search for "onboarding". Point out the count of selected options in each group heading.
4. **Template detail.** Open **Payments workspace**. Show its brand, portal, provider, and the microfrontends it is made of.
5. **Preview mode.** Select **Preview template**. Switch between **Mobile**, **Tablet**, and **Desktop**, and turn the device to **Landscape**. The application inside the frame lays out at the real device size. Open the **Code** tab and select `microfrontends.json`: the shell is the default application, and each child microfrontend owns a route or a slot. Copy the `npx` command, which is how a developer would start locally.
6. **Deploy.** Select **Deploy template**, keep **Sandbox**, and select **Create application**. The simulated build log plays. Select **Skip build** to move on, then **Visit application**. The application opens in a new tab.
7. **Accessibility.** Press **A** or select the accessibility tool, then **Run audit**. The payee list's version 1.4.2 has planted defects: a search field without a label, faint text, and icon buttons without names. Select a result to scroll to it on the page.
8. **Swap a microfrontend.** Press **M**, choose **Payee list**, choose **2.0.0**, and select **Reload preview**. Only that region reloads; anything typed in the transfer form stays. Back in the accessibility tool, the results are marked out of date. Select **Run audit again**: no violations.
9. **Timing.** Select **Recalculate totals** in Payment activity, then press **T**. The waterfall shows the shell loading first and the slow payment activity flagged. The planted interaction is rated Poor. Turn on **Hot spots** to tint the costliest region.
10. **Settings.** Press **S**. Switch to the dark theme, and change the persona to **Sam Rivera · Approver**: Approve buttons appear in Payment activity. In the Markets template, publish `instrument:selected` with `{"symbol": "GLBX"}` and watch the chart follow.
11. **Comment.** Press **C** and select **Send payment**, then post a comment. The pin stays on the button when the window is resized. A comment on a payee row, which belongs to a payee list version, is listed as not visible in this view after the payee list changes version, with **Go to comment** to bring that version back.
12. **Share.** Press **L**. Copy the link and open it in a private window: the recipient sees the same versions, theme, and comment, and can reply. Their changes never affect your view.
13. **Reset.** Back on the create page, choose **More actions**, then **Reset demo**. Your applications, comments, and share links are removed. The share link now answers not found.

To import instead of deploying (beat 6), open **Applications** and select **Import from BitBucket**, pick the PAY project's **payee-hub** repository, and select **Import application**. You can also paste `https://bitbucket.deweb.example/projects/PAY/repos/payee-hub` into the create page's prompt bar, which opens the same import form.

### Toolbar shortcuts

| Key | Action |
| --- | --- |
| C | Start or stop comment mode |
| M | Open microfrontends |
| A | Open the accessibility audit |
| T | Open timing |
| S | Open settings |
| L | Open sharing |
| . | Collapse or show the toolbar |
| ? | Show keyboard shortcuts |
| Esc | Close the open panel or leave the current mode |

Shortcuts never fire while you are typing in a field. They can be turned off in the shortcuts panel; Esc always works.

## Self-serve visitors

Visitors need no account. Each browser gets an anonymous workspace the first time it opens a demo page; it holds that visitor's applications, comments, and share links, and nobody else can see them except through a share link. Comments on a template's reference deployment are private to the visitor's workspace until they share the view.

The first time a visitor opens the create page, and again the first time they open a running application, a short sequence of guided hints appears. A visitor can dismiss the hints, replay them, or turn them off from the toolbar's **Settings**. Their choice is remembered for their workspace.

A workspace can hold 25 applications, and each comment can be up to 2,000 characters. Workspaces idle for 30 days are deleted.

## Hosting the demo

The demo is off in production. To host it for self-serve visitors, run the production image with `-e FABRICATE_DEMO=true`. To take it down, restart without the override: every demo page, running application, share link, and demo endpoint then answers not found, and nothing else in DE FabLab changes. The demo's tables are separate from catalog, assessment, evaluation, and standard data, so they can stay in the database or be dropped later.

Apply database migrations (`npm run db:migrate`) after updating DE FabLab. The demo adds its own migrations, such as `0014_demo_origin.sql`, which records whether an application came from a template or an import.

## Resetting

A visitor resets only their own workspace, from **More actions** on the create page. A reset removes the workspace's applications, comment threads, share links, and microfrontend overrides, and restores its guided hints. It never affects other visitors or the reference deployments.

## What is simulated

- **Builds and deployments.** Nothing is built or deployed. The build log is a script whose progress follows the clock, and application URLs are made up on the reserved `deweb.example` domain.
- **BitBucket.** The projects (PAY, GB, MKT, and OPS) and their repositories are fictional, and each repository is built from a catalog template. The demo never contacts BitBucket, GitHub, or GitLab; GitHub and GitLab are shown as unavailable.
- **The scaffold command.** `npx @deweb/create-app@latest my-app --template <slug>` is illustrative. The `@deweb/create-app` package does not exist, and DE FabLab never runs the command. The files in preview mode's Code tab are generated from the catalog to show what a template would contain.
- **Applications.** Microfrontends are components shipped with DE FabLab, with deliberately planted accessibility defects and a deliberately slow interaction so the toolbar always has something real to find. The audit, timing, comments, and share links do work, on that content.
- **Portal shells.** The J.P. Morgan Access and J.P. Morgan Markets shells are illustrative. Their names appear as plain-text wordmarks only; no logos or other brand assets are copied, and all data in them is fictional. Keep the demo internal.

## Regenerating previews

Gallery cards show a screenshot of each template's reference deployment, committed under `public/demo/previews/`. After changing a shell or a microfrontend, regenerate them against a server with the demo on, then commit the images:

```sh
npm run dev:web
npx tsx scripts/capture-template-previews.mjs http://localhost:3000
```

The script opens each reference deployment as preview mode frames it (`?embed=1`, without the toolbar) at 1280 by 800 pixels. To refresh the review screenshots of every demo surface, run `npm run test:visual`; they are written to `verification/screenshots/demo/`, `portals/`, and `toolbar/`.
