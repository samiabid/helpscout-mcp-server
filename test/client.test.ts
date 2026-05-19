import nock from "nock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HelpScoutApiError } from "../src/errors.js";
import { HelpScoutClient } from "../src/helpscoutClient.js";

const baseUrl = "https://api.helpscout.test/v2";
const origin = "https://api.helpscout.test";

describe("HelpScoutClient", () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it("fetches and reuses a client-credentials access token", async () => {
    const client = createClient();

    nock(origin)
      .post("/v2/oauth2/token", /grant_type=client_credentials&client_id=app-id&client_secret=app-secret/)
      .once()
      .reply(200, token("cached-token"));

    nock(origin)
      .get("/v2/users/me")
      .matchHeader("authorization", "Bearer cached-token")
      .reply(200, { id: 1 });

    nock(origin)
      .get("/v2/mailboxes")
      .matchHeader("authorization", "Bearer cached-token")
      .reply(200, { _embedded: { mailboxes: [] } });

    expect((await client.whoami()).data).toEqual({ id: 1 });
    expect((await client.listInboxes()).data).toEqual({ _embedded: { mailboxes: [] } });
    expect(nock.isDone()).toBe(true);
  });

  it("refreshes the access token when the cached token is inside the safety window", async () => {
    let now = 0;
    const client = createClient({ now: () => now, tokenSafetyWindowMs: 60_000 });

    nock(origin)
      .post("/v2/oauth2/token")
      .reply(200, token("first-token", 120))
      .get("/v2/users/me")
      .matchHeader("authorization", "Bearer first-token")
      .reply(200, { id: 1 })
      .post("/v2/oauth2/token")
      .reply(200, token("second-token", 120))
      .get("/v2/users/me")
      .matchHeader("authorization", "Bearer second-token")
      .reply(200, { id: 1 });

    await client.whoami();
    now = 61_000;
    await client.whoami();

    expect(nock.isDone()).toBe(true);
  });

  it("clears and refreshes the token once after an authenticated 401", async () => {
    const client = createClient();

    nock(origin)
      .post("/v2/oauth2/token")
      .reply(200, token("expired-token"))
      .get("/v2/users/me")
      .matchHeader("authorization", "Bearer expired-token")
      .reply(401, { error: "expired" })
      .post("/v2/oauth2/token")
      .reply(200, token("fresh-token"))
      .get("/v2/users/me")
      .matchHeader("authorization", "Bearer fresh-token")
      .reply(200, { id: 7 });

    expect((await client.whoami()).data).toEqual({ id: 7 });
    expect(nock.isDone()).toBe(true);
  });

  it("follows HAL next-page links through the pagination helper", async () => {
    const client = createClient();

    nock(origin)
      .post("/v2/oauth2/token")
      .reply(200, token("page-token"))
      .get("/v2/mailboxes")
      .query({ page: "1" })
      .reply(200, {
        _embedded: { mailboxes: [{ id: 1 }] },
        _links: { next: { href: `${baseUrl}/mailboxes?page=2` } },
        page: { number: 1, totalPages: 2 }
      })
      .get("/v2/mailboxes")
      .query({ page: "2" })
      .reply(200, {
        _embedded: { mailboxes: [{ id: 2 }] },
        page: { number: 2, totalPages: 2 }
      });

    const result = await client.listPaged("mailboxes", { page: 1 }, "mailboxes", 5);

    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.pagesFetched).toBe(2);
    expect(nock.isDone()).toBe(true);
  });

  it("retries a 429 when Help Scout supplies a retry-after value", async () => {
    const sleep = vi.fn(async () => undefined);
    const client = createClient({ sleep, maxRateLimitRetryDelayMs: 10_000 });

    nock(origin)
      .post("/v2/oauth2/token")
      .reply(200, token("rate-token"))
      .get("/v2/users/me")
      .reply(429, { message: "slow down" }, { "X-RateLimit-Retry-After": "2" })
      .get("/v2/users/me")
      .reply(200, { id: 9 });

    expect((await client.whoami()).data).toEqual({ id: 9 });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(nock.isDone()).toBe(true);
  });

  it("normalizes API errors with status, body, request id, and rate-limit details", async () => {
    const client = createClient();

    nock(origin)
      .post("/v2/oauth2/token")
      .reply(200, token("error-token"))
      .get("/v2/users/me")
      .reply(403, { message: "forbidden" }, {
        "X-Request-Id": "req_123",
        "X-RateLimit-Limit": "400",
        "X-RateLimit-Remaining": "399"
      });

    await expect(client.whoami()).rejects.toMatchObject({
      name: "HelpScoutApiError",
      status: 403,
      requestId: "req_123",
      body: { message: "forbidden" }
    } satisfies Partial<HelpScoutApiError>);
  });
});

function createClient(overrides: Partial<ConstructorParameters<typeof HelpScoutClient>[0]> = {}): HelpScoutClient {
  return new HelpScoutClient({
    appId: "app-id",
    appSecret: "app-secret",
    baseUrl,
    ...overrides
  });
}

function token(accessToken: string, expiresIn = 172_800): Record<string, unknown> {
  return {
    token_type: "bearer",
    access_token: accessToken,
    expires_in: expiresIn
  };
}
