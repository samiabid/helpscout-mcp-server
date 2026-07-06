import { rawHttpRequest, type RawHttpResponse } from "./httpRequest.js";
import { HelpScoutApiError, type RateLimitInfo } from "./errors.js";

type QueryPrimitive = string | number | boolean;
type QueryValue = QueryPrimitive | QueryPrimitive[] | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface HelpScoutClientOptions {
  appId?: string;
  appSecret?: string;
  apiToken?: string;
  baseUrl?: string;
  tokenSafetyWindowMs?: number;
  maxRateLimitRetries?: number;
  maxRateLimitRetryDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HelpScoutResponse<T = unknown> {
  data: T;
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  resourceId?: string;
  location?: string;
  webLocation?: string;
  rateLimit?: RateLimitInfo;
  requestCost: number;
}

export interface PagedResult<T = unknown> {
  items: T[];
  page?: unknown;
  links?: unknown;
  pagesFetched: number;
  lastResponse: unknown;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface RequestOptions {
  query?: QueryParams;
  body?: unknown;
  isWrite?: boolean;
}

const DEFAULT_BASE_URL = "https://api.helpscout.net/v2";

export class HelpScoutClient {
  private readonly appId?: string;
  private readonly appSecret?: string;
  private readonly apiToken?: string;
  private readonly baseUrl: string;
  private readonly tokenSafetyWindowMs: number;
  private readonly maxRateLimitRetries: number;
  private readonly maxRateLimitRetryDelayMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private cachedToken?: CachedToken;

  constructor(options: HelpScoutClientOptions) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.apiToken = normalizeBearerToken(options.apiToken);
    this.baseUrl = stripTrailingSlash(options.baseUrl || DEFAULT_BASE_URL);
    this.tokenSafetyWindowMs = options.tokenSafetyWindowMs ?? 60_000;
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 1;
    this.maxRateLimitRetryDelayMs = options.maxRateLimitRetryDelayMs ?? 15_000;
    this.now = options.now || Date.now;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async getAccessToken(): Promise<string> {
    if (this.apiToken) {
      return this.apiToken;
    }

    if (this.cachedToken && this.cachedToken.expiresAtMs - this.tokenSafetyWindowMs > this.now()) {
      return this.cachedToken.accessToken;
    }

    const token = await this.fetchAccessToken();
    this.cachedToken = token;
    return token.accessToken;
  }

  clearAccessToken(): void {
    this.cachedToken = undefined;
  }

  get<T = unknown>(path: string, query?: QueryParams): Promise<HelpScoutResponse<T>> {
    return this.request<T>("GET", path, { query });
  }

  post<T = unknown>(path: string, body?: unknown, query?: QueryParams): Promise<HelpScoutResponse<T>> {
    return this.request<T>("POST", path, { body, query, isWrite: true });
  }

  put<T = unknown>(path: string, body?: unknown, query?: QueryParams): Promise<HelpScoutResponse<T>> {
    return this.request<T>("PUT", path, { body, query, isWrite: true });
  }

  patch<T = unknown>(path: string, body?: unknown, query?: QueryParams): Promise<HelpScoutResponse<T>> {
    return this.request<T>("PATCH", path, { body, query, isWrite: true });
  }

  async listPaged<T = unknown>(
    path: string,
    query: QueryParams | undefined,
    embeddedKey: string,
    maxPages: number
  ): Promise<PagedResult<T>> {
    const items: T[] = [];
    let currentPath = path;
    let currentQuery: QueryParams | undefined = query;
    let pagesFetched = 0;
    let lastResponse: unknown;
    let lastPage: unknown;
    let lastLinks: unknown;

    while (pagesFetched < maxPages) {
      const response = await this.get<Record<string, unknown>>(currentPath, currentQuery);
      const body = response.data;
      lastResponse = body;
      lastPage = body?.page;
      lastLinks = body?._links;
      pagesFetched += 1;

      const embedded = body?._embedded;
      if (isRecord(embedded)) {
        const pageItems = embedded[embeddedKey];
        if (Array.isArray(pageItems)) {
          items.push(...(pageItems as T[]));
        }
      }

      const next = nextPageHref(body);
      if (!next) {
        break;
      }

      currentPath = next;
      currentQuery = undefined;
    }

    return {
      items,
      page: lastPage,
      links: lastLinks,
      pagesFetched,
      lastResponse
    };
  }

  whoami(): Promise<HelpScoutResponse> {
    return this.get("users/me");
  }

  listInboxes(query?: QueryParams): Promise<HelpScoutResponse> {
    return this.get("mailboxes", query);
  }

  getInbox(mailboxId: number): Promise<HelpScoutResponse> {
    return this.get(`mailboxes/${mailboxId}`);
  }

  listInboxFolders(mailboxId: number, query?: QueryParams): Promise<HelpScoutResponse> {
    return this.get(`mailboxes/${mailboxId}/folders`, query);
  }

  listInboxFields(mailboxId: number): Promise<HelpScoutResponse> {
    return this.get(`mailboxes/${mailboxId}/fields`);
  }

  listUsers(query?: QueryParams): Promise<HelpScoutResponse> {
    return this.get("users", query);
  }

  listTags(query?: QueryParams): Promise<HelpScoutResponse> {
    return this.get("tags", query);
  }

  listCustomerProperties(): Promise<HelpScoutResponse> {
    return this.get("customer-properties");
  }

  getCustomer(customerId: number): Promise<HelpScoutResponse> {
    return this.get(`customers/${customerId}`);
  }

  listSavedReplies(mailboxId: number, includeChatReplies?: boolean): Promise<HelpScoutResponse> {
    return this.get(`mailboxes/${mailboxId}/saved-replies`, { includeChatReplies });
  }

  getSavedReply(mailboxId: number, savedReplyId: number): Promise<HelpScoutResponse> {
    return this.get(`mailboxes/${mailboxId}/saved-replies/${savedReplyId}`);
  }

  searchConversations(query?: QueryParams): Promise<HelpScoutResponse> {
    return this.get("conversations", query);
  }

  getConversation(conversationId: number, embed?: string): Promise<HelpScoutResponse> {
    return this.get(`conversations/${conversationId}`, { embed });
  }

  listThreads(conversationId: number, query?: QueryParams): Promise<HelpScoutResponse> {
    return this.get(`conversations/${conversationId}/threads`, query);
  }

  createConversation(payload: Record<string, unknown>): Promise<HelpScoutResponse> {
    return this.post("conversations", payload);
  }

  createReplyThread(conversationId: number, payload: Record<string, unknown>): Promise<HelpScoutResponse> {
    return this.post(`conversations/${conversationId}/reply`, payload);
  }

  createNote(conversationId: number, payload: Record<string, unknown>): Promise<HelpScoutResponse> {
    return this.post(`conversations/${conversationId}/notes`, payload);
  }

  patchConversation(conversationId: number, payload: Record<string, unknown>): Promise<HelpScoutResponse> {
    return this.patch(`conversations/${conversationId}`, payload);
  }

  snoozeConversation(conversationId: number, payload: Record<string, unknown>): Promise<HelpScoutResponse> {
    return this.put(`conversations/${conversationId}/snooze`, payload);
  }

  setConversationTags(conversationId: number, tags: string[]): Promise<HelpScoutResponse> {
    return this.put(`conversations/${conversationId}/tags`, { tags });
  }

  updateCustomFields(
    conversationId: number,
    fields: Array<{ id: number; value: string }>
  ): Promise<HelpScoutResponse> {
    return this.put(`conversations/${conversationId}/fields`, { fields });
  }

  private async fetchAccessToken(): Promise<CachedToken> {
    if (!this.appId || !this.appSecret) {
      throw new Error("Help Scout OAuth client credentials are not configured.");
    }

    const url = this.resolveUrl("oauth2/token");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.appId,
      client_secret: this.appSecret
    }).toString();

    const response = await rawHttpRequest({
      method: "POST",
      url,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body).toString()
      },
      body
    });

    const parsed = parseBody(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw createApiError("HelpScout token request failed.", response, parsed);
    }

    const tokenResponse = parsed as TokenResponse;
    if (!tokenResponse.access_token || !tokenResponse.expires_in) {
      throw new HelpScoutApiError({
        message: "HelpScout token response did not include access_token and expires_in.",
        status: response.statusCode,
        statusText: response.statusMessage,
        body: parsed,
        headers: response.headers,
        rateLimit: parseRateLimit(response.headers)
      });
    }

    return {
      accessToken: tokenResponse.access_token,
      expiresAtMs: this.now() + tokenResponse.expires_in * 1000
    };
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions,
    attempts: { authRetries: number; rateLimitRetries: number } = { authRetries: 0, rateLimitRetries: 0 }
  ): Promise<HelpScoutResponse<T>> {
    const accessToken = await this.getAccessToken();
    const requestCost = options.isWrite ? 2 : 1;
    const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body);

    const response = await rawHttpRequest({
      method,
      url: this.resolveUrl(path, options.query),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(bodyText
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(bodyText).toString()
            }
          : {})
      },
      body: bodyText
    });

    const parsed = parseBody(response);

    if (!this.apiToken && response.statusCode === 401 && attempts.authRetries < 1) {
      this.clearAccessToken();
      return this.request<T>(method, path, options, {
        ...attempts,
        authRetries: attempts.authRetries + 1
      });
    }

    if (response.statusCode === 429 && attempts.rateLimitRetries < this.maxRateLimitRetries) {
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers);
      const retryAfterMs = (retryAfterSeconds ?? 1) * 1000;

      if (retryAfterMs <= this.maxRateLimitRetryDelayMs) {
        await this.sleep(retryAfterMs);
        return this.request<T>(method, path, options, {
          ...attempts,
          rateLimitRetries: attempts.rateLimitRetries + 1
        });
      }
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw createApiError("HelpScout API request failed.", response, parsed);
    }

    return {
      data: parsed as T,
      status: response.statusCode,
      statusText: response.statusMessage,
      headers: response.headers,
      resourceId: response.headers["resource-id"],
      location: response.headers.location,
      webLocation: response.headers["web-location"],
      rateLimit: parseRateLimit(response.headers),
      requestCost
    };
  }

  private resolveUrl(path: string, query?: QueryParams): URL {
    const url = path.startsWith("http://") || path.startsWith("https://")
      ? new URL(path)
      : new URL(path.replace(/^\/+/, ""), `${this.baseUrl}/`);

    if (query) {
      appendQuery(url, query);
    }

    return url;
  }
}

