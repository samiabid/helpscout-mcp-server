export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  retryAfterSeconds?: number;
  resetAt?: string;
}

export interface HelpScoutApiErrorOptions {
  message: string;
  status: number;
  statusText?: string;
  body?: unknown;
  headers?: Record<string, string>;
  rateLimit?: RateLimitInfo;
  requestId?: string;
}

export class HelpScoutApiError extends Error {
  readonly status: number;
  readonly statusText?: string;
  readonly body?: unknown;
  readonly headers: Record<string, string>;
  readonly rateLimit?: RateLimitInfo;
  readonly requestId?: string;

  constructor(options: HelpScoutApiErrorOptions) {
    super(options.message);
    this.name = "HelpScoutApiError";
    this.status = options.status;
    this.statusText = options.statusText;
    this.body = options.body;
    this.headers = options.headers || {};
    this.rateLimit = options.rateLimit;
    this.requestId = options.requestId;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      statusText: this.statusText,
      requestId: this.requestId,
      rateLimit: this.rateLimit,
      body: this.body
    };
  }
}

export function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof HelpScoutApiError) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return {
    name: "UnknownError",
    message: String(error)
  };
}
