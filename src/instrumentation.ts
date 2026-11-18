// Runs once when a Next.js server instance starts, before it serves requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { verifyStartup } = await import("./lib/startup");
  await verifyStartup("server");
}