function appendQuery(url: URL, query: QueryParams): void {
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(name, String(item));
      }
    } else {
      url.searchParams.set(name, String(value));
    }
  }
}

function parseBody(response: RawHttpResponse): unknown {
  if (!response.bodyText) {
    return undefined;
  }

  const contentType = response.headers["content-type"] || "";
  if (contentType.includes("json") || looksLikeJson(response.bodyText)) {
    try {
      return JSON.parse(response.bodyText);
    } catch {
      return response.bodyText;
    }
  }

  return response.bodyText;
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function createApiError(message: string, response: RawHttpResponse, body: unknown): HelpScoutApiError {
  const rateLimit = parseRateLimit(response.headers);

  return new HelpScoutApiError({
    message,
    status: response.statusCode,
    statusText: response.statusMessage,
    body,
    headers: response.headers,
    rateLimit,
    requestId: response.headers["x-request-id"] || response.headers["x-correlation-id"]
  });
}

function parseRateLimit(headers: Record<string, string>): RateLimitInfo | undefined {
  const rateLimit: RateLimitInfo = {
    limit: parseOptionalNumber(headers["x-ratelimit-limit"]),
    remaining: parseOptionalNumber(headers["x-ratelimit-remaining"]),
    retryAfterSeconds: parseRetryAfterSeconds(headers),
    resetAt: headers["x-ratelimit-reset"]
  };

  if (
    rateLimit.limit === undefined &&
    rateLimit.remaining === undefined &&
    rateLimit.retryAfterSeconds === undefined &&
    rateLimit.resetAt === undefined
  ) {
    return undefined;
  }

  return rateLimit;
}

function parseRetryAfterSeconds(headers: Record<string, string>): number | undefined {
  const retryAfter = headers["x-ratelimit-retry-after"] || headers["retry-after"];
  if (!retryAfter) {
    return undefined;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) {
    return seconds;
  }

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  }

  return undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nextPageHref(body: Record<string, unknown>): string | undefined {
  const links = body?._links;
  if (!isRecord(links)) {
    return undefined;
  }

  const next = links.next;
  if (!isRecord(next)) {
    return undefined;
  }

  return typeof next.href === "string" ? next.href : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeBearerToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/^Bearer\s+/i, "");
}
