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

  it("requires a token when static bearer-token mode is explicit", () => {
    expect(() => loadConfig({
      HELPSCOUT_AUTH_MODE: "static_token"
    })).toThrow("HELPSCOUT_API_KEY is required");
  });
});
