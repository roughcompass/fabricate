// Builds the runtime that prototype frames load (design.md, decision 8):
//
//   node scripts/build-prototype-runtime.mjs
//
// `npm run dev`, `npm run build`, and the browser tests run it first. It
// writes public/prototype-runtime/<hash>/: vendor.js, which bundles React,
// every Salt package generated code may import, and AG Grid once, so each
// exists once per frame; a small wrapper module per import-map specifier; the
// render host, whose audit and capture code load only when used; Salt's
// theme CSS with theme-next.css and the fonts, bundled so no font comes from
// a third party; and the import map. The hash covers the packages' versions
// and the runtime's source, so a new build gets a new address and cached
// files never go stale. esbuild runs here, at build time, only.
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as esbuild from "esbuild";

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const require = createRequire(path.join(root, "package.json"));
const RUNTIME_SOURCE = path.join(root, "src", "prototypes", "runtime");
const OUTPUT = path.join(root, "public", "prototype-runtime");
const MANIFEST = path.join(root, "src", "lib", "prototypes", "runtime-manifest.json");
const ENTRIES = path.join(root, "tmp", "prototype-runtime-entries");
/** Sources outside the runtime directory that the in-frame `@deweb/portal` bundles; the hash covers them too. */
const PORTAL_SOURCES = ["src/demo/runtime/bus.ts", "src/demo/runtime/members/planted.ts", "src/demo/runtime/portal/types.ts"].map((file) => path.join(root, file));
/** The portal runtime interface (converge-templates-and-prototypes, design decision 5), built from the runtime's portal.ts rather than a package. */
const PORTAL = { specifier: "@deweb/portal", name: "deweb-portal" };

/** What generated code may import, and the wrapper module each resolves to. Keep in step with the Salt-only gate's allowlist. */
const MODULES = {
  react: "react",
  "react/jsx-runtime": "react-jsx-runtime",
  "@salt-ds/core": "salt-core",
  "@salt-ds/lab": "salt-lab",
  "@salt-ds/icons": "salt-icons",
  "@salt-ds/countries": "salt-countries",
  "@salt-ds/date-components": "salt-date-components",
  "ag-grid-react": "ag-grid-react",
  "ag-grid-community": "ag-grid-community",
};

/** Modules only the host imports. They aren't in the import map, so generated code can't reach them. */
const HOST_MODULES = {
  "react-dom/client": "react-dom-client",
  "@salt-ds/date-adapters/date-fns": "salt-date-adapters",
  "@salt-ds/styles": "salt-styles",
};

const SHARED = { ...MODULES, ...HOST_MODULES };

const PACKAGES = ["react", "react-dom", "@salt-ds/core", "@salt-ds/lab", "@salt-ds/icons", "@salt-ds/countries", "@salt-ds/date-components", "@salt-ds/date-adapters", "@salt-ds/styles", "@salt-ds/theme", "@salt-ds/ag-grid-theme", "ag-grid-react", "ag-grid-community", "date-fns", "axe-core", "html-to-image", "@fontsource/open-sans", "@fontsource/pt-mono"];

const version = (name) => JSON.parse(fs.readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")).version;

function sourceFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? sourceFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))
    .sort();
}

function runtimeHash() {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(Object.fromEntries(PACKAGES.map((name) => [name, version(name)]))));
  hash.update(fs.readFileSync(new URL(import.meta.url)));
  for (const file of [...sourceFiles(RUNTIME_SOURCE), ...PORTAL_SOURCES]) hash.update(path.relative(root, file)).update(fs.readFileSync(file));
  return hash.digest("hex").slice(0, 12);
}

const identifier = (name) => name.replace(/[^A-Za-z0-9]+(.)?/g, (_, next) => (next ?? "").toUpperCase());
const exportNames = (specifier) => Object.keys(require(specifier)).filter((name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name));

/**
 * Every shared module is bundled once, into vendor.js, so React, Salt's
 * providers and style injection, and AG Grid each exist once per frame.
 * Each specifier then resolves to a small wrapper that re-exports its
 * package's names from there.
 */
function writeEntries() {
  fs.rmSync(ENTRIES, { recursive: true, force: true });
  fs.mkdirSync(ENTRIES, { recursive: true });
  const write = (name, source) => {
    const file = path.join(ENTRIES, name);
    fs.writeFileSync(file, source);
    return file;
  };
  const shared = Object.keys(SHARED);
  write("vendor.mjs", [...shared.map((specifier) => `import * as ${identifier(specifier)} from ${JSON.stringify(specifier)};`), `export { ${shared.map(identifier).join(", ")} };`, ""].join("\n"));
  const fonts = ["300", "400", "400-italic", "500", "600", "700", "800"].map((weight) => `@import "@fontsource/open-sans/${weight}.css";`);
  write("runtime.css", [`@import "@salt-ds/theme/index.css";`, `@import "@salt-ds/theme/css/theme-next.css";`, ...fonts, `@import "@fontsource/pt-mono/400.css";`, `@import "@salt-ds/ag-grid-theme/salt-ag-theme.css";`, ""].join("\n"));
}

function wrapper(specifier) {
  const namespace = identifier(specifier);
  const names = exportNames(specifier);
  const fallback = specifier === "react" ? `${namespace}.default ?? ${namespace}` : namespace;
  return `import { ${namespace} } from "./vendor.js";\nexport default ${fallback};\nexport const { ${names.join(", ")} } = ${namespace};\n`;
}

/** Points the host's imports of shared modules at their wrappers, beside it. */
const sharedModules = {
  name: "shared-modules",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => (args.kind !== "entry-point" && SHARED[args.path] ? { path: `./${SHARED[args.path]}.js`, external: true } : undefined));
  },
};

const hash = runtimeHash();
const base = `/prototype-runtime/${hash}/`;
const directory = path.join(OUTPUT, hash);
const current = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : null;

if (current?.hash === hash && fs.existsSync(path.join(directory, "host.js"))) {
  console.log(`Prototype runtime ${hash} is up to date`);
} else {
  const started = performance.now();
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  writeEntries();
  const common = { absWorkingDir: root, bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, legalComments: "none", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning" };
  await esbuild.build({ ...common, entryPoints: { vendor: path.join(ENTRIES, "vendor.mjs") }, outdir: directory });
  await esbuild.build({
    ...common,
    entryPoints: { host: path.join(RUNTIME_SOURCE, "host.tsx"), [PORTAL.name]: path.join(RUNTIME_SOURCE, "portal.ts"), runtime: path.join(ENTRIES, "runtime.css") },
    outdir: directory,
    entryNames: "[name]",
    chunkNames: "[name]-[hash]",
    assetNames: "assets/[name]-[hash]",
    splitting: true,
    jsx: "automatic",
    loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
    tsconfig: path.join(root, "tsconfig.json"),
    plugins: [sharedModules],
  });
  for (const [specifier, name] of Object.entries(SHARED)) fs.writeFileSync(path.join(directory, `${name}.js`), wrapper(specifier));
  const manifest = {
    hash,
    base,
    importMap: { imports: Object.fromEntries([...Object.entries(MODULES), [PORTAL.specifier, PORTAL.name]].map(([specifier, name]) => [specifier, `${base}${name}.js`])) },
    host: `${base}host.js`,
    styles: [`${base}runtime.css`, `${base}host.css`],
    packages: Object.fromEntries(PACKAGES.map((name) => [name, version(name)])),
  };
  fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built prototype runtime ${hash} in ${((performance.now() - started) / 1000).toFixed(1)}s at ${path.relative(root, directory)}`);
}
