import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HelpScoutMcpConfig } from "./config.js";
import { HelpScoutClient } from "./helpscoutClient.js";
import { registerHelpScoutTools } from "./tools.js";

export interface CreateHelpScoutMcpServerOptions {
  config: HelpScoutMcpConfig;
  client?: HelpScoutClient;
}

export function createHelpScoutMcpServer(options: CreateHelpScoutMcpServerOptions): McpServer {
  const client =
    options.client ||
    new HelpScoutClient({
      appId: options.config.helpscoutAppId,
      appSecret: options.config.helpscoutAppSecret,
      apiToken: options.config.helpscoutApiToken,
      baseUrl: options.config.helpscoutApiBaseUrl
    });

  const server = new McpServer(
    {
      name: "helpscout-mcp",
      version: "0.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  registerHelpScoutTools({
    server,
    client,
    enableWrites: options.config.enableWrites
  });

  return server;
}

export function createSharedHelpScoutClient(config: HelpScoutMcpConfig): HelpScoutClient {
  return new HelpScoutClient({
    appId: config.helpscoutAppId,
    appSecret: config.helpscoutAppSecret,
    apiToken: config.helpscoutApiToken,
    baseUrl: config.helpscoutApiBaseUrl
  });
}
