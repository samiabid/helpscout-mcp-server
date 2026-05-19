#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createHelpScoutMcpServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig(process.env, "stdio");
  const server = createHelpScoutMcpServer({ config });
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
