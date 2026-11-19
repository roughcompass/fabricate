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

const config = [
  {
    // src/demo/runtime/generated/ is the heroes' committed generated code, checked by test/lint/generated-heroes.test.ts.
    // public/prototype-runtime/ and .workflow-data/ are local output the removed Prototypes left behind; .gitignore keeps them out of Git.
    ignores: ["src/demo/runtime/generated/**", ".next/**", ".next-*/**", "dist/**", "public/prototype-runtime/**", ".workflow-data/**", ".swc/**", ".vercel/**", "node_modules/**", "storage/**", "tmp/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
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
      "no-restricted-syntax": ["error", ...restrictedSyntax],
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
