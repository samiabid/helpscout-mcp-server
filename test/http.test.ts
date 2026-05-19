import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createHttpApp } from "../src/http.js";

describe("HTTP transport", () => {
  const servers: Array<{ close: (cb: () => void) => void }> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(resolve))));
    servers.length = 0;
  });

  it("requires Authorization: Bearer on /mcp", async () => {
    const app = createHttpApp(config());
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await onceListening(server);
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });

    expect(response.status).toBe(401);
  });

  it("exposes an unauthenticated health endpoint", async () => {
    const app = createHttpApp(config());
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await onceListening(server);
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      name: "helpscout-mcp",
      transport: "streamable-http"
    });
  });

  it("uses Railway's PORT and 0.0.0.0 defaults when running on Railway", () => {
    const railwayConfig = loadConfig(
      {
        HELPSCOUT_APP_ID: "app-id",
        HELPSCOUT_APP_SECRET: "app-secret",
        HELPSCOUT_MCP_HTTP_TOKEN: "test-http-token",
        RAILWAY_ENVIRONMENT: "production",
        PORT: "8123"
      },
      "http"
    );

    expect(railwayConfig.httpHost).toBe("0.0.0.0");
    expect(railwayConfig.httpPort).toBe(8123);
  });

  it("lists tools over authenticated Streamable HTTP", async () => {
    const app = createHttpApp(config());
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await onceListening(server);
    const { port } = server.address() as AddressInfo;

    const client = new Client({ name: "http-smoke-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: {
        headers: {
          Authorization: "Bearer test-http-token"
        }
      }
    });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.some((tool) => tool.name === "helpscout_list_inboxes")).toBe(true);
    } finally {
      await client.close().catch(() => undefined);
    }
  });

  it("serves Claude-compatible OAuth discovery documents", async () => {
    const app = createHttpApp(oauthConfig());
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await onceListening(server);
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const resourceResponse = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    const resource = await resourceResponse.json();
    expect(resource).toMatchObject({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: ["helpscout:read"]
    });

    const authResponse = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    const auth = await authResponse.json();
    expect(auth).toMatchObject({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true
    });
  });

  it("runs a complete OAuth flow and uses the access token for MCP", async () => {
    const app = createHttpApp(oauthConfig());
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await onceListening(server);
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;
    const redirectUri = `${baseUrl}/callback`;

    const registrationResponse = await fetch(`${baseUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude test client",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"]
      })
    });
    expect(registrationResponse.status).toBe(201);
    const registration = await registrationResponse.json() as { client_id: string };

    const verifier = "test-verifier-with-enough-entropy";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorizeBody = new URLSearchParams({
      response_type: "code",
      client_id: registration.client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "helpscout:read",
      state: "state_123",
      password: "test-oauth-password"
    });
    const authorizeResponse = await fetch(`${baseUrl}/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: authorizeBody,
      redirect: "manual"
    });
    expect(authorizeResponse.status).toBe(302);

    const location = authorizeResponse.headers.get("location");
    expect(location).toBeTruthy();
    const redirect = new URL(location || "");
    expect(redirect.searchParams.get("state")).toBe("state_123");
    const code = redirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenResponse = await fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: registration.client_id,
        redirect_uri: redirectUri,
        code: code || "",
        code_verifier: verifier
      })
    });
    expect(tokenResponse.status).toBe(200);
    const token = await tokenResponse.json() as { access_token: string; token_type: string; scope: string };
    expect(token.token_type).toBe("Bearer");
    expect(token.scope).toBe("helpscout:read");

    const client = new Client({ name: "oauth-http-smoke-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token.access_token}`
        }
      }
    });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.some((tool) => tool.name === "helpscout_whoami")).toBe(true);
    } finally {
      await client.close().catch(() => undefined);
    }
  });

  it("challenges unauthenticated OAuth MCP calls with protected-resource metadata", async () => {
    const app = createHttpApp(oauthConfig());
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await onceListening(server);
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `${baseUrl}/.well-known/oauth-protected-resource/mcp`
    );
  });
});

function config() {
  return loadConfig(
    {
      HELPSCOUT_APP_ID: "app-id",
      HELPSCOUT_APP_SECRET: "app-secret",
      HELPSCOUT_API_BASE_URL: "https://api.helpscout.test/v2",
      HELPSCOUT_MCP_HTTP_TOKEN: "test-http-token"
    },
    "http"
  );
}

function oauthConfig() {
  return loadConfig(
    {
      HELPSCOUT_APP_ID: "app-id",
      HELPSCOUT_APP_SECRET: "app-secret",
      HELPSCOUT_API_BASE_URL: "https://api.helpscout.test/v2",
      HELPSCOUT_MCP_OAUTH_ENABLED: "true",
      HELPSCOUT_MCP_OAUTH_SECRET: "test-oauth-secret",
      HELPSCOUT_MCP_OAUTH_PASSWORD: "test-oauth-password"
    },
    "http"
  );
}

function onceListening(server: { once: (event: "listening", cb: () => void) => void; listening?: boolean }) {
  if (server.listening) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => server.once("listening", resolve));
}
