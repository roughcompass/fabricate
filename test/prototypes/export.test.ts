import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { MOCK_DATA, mockPage } from "@/lib/prototypes/models/mock-fixtures";
import { type ExportedVersion, archiveName, projectArchive, projectFiles } from "@/lib/prototypes/export";
import { RUNTIME } from "@/lib/prototypes/render";
import { DEFAULT_SHELL } from "@/lib/prototypes/seed/defaults";

// prototypes/sharing-and-export spec: "A version downloads as a runnable project".

const PAGE: ExportedVersion = {
  prototypeName: "Exception-first queue",
  number: 4,
  scope: "page",
  title: "Urgent payments",
  navItem: "Approvals",
  code: mockPage("Exception-first queue"),
  data: MOCK_DATA,
  personas: [{ id: "per_aaaaaaaaaaaaaaaa", name: "Maya Lindqvist", role: "Treasury payments approver", organizationType: "", goals: ["Release payments"], context: "", constraints: [], distinction: null }],
  shell: DEFAULT_SHELL,
};

describe("project export", () => {
  it("names the archive after the prototype and version (Running a download)", () => {
    expect(archiveName("Exception-first queue", 4)).toBe("exception-first-queue-v4.zip");
    expect(archiveName("  ***  ", 1)).toBe("prototype-v1.zip");
  });

  it("pins the Salt and React versions DE FabLab renders with, and renders a page in its shell under Salt's provider", () => {
    const files = projectFiles(PAGE);
    const manifest = JSON.parse(files["package.json"]!);
    expect(manifest.dependencies).toMatchObject({ react: RUNTIME.packages.react, "@salt-ds/core": RUNTIME.packages["@salt-ds/core"], "@salt-ds/theme": RUNTIME.packages["@salt-ds/theme"], "@salt-ds/date-components": RUNTIME.packages["@salt-ds/date-components"] });
    expect(Object.values(manifest.dependencies).every((version) => /^\d+\.\d+\.\d+/.test(String(version)))).toBe(true);
    expect(files["src/main.tsx"]).toContain("<SaltProviderNext");
    expect(files["src/main.tsx"]).toContain(`current={"Approvals"}`);
    expect(files["src/main.tsx"]).toContain(`"name":"Maya Lindqvist"`);
    expect(files["src/main.tsx"]).toContain(`import "@salt-ds/theme/css/theme-next.css";`);
    expect(files["src/Prototype.tsx"]).toBe(PAGE.code);
    expect(files["src/data.ts"]).toBe(MOCK_DATA);
    expect(JSON.parse(files["src/shell.json"]!)).toEqual(DEFAULT_SHELL);
    expect(files["src/PageShell.tsx"]).toContain('import "./page-shell.css";');
    expect(files["README.md"]).toContain("npm install\nnpm run dev");
  });

  it("renders a component alone, without the shell", () => {
    const files = projectFiles({ ...PAGE, scope: "component", navItem: null });
    expect(files["src/PageShell.tsx"]).toBeUndefined();
    expect(files["src/main.tsx"]).not.toContain("PageShell");
    expect(files["src/main.tsx"]).toContain(`className="surface"`);
  });

  it("zips the project into one folder", () => {
    const entries = unzipSync(projectArchive(PAGE));
    expect(Object.keys(entries).every((name) => name.startsWith("exception-first-queue-v4/"))).toBe(true);
    expect(strFromU8(entries["exception-first-queue-v4/src/Prototype.tsx"]!)).toBe(PAGE.code);
  });

  // Installs from the npm registry, so it runs on request: FABRICATE_EXPORT_BUILD=1 npx vitest run test/prototypes/export.test.ts
  it.runIf(process.env.FABRICATE_EXPORT_BUILD === "1")(
    "unzips into tmp/, installs, typechecks, and builds",
    () => {
      const root = path.resolve("tmp", "export-build");
      fs.rmSync(root, { recursive: true, force: true });
      fs.mkdirSync(root, { recursive: true });
      for (const [name, bytes] of Object.entries(unzipSync(projectArchive(PAGE)))) {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes);
      }
      const project = path.join(root, "exception-first-queue-v4");
      execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: project, stdio: "pipe" });
      execFileSync("npm", ["run", "build"], { cwd: project, stdio: "pipe" });
      expect(fs.readdirSync(path.join(project, "dist", "assets")).some((file) => file.endsWith(".js"))).toBe(true);
    },
    600_000,
  );
});
