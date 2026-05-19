import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { HelpScoutMcpConfig } from "./config.js";

const READ_SCOPE = "helpscout:read";
const WRITE_SCOPE = "helpscout:write";
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const AUTH_CODE_TTL_SECONDS = 60 * 10;

const WRITE_TOOLS = new Set([
  "helpscout_create_draft_reply",
  "helpscout_create_note",
  "helpscout_patch_conversation",
  "helpscout_set_conversation_tags",
  "helpscout_update_custom_fields"
]);

interface RegisteredClient {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
  issuedAt: number;
}

interface ClientMetadata {
  client_id?: string;
  client_name?: string;
  redirect_uris?: string[];
}

interface TokenPayload {
  typ: "code" | "access" | "refresh";
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  scope: string;
  client_id: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

interface AuthorizationRequest {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope?: string;
  state?: string;
}

export class OAuthProvider {
  private readonly clients = new Map<string, RegisteredClient>();
  private readonly usedCodes = new Set<string>();

  constructor(private readonly config: HelpScoutMcpConfig) {}

  protectedResourceMetadata(req: Request): Record<string, unknown> {
    return {
      resource: this.mcpUrl(req),
      authorization_servers: [this.baseUrl(req)],
      bearer_methods_supported: ["header"],
      scopes_supported: this.supportedScopes()
    };
  }

  authorizationServerMetadata(req: Request): Record<string, unknown> {
    const baseUrl = this.baseUrl(req);
    return {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      scopes_supported: this.supportedScopes(),
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true
    };
  }

