#!/usr/bin/env node
import express, { type Request, type Response, type NextFunction, type Express } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type HelpScoutMcpConfig } from "./config.js";
import { createHelpScoutMcpServer, createSharedHelpScoutClient } from "./server.js";
import type { HelpScoutClient } from "./helpscoutClient.js";
import { OAuthProvider } from "./oauth.js";

export function createHttpApp(config: HelpScoutMcpConfig, client?: HelpScoutClient): Express {
  const app = createMcpExpressApp({ host: config.httpHost });
  app.use(express.urlencoded({ extended: false }));

  const sharedClient = client || createSharedHelpScoutClient(config);
  const oauth = config.oauthEnabled ? new OAuthProvider(config) : undefined;

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      name: "helpscout-mcp",
      transport: "streamable-http",
      writesEnabled: config.enableWrites
    });
  });

  if (oauth) {
    app.get("/.well-known/oauth-protected-resource", (req: Request, res: Response) => {
      res.json(oauth.protectedResourceMetadata(req));
    });
    app.get("/.well-known/oauth-protected-resource/mcp", (req: Request, res: Response) => {
      res.json(oauth.protectedResourceMetadata(req));
    });
    app.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
      res.json(oauth.authorizationServerMetadata(req));
    });
    app.get("/.well-known/openid-configuration", (req: Request, res: Response) => {
      res.json(oauth.authorizationServerMetadata(req));
    });
    app.post("/register", oauth.handleRegister);
    app.get("/authorize", oauth.handleAuthorizeGet);
    app.post("/authorize", oauth.handleAuthorizePost);
    app.post("/token", oauth.handleToken);
    app.use("/mcp", oauth.authenticateMcpRequest);
  } else {
    app.use("/mcp", requireBearerToken(config.httpToken));
  }

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createHelpScoutMcpServer({ config, client: sharedClient });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error"
          },
          id: null
        });
      }
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  app.delete("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    });
  });

  return app;
}

function requireBearerToken(expectedToken: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!expectedToken) {
      res.status(500).json({ error: "HTTP token is not configured." });
      return;
    }

    const header = req.header("authorization") || "";
    const token = header.match(/^Bearer\s+(.+)$/i)?.[1];

    if (token !== expectedToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };
}

async function main(): Promise<void> {
  const config = loadConfig(process.env, "http");
  const app = createHttpApp(config);

  app.listen(config.httpPort, config.httpHost, () => {
    console.error(`helpscout-mcp HTTP server listening on http://${config.httpHost}:${config.httpPort}/mcp`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
