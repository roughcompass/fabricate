// Runs once when a Next.js server instance starts, before it serves requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getConfig } = await import("./lib/config");
  // The hosted profile has no Git and no SQLite (Prototypes design.md, decision 4), so their checks load only in the full profile.
  if (getConfig().profile === "hosted") {
    console.log("[server] hosted profile: Prototypes only, without Git or SQLite");
    return;
  }
  const { verifyStartup } = await import("./lib/startup");
  await verifyStartup("server");
}
