// @salt-ds/mcp publishes its declarations under dist-types/ without naming
// them in package.json, so TypeScript is pointed at them here.
declare module "@salt-ds/mcp" {
  export * from "@salt-ds/mcp/dist-types/index";
}
