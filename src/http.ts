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
  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false, limit: "256kb" }));

  const sharedClient = client || createSharedHelpScoutClient(config);
  const oauth = config.oauthEnabled ? new OAuthProvider(config) : undefined;
  const oauthLimiter = createRateLimiter({ max: 60, windowMs: 60_000 });
  const authorizeLimiter = createRateLimiter({ max: 10, windowMs: 60_000 });

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
    app.post("/register", oauthLimiter, oauth.handleRegister);
    app.get("/authorize", oauth.handleAuthorizeGet);
    app.post("/authorize", authorizeLimiter, oauth.handleAuthorizePost);
    app.post("/token", oauthLimiter, oauth.handleToken);
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

function createRateLimiter(options: { max: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    current.count += 1;

    if (current.count > options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res
        .status(429)
        .set("Retry-After", String(retryAfterSeconds))
        .json({ error: "rate_limited", error_description: "Too many authentication attempts." });
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
