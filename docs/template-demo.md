# Template demo

The template demo shows how a team could start an application from a pre-built solution: describe what they need or pick a template, preview it at a device's size, deploy it, and then inspect the running application with a Vercel-style toolbar. It runs inside DE FabLab, behind the `demo.enabled` setting (see [Configure DE FabLab](../README.md#template-demo)).

Everything in the demo is simulated. See [What is simulated](#what-is-simulated) before you present it.

## Before you present

1. Start DE FabLab with the demo on: `FABRICATE_DEMO=true npm run dev`, or use the hosted demo.
2. Open **Salt Patterns** in the sidebar. The gallery, "Salt Patterns", opens. The demo adds the **Salt Patterns** section for the templates, and shows your demo deployments among the registered Applications on **Applications**.
3. If you rehearsed in this browser, reset the demo first: select **Add application** in the gallery's header, then, on "Let's build something new", open **More actions** (⋯) and choose **Reset demo**.
4. Turn guided hints off, so they do not appear during the talk. Open any running application, for example a reference deployment from preview mode's **Open full screen**. Open the toolbar menu, choose **Settings**, and clear **Show guided hints**. The choice applies to your whole workspace.
5. Create a session profile for someone your audience knows, such as their head of payments. In the running application, press **P** to open **Session**, select **New profile**, and enter their name, the **Approver** persona, and their region. The profile is saved in your workspace and offered in every application, so you can sign it in during beat 10.
6. Use Chrome or Edge. Interaction timing uses the Event Timing API. Other browsers show approximate times, labeled as such.

The storyline is deterministic: templates, build stages, load order, audit results, and timings are the same on every run and in every workspace. Run `npx playwright test e2e/demo-storyline.spec.ts --repeat-each=3` to rehearse the whole flow automatically.

## The toolbar

Every running application shows the toolbar as a dark pill at the middle of the right edge. At rest it holds only the menu button. While a tool's panel is open, or comment mode is on, the pill also shows that tool's button; select it to close the tool. Hover over or focus a button to see its name and key.

The menu button opens the toolbar menu beside the pill:
- **What do you need?** Type to filter the tools by name or by words such as "a11y", "persona", or "theme". Use the arrow keys to move, Enter to open, and Esc to close.
- **The running application.** Its name, environment, and status. Select it to open the application's page in DE FabLab in a new tab.
- **Shortcuts.** One round button for each tool.
- **The tools, grouped.** Collaboration (Comment, Comments, Share), Inspect (Microfrontends, Accessibility, Timing), Runtime (Session, Settings), and More (Keyboard shortcuts, Hide toolbar).

Tool panels open to the left of the pill, and **Back to menu** in a panel's header returns to the menu. **Hide toolbar**, or **.**, shrinks the toolbar to a tab at the edge; select the tab or press **.** again to bring it back. Nothing on the page, and none of the toolbar's own outlines, labels, or hints, ever covers the toolbar.

## Presenter script

Each beat lists what to do, then the point to make.

1. **Salt Patterns.** Show the gallery: every template, with its preview, brand, and provider. Teams start from a template here, or from **Add application**, which registers a repository or a starter.
2. **Brands.** Choose **Payments** in the Brand filter. Templates are grouped by the portal brand they render in: Payments, Global Banking, and Other use J.P. Morgan Access; Markets uses J.P. Morgan Markets.
3. **Filter and search.** Add a provider filter, collapse a group, and select **Clear**. Search for "onboarding". Point out the count of selected options in each group heading.
4. **Template detail.** Open **Payments workspace**. Show its brand, portal, provider, and the microfrontends it is made of.
5. **Preview mode.** Select **Preview template**. Preview mode hides the sidebar to give the application the page; **Back to Payments workspace**, at the top left, returns to the template. Use the icons at the right of the tab row: the **Mobile**, **Tablet**, and **Desktop** devices, the **Landscape** toggle, and **Open full screen**. Hover over or focus any icon to see its name. The application inside the browser window lays out at the real device size, and the window shows the reference deployment's address. Open the **Code** tab and select `microfrontends.json`: the shell is the default application, and each child microfrontend owns a route or a slot. Copy the `npx` command above the tabs, which is how a developer would start locally.
6. **Deploy.** Select **Deploy template**. The note at the top of the form, **Deploys to DE Web Managed Hosting**, says where the application will run, whichever environment is chosen. Keep **Sandbox**, and select **Create application**. The simulated build log plays. Select **Skip build** to move on, then **Visit application**. The application opens in a new tab.
7. **Accessibility.** Press **A**, or open the toolbar menu and type "a11y", then **Run audit**. It reports no violations: every template is Salt that meets the [template quality bar](template-quality.md). This holds at every microfrontend version, in light and dark. Point out that the audit runs on the live page, so a team sees its own regressions here first.
8. **Swap a microfrontend.** Press **M**, choose **Payee list**, choose **2.0.0**, and select **Reload preview**. Version 1.4.2's compact table with icon actions becomes the table with text actions. Only that region reloads; anything typed in the transfer form stays. Back in the accessibility tool, the results are marked out of date. Select **Run audit again**: still no violations.
9. **Timing.** Select **Recalculate totals** in Payment activity, then press **T**. The waterfall shows the shell loading first and payment activity, the slowest load, flagged. The interaction is rated Good. Turn on **Hot spots** to tint the costliest region.
10. **Session.** Press **P** and sign in the profile you created for your audience, or **Sam Rivera**, an Approver: the shell shows them as the user, and Approve buttons appear in Payment activity. Each profile has a persona, which decides what microfrontends show, and a region.
11. **Settings.** Press **S**. Switch to the dark theme. In the Markets template, publish `instrument:selected` with `{"symbol": "GLBX"}` and watch the chart follow.
12. **Comment.** Press **C** and select **Send payment**. A "+" marks the spot. Type in **Start a new thread…**; select a word, choose **Aa**, then **Bold**. Post with the send button or Cmd+Enter. The pin stays on the button when the window is resized. A comment on a payee row, which belongs to a payee list version, is listed as not visible in this view after the payee list changes version, with **Go to comment** to bring that version back.
13. **Share.** Press **L**. Copy the link and open it in a private window: the recipient sees the same versions, theme, signed-in profile, and comment, and can reply. The profile isn't added to the recipient's own profiles, and their changes never affect your view.
14. **Reset.** Open **Add application**, choose **More actions**, then **Reset demo**. Your demo deployments, comments, share links, and session profiles are removed; registered Applications stay. The share link now answers not found.

To register a repository instead of deploying (beat 6), select **Add application** and paste its Bitbucket or GitHub URL into the prompt bar, which opens Create Application with it filled in ([applications.md](applications.md)).

### Toolbar shortcuts

| Key | Action |
| --- | --- |
| C | Start or stop comment mode |
| M | Open Microfrontends |
| A | Open Accessibility |
| T | Open Timing |
| P | Open Session |
| S | Open Settings |
| L | Open Share |
| . | Hide or show the toolbar |
| ? | Open Keyboard shortcuts |
| Esc | Close the menu or the open panel, or leave the current mode |

Shortcuts never fire while you are typing in a field. The menu's **Keyboard shortcuts** item opens **Preferences / Keyboard shortcuts**, which lists them and can turn single-key shortcuts off; Esc always works.

## Self-serve visitors

Visitors need no account. Each browser gets an anonymous workspace the first time it opens a demo page; it holds that visitor's applications, comments, share links, and session profiles, and nobody else can see them except through a share link. Comments on a template's reference deployment are private to the visitor's workspace until they share the view.

The first time a visitor opens the create page, Add application's "Let's build something new", and again the first time they open a running application, a short sequence of guided hints appears. In a running application, the hints open the toolbar menu and point to its Accessibility, Microfrontends, and Comment items. A visitor can dismiss the hints, replay them, or turn them off from the toolbar's **Settings**. Their choice is remembered for their workspace.

A workspace can hold 25 applications and 20 custom session profiles, and each comment can be up to 2,000 characters. Workspaces idle for 30 days are deleted.

## Hosting the demo

The demo is off in production. To host it for self-serve visitors, run the production image with `-e FABRICATE_DEMO=true`. To take it down, restart without the override: every demo page, running application, share link, and demo endpoint then answers not found, and nothing else in DE FabLab changes. The demo's tables are separate from catalog, assessment, evaluation, and standard data, so they can stay in the database or be dropped later.

Apply database migrations (`npm run db:migrate`) after updating DE FabLab. The demo adds its own migrations, such as `0014_demo_origin.sql`, which records whether an application came from a template or an import.

## Resetting

A visitor resets only their own workspace, from **More actions** on Add application. A reset removes the workspace's applications, comment threads, share links, and microfrontend overrides, and restores its guided hints. It never affects other visitors or the reference deployments.

## What is simulated

- **Builds and deployments.** Nothing is built or deployed. The build log is a script whose progress follows the clock, and application URLs are made up on the reserved `deweb.example` domain.
- **BitBucket.** The projects (PAY, GB, MKT, and OPS) and their repositories are fictional, and each repository is built from a catalog template. The demo never contacts BitBucket, GitHub, or GitLab; GitHub and GitLab are shown as unavailable.
- **The scaffold command.** `npx @deweb/create-app@latest my-app --template <slug>` is illustrative. The `@deweb/create-app` package does not exist, and DE FabLab never runs the command. The files in preview mode's Code tab are the real Salt source the template's reference deployment renders, with a `package.json` and `microfrontends.json` that describe the group.
- **Applications.** Microfrontends are real Salt components shipped with DE FabLab, written to the [template quality bar](template-quality.md) and built with `npm run templates:build`. Their data is fictional. The audit, timing, comments, and share links work on that content.
- **Portal shells.** The J.P. Morgan Access and J.P. Morgan Markets shells are illustrative, and all data in them is fictional. Each shows the J.P. Morgan logo, a typeset placeholder served from DE FabLab's own origin (`public/brand/jpmorgan-logo.svg`, and `jpmorgan-logo-dark.svg` for Salt's dark mode), followed by the portal name; it is not the official artwork, which replaces it when the brand team supplies it. Keep the demo internal.
- **A Portal's experience.** Opened with `?portal=<portal id>`, as the experience editor's Open running portal does, a running application renders that Portal's saved experience: its portal name, favicon, theme's shell, banner, header slots and toolkits, menu, and footer copyright. Without it, the shell renders the default experience for its brand. See [experience-editor.md](experience-editor.md#the-running-portal).

## Regenerating previews

Gallery cards show a screenshot of each template's reference deployment, committed under `public/demo/previews/`. After changing a shell or a microfrontend, regenerate them against a server with the demo on, then commit the images:

```sh
npm run dev:web
npx tsx scripts/capture-template-previews.mjs http://localhost:3000
```

The script opens each reference deployment as preview mode frames it (`?embed=1`, without the toolbar) at 1280 by 800 pixels. To refresh the review screenshots of every demo surface, run `npm run test:visual`; they are written to `verification/screenshots/demo/`, `portals/`, and `toolbar/`.
