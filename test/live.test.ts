import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { HelpScoutClient } from "../src/helpscoutClient.js";

const runLive = process.env.HELPSCOUT_RUN_LIVE_TESTS === "true";
const describeLive = runLive ? describe : describe.skip;

describeLive("live HelpScout smoke tests", () => {
  it("reads the resource owner", async () => {
    const response = await liveClient().whoami();
    expect(response.status).toBe(200);
    expect(response.data).toBeTruthy();
  });

  it("lists inboxes", async () => {
    const response = await liveClient().listInboxes({ size: 10 });
    expect(response.status).toBe(200);
    expect(response.data).toBeTruthy();
  });

  it("searches conversations", async () => {
    const response = await liveClient().searchConversations({ page: 1, size: 10 });
    expect(response.status).toBe(200);
    expect(response.data).toBeTruthy();
  });
});

const runLiveWrites = process.env.HELPSCOUT_RUN_LIVE_WRITE_TESTS === "true";
const describeLiveWrites = runLive && runLiveWrites ? describe : describe.skip;

describeLiveWrites("live HelpScout write smoke tests", () => {
  it("is intentionally left as an explicit opt-in harness", () => {
    expect(process.env.HELPSCOUT_LIVE_MAILBOX_ID).toBeTruthy();
    expect(process.env.HELPSCOUT_LIVE_CUSTOMER_EMAIL).toBeTruthy();
  });
});

function liveClient(): HelpScoutClient {
  const config = loadConfig(process.env, "stdio");
  return new HelpScoutClient({
    appId: config.helpscoutAppId,
    appSecret: config.helpscoutAppSecret,
    apiToken: config.helpscoutApiToken,
    refreshToken: config.helpscoutRefreshToken,
    baseUrl: config.helpscoutApiBaseUrl
  });
}
