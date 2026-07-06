export type TransportMode = "stdio" | "http";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type HelpScoutAuthMode = "oauth_client_credentials" | "static_token";

export interface HelpScoutMcpConfig {
  helpscoutAuthMode: HelpScoutAuthMode;
  helpscoutAppId?: string;
  helpscoutAppSecret?: string;
  helpscoutApiToken?: string;
  helpscoutApiBaseUrl: string;
  enableWrites: boolean;
  httpHost: string;
  httpPort: number;
  httpToken?: string;
  oauthEnabled: boolean;
  oauthPublicUrl?: string;
  oauthSecret?: string;
  oauthPassword?: string;
  oauthEnableClientMetadataDocuments: boolean;
  allowStaticTokenWithOAuth: boolean;
  logLevel: LogLevel;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  mode: TransportMode = "stdio"
): HelpScoutMcpConfig {
  const helpscoutApiToken = firstNonEmpty(
    env.HELPSCOUT_API_KEY,
    env.HELPSCOUT_API_TOKEN,
    env.HELPSCOUT_ACCESS_TOKEN
  );
  const helpscoutAuthMode = parseHelpScoutAuthMode(env.HELPSCOUT_AUTH_MODE, helpscoutApiToken);
  const helpscoutAppId = env.HELPSCOUT_APP_ID?.trim() || undefined;
  const helpscoutAppSecret = env.HELPSCOUT_APP_SECRET?.trim() || undefined;
  const httpToken = env.HELPSCOUT_MCP_HTTP_TOKEN?.trim() || undefined;
  const oauthEnabled = parseBoolean(env.HELPSCOUT_MCP_OAUTH_ENABLED, false);
  const oauthSecret = env.HELPSCOUT_MCP_OAUTH_SECRET?.trim() || undefined;
  const oauthPassword = env.HELPSCOUT_MCP_OAUTH_PASSWORD?.trim() || undefined;
  const allowStaticTokenWithOAuth = parseBoolean(env.HELPSCOUT_MCP_ALLOW_STATIC_TOKEN_WITH_OAUTH, false);

  if (mode === "http" && !oauthEnabled && !httpToken) {
    throw new Error("HELPSCOUT_MCP_HTTP_TOKEN is required in HTTP mode.");
  }

  if (mode === "http" && oauthEnabled) {
    if (!oauthSecret) {
      throw new Error("HELPSCOUT_MCP_OAUTH_SECRET is required when HELPSCOUT_MCP_OAUTH_ENABLED=true.");
    }

    if (!oauthPassword) {
      throw new Error("HELPSCOUT_MCP_OAUTH_PASSWORD is required when HELPSCOUT_MCP_OAUTH_ENABLED=true.");
    }
  }

  if (helpscoutAuthMode === "static_token" && !helpscoutApiToken) {
    throw new Error("HELPSCOUT_API_KEY is required when HELPSCOUT_AUTH_MODE=static_token.");
  }

  if (helpscoutAuthMode === "oauth_client_credentials" && (!helpscoutAppId || !helpscoutAppSecret)) {
    throw new Error(
      "HELPSCOUT_APP_ID and HELPSCOUT_APP_SECRET are required unless HELPSCOUT_API_KEY is set."
    );
  }

  return {
    helpscoutAuthMode,
    helpscoutAppId,
    helpscoutAppSecret,
    helpscoutApiToken,
    helpscoutApiBaseUrl: stripTrailingSlash(
      env.HELPSCOUT_API_BASE_URL || "https://api.helpscout.net/v2"
    ),
    enableWrites: parseBoolean(env.HELPSCOUT_MCP_ENABLE_WRITES, false),
    httpHost: env.HELPSCOUT_MCP_HTTP_HOST || env.HOST || (env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1"),
    httpPort: parsePort(env.HELPSCOUT_MCP_HTTP_PORT || env.PORT || "3344"),
    httpToken,
    oauthEnabled,
    oauthPublicUrl: optionalUrl(env.HELPSCOUT_MCP_PUBLIC_URL),
    oauthSecret,
    oauthPassword,
    oauthEnableClientMetadataDocuments: parseBoolean(env.HELPSCOUT_MCP_OAUTH_ENABLE_CIMD, false),
    allowStaticTokenWithOAuth,
    logLevel: parseLogLevel(env.HELPSCOUT_MCP_LOG_LEVEL || "info")
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseHelpScoutAuthMode(value: string | undefined, token: string | undefined): HelpScoutAuthMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return token ? "static_token" : "oauth_client_credentials";
  }

  if (["static_token", "api_key", "access_token", "bearer"].includes(normalized)) {
    return "static_token";
  }

  if (["oauth_client_credentials", "oauth", "client_credentials"].includes(normalized)) {
    return "oauth_client_credentials";
  }

  throw new Error(`Invalid HELPSCOUT_AUTH_MODE: ${value}`);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid HELPSCOUT_MCP_HTTP_PORT: ${value}`);
  }
  return port;
}

function parseLogLevel(value: string): LogLevel {
  if (["debug", "info", "warn", "error"].includes(value)) {
    return value as LogLevel;
  }
  throw new Error(`Invalid HELPSCOUT_MCP_LOG_LEVEL: ${value}`);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function optionalUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? stripTrailingSlash(trimmed) : undefined;
}
