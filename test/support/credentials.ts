import { manifest } from "./profiles";
import type { Tree } from "./preview-trees";

/*
 * Every form of credential a build's output might print, as npm, Yarn, Git,
 * and HTTP clients print them, each with the secret in it that no page or
 * route may show.
 */

export const PLANTED: readonly { readonly form: string; readonly line: string; readonly secret: string }[] = [
  { form: "a registry-scoped _authToken", line: "npm verb config //registry.example.com/:_authToken=npmTokenValue1111", secret: "npmTokenValue1111" },
  { form: "an _auth", line: "_auth=YmFzaWNBdXRoVmFsdWUy", secret: "YmFzaWNBdXRoVmFsdWUy" },
  { form: "an _password", line: "//registry.example.com/:_password=cGFzc3dvcmRWYWx1ZTM=", secret: "cGFzc3dvcmRWYWx1ZTM" },
  { form: "Yarn's npmAuthToken", line: 'npmAuthToken: "yarnTokenValue4444"', secret: "yarnTokenValue4444" },
  { form: "an Authorization: Bearer header", line: "> GET /orders HTTP/1.1\tAuthorization: Bearer bearerTokenValue5555", secret: "bearerTokenValue5555" },
  { form: "a Basic credential in JSON", line: '{"headers":{"authorization":"Basic YmFzaWNIZWFkZXI2Ng=="}}', secret: "YmFzaWNIZWFkZXI2Ng" },
  { form: "credentials in a URL", line: "fatal: unable to access 'https://deploy:urlTokenValue7777@git.example.com/acme/lib.git/'", secret: "urlTokenValue7777" },
  { form: "an npm token", line: "using token npm_abcdefghijklmnopqrstuvwxyz0123456789", secret: "npm_abcdefghijklmnopqrstuvwxyz0123456789" },
  { form: "a GitHub token", line: "error: ghp_ghpTokenValue0123456789AB was rejected", secret: "ghp_ghpTokenValue0123456789AB" },
  { form: "a GitHub fine-grained token", line: "GITHUB_TOKEN is github_pat_11ABCDEFG0123456789_abcdefghijklmnop", secret: "github_pat_11ABCDEFG0123456789_abcdefghijklmnop" },
  { form: "a token in the environment", line: "env NPM_TOKEN=envTokenValue8888 node build", secret: "envTokenValue8888" },
];

/**
 * +tree+ with a build that prints every planted credential, the first split
 * across two writes of its output, then fails, as a misconfigured install or
 * build might.
 */
export function leakingBuild(tree: Tree): Tree {
  const scripts = { build: "node leak.mjs" };
  const root = JSON.parse(tree["package.json"]!) as Record<string, unknown>;
  const lines = PLANTED.map((planted) => planted.line);
  return {
    ...tree,
    "package.json": manifest({ ...root, scripts: { ...(root.scripts as Record<string, string>), ...scripts } }),
    "leak.mjs": `const [first, ...rest] = ${JSON.stringify(lines)};
process.stdout.write(first.slice(0, 30));
await new Promise((resolve) => setTimeout(resolve, 50));
process.stdout.write(first.slice(30) + "\\n");
rest.forEach((line, index) => (index % 2 ? console.error : console.log)(line));
console.error("error: the build printed its credentials");
process.exit(1);
`,
  };
}
