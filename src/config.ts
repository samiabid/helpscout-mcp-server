export type TransportMode = "stdio" | "http";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface HelpScoutMcpConfig {
  helpscoutAppId: string;
  helpscoutAppSecret: string;
  helpscoutApiBaseUrl: string;
  enableWrites: boolean;
  httpHost: string;
  httpPort: number;
  httpToken?: string;
  oauthEnabled: boolean;
  oauthPublicUrl?: string;
  oauthSecret?: string;
  oauthPassword?: string;
  logLevel: LogLevel;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  mode: TransportMode = "stdio"
): HelpScoutMcpConfig {
  const helpscoutAppId = required(env.HELPSCOUT_APP_ID, "HELPSCOUT_APP_ID");
  const helpscoutAppSecret = required(env.HELPSCOUT_APP_SECRET, "HELPSCOUT_APP_SECRET");
  const httpToken = env.HELPSCOUT_MCP_HTTP_TOKEN?.trim() || undefined;
  const oauthEnabled = parseBoolean(env.HELPSCOUT_MCP_OAUTH_ENABLED, false);
  const oauthSecret = env.HELPSCOUT_MCP_OAUTH_SECRET?.trim() || undefined;
  const oauthPassword = env.HELPSCOUT_MCP_OAUTH_PASSWORD?.trim() || undefined;

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

  return {
    helpscoutAppId,
    helpscoutAppSecret,
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
    logLevel: parseLogLevel(env.HELPSCOUT_MCP_LOG_LEVEL || "info")
  };
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} is required.`);
  }
  return trimmed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
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
