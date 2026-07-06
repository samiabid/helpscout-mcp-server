export type TransportMode = "stdio" | "http";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type HelpScoutAuthMode = "oauth_client_credentials" | "oauth_refresh_token" | "static_token";

export interface HelpScoutMcpConfig {
  helpscoutAuthMode: HelpScoutAuthMode;
  helpscoutAppId?: string;
  helpscoutAppSecret?: string;
  helpscoutApiToken?: string;
  helpscoutRefreshToken?: string;
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
  const helpscoutRefreshToken = env.HELPSCOUT_REFRESH_TOKEN?.trim() || undefined;
  const helpscoutAuthMode = parseHelpScoutAuthMode(env.HELPSCOUT_AUTH_MODE, {
    staticToken: helpscoutApiToken,
    refreshToken: helpscoutRefreshToken
  });
  const helpscoutAppId = firstNonEmpty(
    env.HELPSCOUT_APP_ID,
    env.HELPSCOUT_CLIENT_ID,
    env.HELPSCOUT_APPLICATION_ID
  );
  const helpscoutAppSecret = firstNonEmpty(
    env.HELPSCOUT_APP_SECRET,
    env.HELPSCOUT_CLIENT_SECRET,
    env.HELPSCOUT_APPLICATION_SECRET
  );
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

  if (helpscoutAuthMode === "oauth_refresh_token" && (!helpscoutAppId || !helpscoutAppSecret || !helpscoutRefreshToken)) {
    throw new Error(
      "HELPSCOUT_APP_ID, HELPSCOUT_APP_SECRET, and HELPSCOUT_REFRESH_TOKEN are required when HELPSCOUT_AUTH_MODE=oauth_refresh_token."
    );
  }

  return {
    helpscoutAuthMode,
    helpscoutAppId,
    helpscoutAppSecret,
    helpscoutApiToken: helpscoutAuthMode === "static_token" ? helpscoutApiToken : undefined,
    helpscoutRefreshToken: helpscoutAuthMode === "oauth_refresh_token" ? helpscoutRefreshToken : undefined,
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

function parseHelpScoutAuthMode(
  value: string | undefined,
  credentials: { staticToken: string | undefined; refreshToken: string | undefined }
): HelpScoutAuthMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    if (credentials.refreshToken) {
      return "oauth_refresh_token";
    }

    return credentials.staticToken ? "static_token" : "oauth_client_credentials";
  }

  if (["static_token", "api_key", "access_token", "bearer"].includes(normalized)) {
    return "static_token";
  }

  if (["oauth_client_credentials", "oauth", "client_credentials"].includes(normalized)) {
    return "oauth_client_credentials";
  }

  if (["oauth_refresh_token", "refresh_token", "authorization_code"].includes(normalized)) {
    return "oauth_refresh_token";
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
