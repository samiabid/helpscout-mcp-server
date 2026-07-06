import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig Help Scout auth", () => {
  it("uses HELPSCOUT_API_KEY without requiring OAuth app credentials", () => {
    const config = loadConfig({
      HELPSCOUT_API_KEY: "static-api-key"
    });

    expect(config.helpscoutAuthMode).toBe("static_token");
    expect(config.helpscoutApiToken).toBe("static-api-key");
    expect(config.helpscoutAppId).toBeUndefined();
    expect(config.helpscoutAppSecret).toBeUndefined();
  });

  it("accepts API token aliases for static bearer-token mode", () => {
    const config = loadConfig({
      HELPSCOUT_API_TOKEN: "static-api-token"
    });

    expect(config.helpscoutAuthMode).toBe("static_token");
    expect(config.helpscoutApiToken).toBe("static-api-token");
  });

  it("supports legacy OAuth client-credentials mode", () => {
    const config = loadConfig({
      HELPSCOUT_AUTH_MODE: "oauth_client_credentials",
      HELPSCOUT_APP_ID: "app-id",
      HELPSCOUT_APP_SECRET: "app-secret"
    });

    expect(config.helpscoutAuthMode).toBe("oauth_client_credentials");
    expect(config.helpscoutAppId).toBe("app-id");
    expect(config.helpscoutAppSecret).toBe("app-secret");
  });

  it("supports OAuth refresh-token mode", () => {
    const config = loadConfig({
      HELPSCOUT_AUTH_MODE: "oauth_refresh_token",
      HELPSCOUT_API_KEY: "ignored-static-token",
      HELPSCOUT_CLIENT_ID: "client-id",
      HELPSCOUT_CLIENT_SECRET: "client-secret",
      HELPSCOUT_REFRESH_TOKEN: "refresh-token"
    });

    expect(config.helpscoutAuthMode).toBe("oauth_refresh_token");
    expect(config.helpscoutAppId).toBe("client-id");
    expect(config.helpscoutAppSecret).toBe("client-secret");
    expect(config.helpscoutApiToken).toBeUndefined();
    expect(config.helpscoutRefreshToken).toBe("refresh-token");
  });

  it("infers OAuth refresh-token mode when a refresh token is configured", () => {
    const config = loadConfig({
      HELPSCOUT_APP_ID: "app-id",
      HELPSCOUT_APP_SECRET: "app-secret",
      HELPSCOUT_REFRESH_TOKEN: "refresh-token"
    });

    expect(config.helpscoutAuthMode).toBe("oauth_refresh_token");
  });

  it("requires a token when static bearer-token mode is explicit", () => {
    expect(() => loadConfig({
      HELPSCOUT_AUTH_MODE: "static_token"
    })).toThrow("HELPSCOUT_API_KEY is required");
  });

  it("requires OAuth credentials and a refresh token in refresh-token mode", () => {
    expect(() => loadConfig({
      HELPSCOUT_AUTH_MODE: "oauth_refresh_token",
      HELPSCOUT_APP_ID: "app-id",
      HELPSCOUT_APP_SECRET: "app-secret"
    })).toThrow("HELPSCOUT_APP_ID, HELPSCOUT_APP_SECRET, and HELPSCOUT_REFRESH_TOKEN are required");
  });
});
