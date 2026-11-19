import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const executionMessage =
  "Fabricate never executes, loads, or evaluates data. See design.md, decision 6.";

// Imports that can run code or start processes. child_process is allowed only
// in GitRunner, the single audited path to the Git executable, and in the
// preview build's process module, the one place Fabricate runs repository
// code, for remotes an operator enrolled (docs/previews.md).
const executionModules = ["vm", "node:vm", "module", "node:module"];
const processModules = ["child_process", "node:child_process"];

// Detection runs in the pinned @repo-facts bundle, whose own checks isolate
// it. Profile document validation here is held to the same isolation: no
// network, filesystem, process environment, Git, configuration, or database
// access (design.md, decision 7).
const isolationMessage = "Profile documents are validated as data only, with no ambient access. See design.md, decision 7.";
const isolatedModules = ["dns", "http", "http2", "https", "net", "tls", "dgram", "fs", "fs/promises", "worker_threads", "cluster", "inspector"].flatMap((name) => [name, `node:${name}`]);
const isolatedPatterns = ["@/lib/git/*", "@/lib/config", "@/lib/config/*", "@/lib/db/*", "@/lib/acquisition/*", "@/lib/jobs/*"];
const isolatedGlobals = ["fetch", "WebSocket", "XMLHttpRequest", "EventSource", "process"].map((name) => ({ name, message: isolationMessage }));

const restrictedImports = (modules, message) => ({
  paths: modules.map((name) => ({ name, message })),
});

const restrictedSyntax = [
  {
    selector: "ImportExpression[source.type!='Literal']",
    message: `import() with a computed specifier is forbidden. ${executionMessage}`,
  },
  {
    selector: "ImportExpression[source.value=/^(node:)?(vm|module|child_process)$/]",
    message: `Dynamic import of an execution module is forbidden. ${executionMessage}`,
  },
  {
    selector: "CallExpression[callee.name='require']",
    message: "require() is forbidden in application code; use static imports.",
  },
  {
    selector: "NewExpression[callee.name='RegExp'][arguments.0.type!='Literal']",
    message: `RegExp must be built from a literal pattern, never from data. ${executionMessage}`,
  },
  {
    selector: "CallExpression[callee.name='RegExp'][arguments.0.type!='Literal']",
    message: `RegExp must be built from a literal pattern, never from data. ${executionMessage}`,
  },
  {
    selector: "ExportNamedDeclaration VariableDeclarator[id.name='runtime'][init.value='edge']",
    message: "Server code runs on the Node.js runtime only.",
  },
];

// Record addresses are built in one module, so an address change lands in one place (prune-and-consolidate-code, design decision 8).
const recordLinks = {
  selector: "TemplateLiteral[quasis.0.value.raw=/^\\/(runs|standards|assessments|evaluations|profiles|repositories)\\//]",
  message: "Build record addresses with routes from @/lib/web/routes, not by hand.",
};

// Numbers and dates are formatted in time.ts and count.ts, so every page writes them alike (design decision 8).
const localeFormatting = [
  { selector: "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/]", message: "Format numbers and dates with count.ts or time.ts in @/components/ui." },
  { selector: "NewExpression[callee.object.name='Intl'][callee.property.name=/^(DateTimeFormat|NumberFormat)$/]", message: "Format numbers and dates with count.ts or time.ts in @/components/ui." },
];

// Server Action forms share one shell, which holds the action's state and moves focus after a refusal (design decision 7).
const actionState = {
  selector: "CallExpression[callee.name='useActionState']",
  message: "Render a Server Action's form with ActionForm from @/components/ui/form.",
};

const config = [
  {
    // src/demo/runtime/generated/ is the heroes' committed generated code, checked by test/lint/generated-heroes.test.ts.
    // public/prototype-runtime/ is local output the removed Prototypes left behind, until the operator deletes it; .gitignore keeps it out of Git.
    ignores: ["src/demo/runtime/generated/**", ".next/**", ".next-*/**", "dist/**", "public/prototype-runtime/**", ".swc/**", ".vercel/**", "node_modules/**", "storage/**", "tmp/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
  },
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...restrictedImports(executionModules, executionMessage).paths,
            ...restrictedImports(processModules, `Only GitRunner and the preview build's process module may start processes. ${executionMessage}`).paths,
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...restrictedSyntax, recordLinks, ...localeFormatting, actionState],
    },
  },
  {
    files: ["src/components/ui/action-form.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedSyntax, recordLinks, ...localeFormatting],
    },
  },
  {
    files: ["src/lib/web/routes.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedSyntax, ...localeFormatting, actionState],
    },
  },
  {
    // The template demo goes with add-applications; it formats its own timings.
    files: ["src/components/ui/time.ts", "src/components/ui/count.ts", "src/demo/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...restrictedSyntax, recordLinks, actionState],
    },
  },
  {
    // Pages and components read data through src/lib, never with Drizzle directly; naming a type is fine (design decision 8).
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            ...restrictedImports(executionModules, executionMessage).paths,
            ...restrictedImports(processModules, `Only GitRunner and the preview build's process module may start processes. ${executionMessage}`).paths,
            ...["drizzle-orm", "@/lib/db/schema"].map((name) => ({ name, message: "Read and write data through src/lib, not from a page or component.", allowTypeImports: true })),
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/profiles/schema.ts"],
    rules: {
      // The TypeScript variant allows naming a type from a restricted module;
      // type imports are erased and cannot reach the module at runtime.
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            ...restrictedImports(executionModules, executionMessage).paths,
            ...restrictedImports(processModules, `Only GitRunner and the preview build's process module may start processes. ${executionMessage}`).paths,
            ...restrictedImports(isolatedModules, isolationMessage).paths.map((entry) => ({ ...entry, allowTypeImports: true })),
          ],
          patterns: [{ group: isolatedPatterns, message: isolationMessage, allowTypeImports: true }],
        },
      ],
      "no-restricted-globals": ["error", ...isolatedGlobals],
    },
  },
  {
    // Tests set up databases through test/support (design decision 8); client.test.ts tests opening one.
    files: ["test/**/*.{ts,tsx}"],
    ignores: ["test/support/**", "test/db/client.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "@/lib/db/client", importNames: ["openDatabase", "migrateDatabase"], message: "Set up test databases with test/support/db.ts." }] },
      ],
    },
  },
  {
    // Specs set the theme and find the page header through e2e/support/shell.ts (design decision 8).
    // Specs run in Node and hold no React components, so a helper named use* isn't a hook.
    files: ["e2e/**/*.spec.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/fabricate-theme/]", message: "Set the theme with useTheme from e2e/support/shell.ts." },
        { selector: "Literal[value=/data-page-header/]", message: "Find the page header with pageHeader from e2e/support/shell.ts." },
      ],
    },
  },
  {
    // Design decision 8. The template demo and its toolbar go with add-applications.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/demo/**", "src/components/toolbar/**"],
    rules: {
      "max-lines-per-function": ["warn", { max: 150 }],
      "max-lines": ["error", { max: 600 }],
    },
  },
  {
    files: ["src/lib/git/runner.ts", "src/lib/previews/process.ts"],
    rules: {
      "no-restricted-imports": ["error", restrictedImports(executionModules, executionMessage)],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];

export default config;
