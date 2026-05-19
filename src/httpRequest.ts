import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders } from "node:http";

export interface RawHttpRequestOptions {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  body?: string;
}

export interface RawHttpResponse {
  statusCode: number;
  statusMessage?: string;
  headers: Record<string, string>;
  bodyText: string;
}

export function rawHttpRequest(options: RawHttpRequestOptions): Promise<RawHttpResponse> {
  const transport = options.url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const request = transport(
      options.url,
      {
        method: options.method,
        headers: options.headers
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          resolve({
            statusCode: response.statusCode || 0,
            statusMessage: response.statusMessage,
            headers: normalizeHeaders(response.headers),
            bodyText: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    request.on("error", reject);

    if (options.body !== undefined) {
      request.write(options.body);
    }

    request.end();
  });
}

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized[name.toLowerCase()] = value.join(", ");
    } else if (value !== undefined) {
      normalized[name.toLowerCase()] = String(value);
    }
  }

  return normalized;
}
