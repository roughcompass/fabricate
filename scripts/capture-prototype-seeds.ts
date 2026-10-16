// Captures the seeded workspace every visitor's Prototypes starts as
// (Prototypes design.md, decision 12):
//
//   npx tsx scripts/capture-prototype-seeds.ts
//
// It runs the rehearsal (src/lib/prototypes/seed/rehearsal.ts) through the
// real pipeline and AI Gateway, in-process, on an in-memory Prototypes store,
// so it never touches storage/prototypes-pglite or a running dev server.
// Then it writes the workspace to src/lib/prototypes/seed/seed.json and
// prints how long each variant and stage took. It reads AI_GATEWAY_API_KEY or
// VERCEL_OIDC_TOKEN from the environment or .env.local, and costs one
// workspace's worth of generations, about 20 variants with their reviews.
import fs from "node:fs";
import path from "node:path";
import { getConfig, setConfig, withOverrides } from "@/lib/config";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { migratePrototypesDatabase, openPrototypesDatabase, setPrototypesDb } from "@/lib/prototypes/db/client";
import { variants } from "@/lib/prototypes/db/schema";
import { generationConfigured } from "@/lib/prototypes/models";
import { SEED_FILE } from "@/lib/prototypes/seed/import";
import { rehearse } from "@/lib/prototypes/seed/rehearsal";
import { exportWorkspaceSeed } from "@/lib/prototypes/seed/workspace-seed";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";

for (const file of [".env.local", ".env"]) if (fs.existsSync(file)) process.loadEnvFile(file);

// The rehearsal starts from the defaults, runs inline, and isn't bounded by a visitor's daily limit.
setConfig(withOverrides(getConfig(), { prototypes: { examples: false, runner: "inline", dailyVariantLimit: 500 } }));
const settings = getConfig().prototypes;
if (!generationConfigured(settings)) {
  console.error("No AI Gateway credential: set AI_GATEWAY_API_KEY, or run `vercel env pull` for VERCEL_OIDC_TOKEN.");
  process.exit(1);
}

const connection = await openPrototypesDatabase({ kind: "memory" });
await migratePrototypesDatabase(connection);
await setPrototypesDb(connection);
const { db } = connection;
const workspace = await ensurePrototypesWorkspace(db, newWorkspaceKey());

// Stage changes, sampled every half second, give each variant's time per stage.
const stages = new Map<string, { stage: string; at: number }[]>();
const sample = setInterval(async () => {
  for (const row of await db.select({ id: variants.id, stage: variants.stage, status: variants.status }).from(variants)) {
    const seen = stages.get(row.id) ?? [];
    const now = row.status === "running" ? row.stage : row.status;
    if (seen.at(-1)?.stage !== now) stages.set(row.id, [...seen, { stage: now, at: Date.now() }]);
  }
}, 500);

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;
try {
  await rehearse(db, workspace.id, settings, (message) => console.log(`[${elapsed()}] ${message}`));
} finally {
  clearInterval(sample);
}

const seed = await exportWorkspaceSeed(db, workspace.id);
fs.writeFileSync(SEED_FILE, `${JSON.stringify(seed)}\n`);
console.log(`\nWrote ${path.relative(process.cwd(), SEED_FILE)} (${(fs.statSync(SEED_FILE).size / 1024).toFixed(0)} KB) in ${elapsed()}: ${seed.prototypes.length} prototypes, ${seed.versions.length} versions, ${seed.generations.length} generations, ${seed.lessons.length} lessons.`);

// Time per variant and per stage, from the first stage seen to its end.
const totals = new Map<string, number[]>();
const perVariant: number[] = [];
for (const changes of stages.values()) {
  const last = changes.at(-1);
  if (!last || (last.stage !== "ready" && last.stage !== "failed")) continue;
  perVariant.push(last.at - changes[0]!.at);
  for (const [index, change] of changes.slice(0, -1).entries()) totals.set(change.stage, [...(totals.get(change.stage) ?? []), changes[index + 1]!.at - change.at]);
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const seconds = (ms: number) => `${(ms / 1000).toFixed(0)} s`;
console.log(`\nVariants: ${perVariant.length}, median ${seconds(median(perVariant))}, longest ${seconds(Math.max(0, ...perVariant))}`);
for (const [stage, values] of totals) console.log(`  ${stage.padEnd(10)} median ${seconds(median(values))}, longest ${seconds(Math.max(...values))} (${values.length})`);
const failed = seed.variants.filter((variant) => variant.status === "failed");
if (failed.length) console.log(`\n${failed.length} variants failed: ${failed.map((variant) => variant.failure?.message).join(" | ")}`);
await connection.close();
