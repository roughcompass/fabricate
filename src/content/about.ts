import { PRODUCT } from "@/lib/product";

/*
 * The marketing page's copy (establish-frontend-registry, design decision
 * 14; product-site spec): one typed module, reviewed like code. Its sections
 * run in a fixed order, and each heading states its point, so the headings
 * alone tell the story. Every claim about what the Frontend Registry does
 * names the route that shows it, and test/content/about-claims.test.ts fails
 * when a claimed route doesn't exist in the running configuration, so the
 * Applications benefit shows only while previews are on. Changes
 * to this copy need DE product and design's approval before they ship
 * (task 10.11).
 */

/** Something the page says the Frontend Registry does, and the address where a reader sees it, with `:id` for any record's id. */
export interface Claim {
  readonly text: string;
  readonly route: string;
}

export interface Action {
  readonly label: string;
  readonly href: string;
}

/** Add your repository: the page's one ask, in the hero and the closing section. */
const ADD: Action = { label: "Add your repository", href: "/repositories/bulk" };
const DOCS: Action = { label: "Read the docs", href: "/docs" };

export const ABOUT = {
  /** How links to the page name it, such as Home's. */
  title: "About the Frontend Registry",
  description: `What the ${PRODUCT.name} is, why to use it, and how to start.`,

  hero: {
    // Decision 14 offers two headline directions; DE product and design choose one when they approve the copy.
    title: "Every CIB frontend repository and what it's built on, in one place",
    lead: `The ${PRODUCT.name} is the Digital Enablement team's official registry of CIB frontend applications.`,
    actions: [ADD, DOCS] as const,
    screenshot: {
      light: "/site/profile-light.jpg",
      dark: "/site/profile-dark.jpg",
      alt: "A repository's Profile in the Frontend Registry: its design-system facts, with the committed lines one of them came from.",
      width: 1280,
      height: 800,
    },
  },

  figures: {
    heading: "Teams already register their repositories here",
    labels: { repositories: "Repositories registered", profiled: "Repositories profiled", saltVersions: "Salt versions described" },
  },

  problem: {
    heading: "Today, every question about the fleet starts from scratch",
    intro: "Without one record of CIB's frontends, teams rebuild the same answers by hand, and each answer is out of date by the time it's shared.",
    items: [
      "Design-system teams search repositories one at a time to learn where their components are used.",
      "Platform teams send surveys asking each team which versions it uses, and wait for the replies.",
      "No one has a shared record of what each repository is built on, so each new question starts over.",
    ],
  },

  agents: {
    heading: "Your agent knows your repository; the Frontend Registry knows the fleet",
    intro: `Use your AI agent and code-intelligence tools for your own code. Use the ${PRODUCT.name} for questions about every repository, and point your agent at it.`,
    columns: { aspect: "", agent: "Your agent", registry: PRODUCT.name },
    rows: [
      { aspect: "Scope", agent: "The repository you have open, in one session", registry: { text: "Every registered CIB frontend repository", route: "/repositories" } },
      { aspect: "Results", agent: "An answer in a conversation, gone when it ends", registry: { text: "Stored, versioned Profiles, each fact with its evidence", route: "/repositories/:id/versions" } },
      { aspect: "Repeatability", agent: "A new answer each time you ask", registry: { text: "The same facts from the same commit, Surveyor release, and inputs", route: "/docs/concepts/profiles-and-recipes" } },
      { aspect: "Rules", agent: "The instructions in your prompt", registry: { text: "Versioned Standards, published as Releases", route: "/standards" } },
      { aspect: "Time", agent: "What the code says now", registry: { text: "Every survey kept, so you can see what changed", route: "/repositories/:id/versions" } },
    ] satisfies readonly { aspect: string; agent: string; registry: Claim }[],
  },

  howItWorks: {
    heading: "Four parts, each with one job",
    parts: [
      { name: PRODUCT.name, job: { text: "Keeps the record of every repository and decides when to survey it", route: "/repositories" } },
      { name: PRODUCT.surveyor, job: { text: "Reads one commit of a repository as data, and writes its facts with evidence", route: "/docs/concepts/four-parts" } },
      { name: PRODUCT.referenceCatalog, job: { text: "Describes each version of what repositories build on, starting with Salt", route: "/docs/concepts/reference-catalog" } },
      { name: PRODUCT.catalogBuilder, job: { text: "Writes those descriptions from what each design system publishes", route: "/docs/operate/catalog-builds" } },
    ] satisfies readonly { name: string; job: Claim }[],
    stepsHeading: "A survey in four steps",
    steps: [
      { text: "You register a repository, or it gets a new commit.", route: "/repositories/bulk" },
      { text: "The worker fetches that commit into its own copy, and never runs it.", route: "/docs/concepts/how-a-survey-runs" },
      { text: "Surveyor reads the commit and compares it with the Reference Catalog entry for each design system it uses.", route: "/docs/concepts/reference-catalog" },
      { text: "The Profile is stored with its recipe, and becomes the repository's current Profile.", route: "/repositories/:id" },
    ] satisfies readonly Claim[],
  },

  benefits: {
    heading: "Register once, and everyone who depends on your app gets an answer",
    intro: `Every CIB frontend repository must be registered in the ${PRODUCT.name}. Here's what that gives each of you.`,
    audiences: [
      { audience: "App owners", benefit: { text: "Add your repository once. It's surveyed again when its branch gets new commits, and its Profile stays current without a form to fill in.", route: "/repositories/bulk" } },
      { audience: "Product managers", benefit: { text: "Find any repository and read what it's built on, with the evidence, without asking its team.", route: "/repositories" } },
      { audience: "Design-system teams", benefit: { text: "See your design system's adoption across the fleet: which components are used, rarely used, or unused, the props passed to each, the raw HTML your components could replace, and the versions in use.", route: "/adoption/design-systems/:id" } },
      { audience: "Platform teams", benefit: { text: "Write Standards as Controls, and assess repositories against them, with a Finding for each one.", route: "/assessments/new" } },
    ] satisfies readonly { audience: string; benefit: Claim }[],
    // Applications exist only while previews are on (applications/onboarding spec), and so does this benefit.
    applications: {
      audience: "Reviewers",
      benefit: { text: "Open an application running, built from its branch and rebuilt as the branch moves, then comment on what you see or share a link to it.", route: "/applications" },
    } satisfies { audience: string; benefit: Claim },
  },

  trust: {
    heading: "You can check every fact yourself",
    claims: [
      { text: "Surveyor never runs your code, installs your dependencies, or builds your app, and it downloads nothing during a survey.", route: "/docs/concepts/how-a-survey-runs" },
      { text: "Every fact names the file and lines it came from, and the rule that read them.", route: "/profiles/:id/evidence/:id" },
      { text: "A Profile records its recipe, so surveying its commit again with that recipe gives the same facts.", route: "/docs/concepts/profiles-and-recipes" },
    ] satisfies readonly Claim[],
  },

  useWithAgent: {
    heading: "Your agent can read it too",
    claims: [
      { text: "Every docs page is also Markdown at its address followed by .md.", route: "/docs/get-started/add-your-repository" },
      { text: "/llms.txt indexes every docs page for agents.", route: "/llms.txt" },
      { text: "An AGENTS.md snippet puts that index in your agent's context.", route: "/docs/guides/use-with-your-agent" },
      { text: "Each repository's current Profile is JSON at /repositories/<id>/profile.json, with its digest.", route: "/repositories/:id/profile.json" },
    ] satisfies readonly Claim[],
    guide: { label: "Use the Frontend Registry with your agent", href: "/docs/guides/use-with-your-agent" },
  },

  questions: {
    heading: "Questions teams ask before they register",
    items: [
      { question: "Is registering required?", answer: { text: "Yes. Every CIB frontend repository is registered here, so the fleet's record is complete. Registering takes one clone URL.", route: "/repositories/bulk" } },
      { question: "Does Surveyor run or change my code?", answer: { text: "No. It reads committed files as data, in the worker's own copy of your repository, and never runs, builds, installs, or changes anything.", route: "/docs/concepts/how-a-survey-runs" } },
      { question: "Who can see my repository's facts?", answer: { text: `Everyone who can open the ${PRODUCT.name} can read every repository's Profile, so teams can learn from each other. It holds facts and the committed lines they came from, not copies of your code.`, route: "/repositories" } },
      { question: "What if a fact is wrong?", answer: { text: "Open its evidence to see what the file said at that commit. If the file has changed, choose Re-profile. If the reading is wrong, tell the Digital Enablement team, with the repository and the fact.", route: "/docs/guides/read-evidence" } },
    ] satisfies readonly { question: string; answer: Claim }[],
  },

  closing: {
    heading: "Add your repository",
    text: "It takes one clone URL, and its first Profile follows in the background.",
    action: ADD,
    links: [
      { label: "Read the docs", href: "/docs" },
      { label: "Add your repository, step by step", href: "/docs/get-started/add-your-repository" },
      { label: "The System page", href: "/admin/system" },
    ] satisfies readonly Action[],
  },
} as const;

/** The benefits by audience the page shows: Applications' only while applications are available. */
export function aboutBenefits(applications: boolean): readonly { audience: string; benefit: Claim }[] {
  return applications ? [...ABOUT.benefits.audiences, ABOUT.benefits.applications] : ABOUT.benefits.audiences;
}

/**
 * Every claim the page makes, with the route that shows it, while applications are or aren't available.
 * @public The claims test checks each route exists in the running configuration.
 */
export function aboutClaims(applications: boolean): Claim[] {
  return [
    ...ABOUT.agents.rows.map((row) => row.registry),
    ...ABOUT.howItWorks.parts.map((part) => part.job),
    ...ABOUT.howItWorks.steps,
    ...aboutBenefits(applications).map((item) => item.benefit),
    ...ABOUT.trust.claims,
    ...ABOUT.useWithAgent.claims,
    ...ABOUT.questions.items.map((item) => item.answer),
  ];
}

/**
 * Every address the page links to, which must exist as well.
 * @public The claims test checks them with the claims.
 */
export function aboutLinks(): string[] {
  return [...ABOUT.hero.actions.map((action) => action.href), ABOUT.useWithAgent.guide.href, ABOUT.closing.action.href, ...ABOUT.closing.links.map((link) => link.href)];
}
