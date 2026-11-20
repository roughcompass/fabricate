import fs from "node:fs";
import path from "node:path";
import type { Repository } from "@/lib/repositories/repository-records";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import type { ArtifactLayout } from "@/lib/db/schema";
import type { PackageVerdict } from "@/lib/previews/eligibility";
import type { ArtifactEntry } from "@/lib/previews/output";
import { type PreviewBuild, findPreview, openPreparation, publishAttempt, startPreview } from "@/lib/previews/records";
import { previewDirectory } from "@/lib/previews/storage";
import { type DecideOptions, decide } from "./applications";

/*
 * Previews with published artifacts written straight into preview storage,
 * for serving and lifecycle tests that need no build.
 */

let commits = 0;

/** A queued preview of a new commit of +repository+, of a package of kind +layout+; +options.hooks+ false decides its commit without the applications' hooks, for a schema older than the code. */
export function queuedPreview(db: Db, repository: Repository, layout: ArtifactLayout = "standalone", options: DecideOptions = {}): PreviewBuild {
  const commitSha = (++commits).toString(16).padStart(40, "0");
  const { preparation } = openPreparation(db, repository, { commitSha, refName: "refs/heads/main", refKind: "branch" });
  const verdict: PackageVerdict = {
    directory: ".",
    manifest: "package.json",
    name: "orders",
    qualifies: true,
    conditions: [],
    plan: { installRoot: ".", packageManager: { name: "npm", version: null, lockfile: "package-lock.json" }, buildTool: "vite", buildScript: "vite build", node: { version: "22.11.0", ranges: [] }, layout, composition: null },
  };
  // Decided here, so its job has nothing left to do; only the build job is queued.
  decide(db, repository, preparation, [verdict], options);
  return startPreview(db, preparation.publicId, ".").preview;
}

/**
 * Publishes +files+ as +preview+'s current attempt's artifact, at
 * out/<attempt>-test, with +entry+, its index.html, not rebased by default.
 */
export function publishFiles(db: Db, config: FrontendRegistryConfig, preview: PreviewBuild, files: Record<string, string | Buffer>, entry: Partial<ArtifactEntry> = {}): PreviewBuild {
  const current = findPreview(db, preview.publicId)!;
  const directory = `out/${current.attempt}-test`;
  const root = path.join(previewDirectory(config, preview.publicId), directory);
  let bytes = 0;
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
    bytes += Buffer.byteLength(content);
  }
  const published = publishAttempt(db, preview.publicId, { attempt: current.attempt }, {
    directory,
    layout: "standalone",
    entry: { file: "index.html", rebase: false, ...entry },
    outputBytes: bytes,
    buildMs: 1_000,
    nodeVersion: "22.11.0",
    packageManager: "npm",
  });
  if (!published) throw new Error(`${preview.publicId} couldn't publish`);
  return findPreview(db, preview.publicId)!;
}