  handleRegister = (req: Request, res: Response): void => {
    const redirectUris = readStringArray(req.body?.redirect_uris);
    if (redirectUris.length === 0) {
      res.status(400).json({ error: "invalid_client_metadata", error_description: "redirect_uris is required" });
      return;
    }

    const clientId = `client_${randomBytes(16).toString("hex")}`;
    const client: RegisteredClient = {
      clientId,
      redirectUris,
      clientName: typeof req.body?.client_name === "string" ? req.body.client_name : undefined,
      issuedAt: Math.floor(Date.now() / 1000)
    };
    this.clients.set(clientId, client);

    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: client.issuedAt,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: this.supportedScopes().join(" ")
    });
  };

  handleAuthorizeGet = async (req: Request, res: Response): Promise<void> => {
    const authorization = await this.parseAuthorizationRequest(req, res);
    if (!authorization) {
      return;
    }

    res.type("html").send(this.renderAuthorizePage(req, authorization));
  };

  handleAuthorizePost = async (req: Request, res: Response): Promise<void> => {
    const authorization = await this.parseAuthorizationRequest(req, res);
    if (!authorization) {
      return;
    }

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!this.passwordMatches(password)) {
      res.status(401).type("html").send(this.renderAuthorizePage(req, authorization, "Incorrect password."));
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const scope = this.normalizeScope(authorization.scope);
    const code = this.signPayload({
      typ: "code",
      iss: this.baseUrl(req),
      aud: this.mcpUrl(req),
      sub: "helpscout-mcp-user",
      exp: now + AUTH_CODE_TTL_SECONDS,
      iat: now,
      scope,
      client_id: authorization.client_id,
      redirect_uri: authorization.redirect_uri,
      code_challenge: authorization.code_challenge,
      code_challenge_method: authorization.code_challenge_method
    });

    const redirectUrl = new URL(authorization.redirect_uri);
    redirectUrl.searchParams.set("code", code);
    if (authorization.state) {
      redirectUrl.searchParams.set("state", authorization.state);
    }

    res.redirect(redirectUrl.toString());
  };

  handleToken = (req: Request, res: Response): void => {
    const grantType = req.body?.grant_type;

    if (grantType === "authorization_code") {
      this.exchangeAuthorizationCode(req, res);
      return;
    }

    if (grantType === "refresh_token") {
      this.refreshAccessToken(req, res);
      return;
    }

    res.status(400).json({ error: "unsupported_grant_type" });
  };

  authenticateMcpRequest = (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearer(req);

    if (token && this.config.httpToken && token === this.config.httpToken) {
      next();
      return;
    }

    const validation = token ? this.verifyPayload(token, "access", req) : undefined;
    if (!validation) {
      this.challenge(res, req, 401, "invalid_token", "Authentication required", READ_SCOPE);
      return;
    }

    const scopes = new Set(validation.scope.split(/\s+/).filter(Boolean));
    if (!scopes.has(READ_SCOPE)) {
      this.challenge(res, req, 403, "insufficient_scope", "Read scope required", READ_SCOPE);
      return;
    }

    if (this.config.enableWrites && callsWriteTool(req.body) && !scopes.has(WRITE_SCOPE)) {
      this.challenge(res, req, 403, "insufficient_scope", "Write scope required", WRITE_SCOPE);
      return;
    }

    next();
  };

  private exchangeAuthorizationCode(req: Request, res: Response): void {
    const code = readString(req.body?.code);
    const clientId = readString(req.body?.client_id);
    const redirectUri = readString(req.body?.redirect_uri);
    const codeVerifier = readString(req.body?.code_verifier);

    if (!code || !clientId || !redirectUri || !codeVerifier) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    if (this.usedCodes.has(code)) {
      res.status(400).json({ error: "invalid_grant", error_description: "Authorization code was already used" });
      return;
    }

    const payload = this.verifyPayload(code, "code", req);
    if (!payload || payload.client_id !== clientId || payload.redirect_uri !== redirectUri) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    if (!verifyPkce(codeVerifier, payload.code_challenge || "")) {
      res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
      return;
    }

    this.usedCodes.add(code);
    this.issueTokens(req, res, clientId, payload.scope);
  }

  private refreshAccessToken(req: Request, res: Response): void {
    const refreshToken = readString(req.body?.refresh_token);
    const clientId = readString(req.body?.client_id);

    if (!refreshToken || !clientId) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const payload = this.verifyPayload(refreshToken, "refresh", req);
    if (!payload || payload.client_id !== clientId) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    this.issueTokens(req, res, clientId, payload.scope);
  }

  private issueTokens(req: Request, res: Response, clientId: string, scope: string): void {
    const now = Math.floor(Date.now() / 1000);
    const common = {
      iss: this.baseUrl(req),
      aud: this.mcpUrl(req),
      sub: "helpscout-mcp-user",
      iat: now,
      scope,
      client_id: clientId
    };

    const accessToken = this.signPayload({
      ...common,
      typ: "access",
      exp: now + ACCESS_TOKEN_TTL_SECONDS
    });
    const refreshToken = this.signPayload({
      ...common,
      typ: "refresh",
      exp: now + REFRESH_TOKEN_TTL_SECONDS
    });

    res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope
    });
  }

  private async parseAuthorizationRequest(req: Request, res: Response): Promise<AuthorizationRequest | undefined> {
    const source = req.method === "POST" ? req.body : req.query;
    const authorization: AuthorizationRequest = {
      response_type: readString(source.response_type) || "",
      client_id: readString(source.client_id) || "",
      redirect_uri: readString(source.redirect_uri) || "",
      code_challenge: readString(source.code_challenge) || "",
      code_challenge_method: readString(source.code_challenge_method) || "",
      scope: readString(source.scope),
      state: readString(source.state)
    };

    if (
      authorization.response_type !== "code" ||
      !authorization.client_id ||
      !authorization.redirect_uri ||
      !authorization.code_challenge ||
      authorization.code_challenge_method !== "S256"
    ) {
      res.status(400).json({ error: "invalid_request" });
      return undefined;
    }

    if (!(await this.redirectUriAllowed(authorization.client_id, authorization.redirect_uri))) {
      res.status(400).json({ error: "invalid_request", error_description: "redirect_uri is not allowed" });
      return undefined;
    }

    return authorization;
  }

  private async redirectUriAllowed(clientId: string, redirectUri: string): Promise<boolean> {
    const registered = this.clients.get(clientId);
    if (registered) {
      return registered.redirectUris.some((candidate) => redirectUriMatches(candidate, redirectUri));
    }

    if (!clientId.startsWith("https://")) {
      return false;
    }

    try {
      const response = await fetch(clientId, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) {
        return false;
      }

      const metadata = (await response.json()) as ClientMetadata;
      if (metadata.client_id !== clientId || !Array.isArray(metadata.redirect_uris)) {
        return false;
      }

      return metadata.redirect_uris.some((candidate) => redirectUriMatches(candidate, redirectUri));
    } catch {
      return false;
    }
  }

  private normalizeScope(scope: string | undefined): string {
    const supported = new Set(this.supportedScopes());
    const requested = (scope || this.supportedScopes().join(" "))
      .split(/\s+/)
      .filter((candidate) => supported.has(candidate));

    if (!requested.includes(READ_SCOPE)) {
      requested.unshift(READ_SCOPE);
    }

    return [...new Set(requested)].join(" ");
  }

  private supportedScopes(): string[] {
    return this.config.enableWrites ? [READ_SCOPE, WRITE_SCOPE] : [READ_SCOPE];
  }

  private challenge(
    res: Response,
    req: Request,
    status: 401 | 403,
    error: "invalid_token" | "insufficient_scope",
    description: string,
    scope: string
  ): void {
    const authenticate =
      `Bearer error="${error}", ` +
      `error_description="${escapeHeader(description)}", ` +
      `resource_metadata="${this.baseUrl(req)}/.well-known/oauth-protected-resource/mcp", ` +
      `scope="${scope}"`;

    res
      .status(status)
      .set("WWW-Authenticate", authenticate)
      .json({ error, error_description: description });
  }

  private renderAuthorizePage(
    req: Request,
    authorization: AuthorizationRequest,
    error?: string
  ): string {
    const clientHost = safeHost(authorization.client_id);
    const scope = this.normalizeScope(authorization.scope);
    const hiddenFields = Object.entries(authorization)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(String(value))}">`)
      .join("\n");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize HelpScout MCP</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f6f7f9; color: #17202a; }
      main { max-width: 560px; margin: 8vh auto; background: white; border: 1px solid #d8dee4; border-radius: 8px; padding: 28px; }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { line-height: 1.5; }
      label { display: block; font-weight: 600; margin: 20px 0 8px; }
      input[type="password"] { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #b7c0ca; border-radius: 6px; font-size: 16px; }
      button { margin-top: 20px; border: 0; border-radius: 6px; padding: 10px 14px; background: #2563eb; color: white; font-weight: 700; cursor: pointer; }
      .meta { background: #f2f5f8; border-radius: 6px; padding: 12px; font-size: 14px; }
      .error { color: #b42318; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>Authorize HelpScout MCP</h1>
      <p>Claude is requesting access to this private HelpScout MCP server.</p>
      <div class="meta">
        <div><strong>Client:</strong> ${escapeHtml(clientHost)}</div>
        <div><strong>Resource:</strong> ${escapeHtml(this.mcpUrl(req))}</div>
        <div><strong>Scopes:</strong> ${escapeHtml(scope)}</div>
      </div>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <form method="post" action="/authorize">
        ${hiddenFields}
        <label for="password">Connector password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus>
        <button type="submit">Authorize</button>
      </form>
    </main>
  </body>
</html>`;
  }

  private passwordMatches(value: string): boolean {
    const expected = this.config.oauthPassword || "";
    const actualBuffer = Buffer.from(value);
    const expectedBuffer = Buffer.from(expected);

    if (actualBuffer.byteLength !== expectedBuffer.byteLength) {
      return false;
    }

    return timingSafeEqual(actualBuffer, expectedBuffer);
  }

  private signPayload(payload: TokenPayload): string {
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = createHmac("sha256", this.secret()).update(encodedPayload).digest("base64url");
    return `${encodedPayload}.${signature}`;
  }

  private verifyPayload(token: string, expectedType: TokenPayload["typ"], req: Request): TokenPayload | undefined {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
      return undefined;
    }

    const expectedSignature = createHmac("sha256", this.secret()).update(encodedPayload).digest("base64url");
    if (!safeEqual(signature, expectedSignature)) {
      return undefined;
    }

    try {
      const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as TokenPayload;
      const now = Math.floor(Date.now() / 1000);
      if (
        payload.typ !== expectedType ||
        payload.exp <= now ||
        payload.iss !== this.baseUrl(req) ||
        payload.aud !== this.mcpUrl(req)
      ) {
        return undefined;
      }

      return payload;
    } catch {
      return undefined;
    }
  }

  private mcpUrl(req: Request): string {
    return `${this.baseUrl(req)}/mcp`;
  }

  private baseUrl(req: Request): string {
    if (this.config.oauthPublicUrl) {
      return this.config.oauthPublicUrl;
    }

    const proto = req.header("x-forwarded-proto") || req.protocol || "https";
    const host = req.header("x-forwarded-host") || req.header("host");
    if (!host) {
      return `http://${this.config.httpHost}:${this.config.httpPort}`;
    }

    return `${proto.split(",")[0]}://${host.split(",")[0]}`.replace(/\/+$/, "");
  }

  private secret(): string {
    return this.config.oauthSecret || this.config.httpToken || "helpscout-mcp-dev-secret";
  }
}

function callsWriteTool(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];

  for (const message of messages) {
    if (!isRecord(message) || message.method !== "tools/call") {
      continue;
    }

    const params = message.params;
    if (isRecord(params) && typeof params.name === "string" && WRITE_TOOLS.has(params.name)) {
      return true;
    }
  }

  return false;
}

function verifyPkce(verifier: string, challenge: string): boolean {
  const hashedVerifier = createHash("sha256").update(verifier).digest("base64url");
  return safeEqual(hashedVerifier, challenge);
}

function redirectUriMatches(registered: string, requested: string): boolean {
  try {
    const registeredUrl = new URL(registered);
    const requestedUrl = new URL(requested);

    if (isLoopback(registeredUrl) && isLoopback(requestedUrl)) {
      return (
        registeredUrl.protocol === requestedUrl.protocol &&
        registeredUrl.hostname === requestedUrl.hostname &&
        registeredUrl.pathname === requestedUrl.pathname
      );
    }

    return registered === requested;
  } catch {
    return registered === requested;
  }
}

function isLoopback(url: URL): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
}

function extractBearer(req: Request): string | undefined {
  const header = req.header("authorization") || "";
  return header.match(/^Bearer\s+(.+)$/i)?.[1];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.byteLength !== expectedBuffer.byteLength) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHeader(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function safeHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}
