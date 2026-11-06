import { setTimeout as delay } from "node:timers/promises";

export interface FacebookGraphOptions {
  pageId: string;
  apiVersion: string;
  getAccessToken: () => string | undefined | Promise<string | undefined>;
  pageSize: number;
  lookbackDays: number;
  signal?: AbortSignal;
}

export interface FacebookGraphDependencies {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

const messages = {
  configuration: "Invalid Facebook source configuration",
  authorization: "Facebook Page authorization is unavailable or invalid",
  cancelled: "Facebook request was cancelled",
  timeout: "Facebook request timed out",
  request_failed: "Facebook request failed",
  invalid_json: "Facebook returned invalid JSON",
  invalid_response: "Facebook returned an invalid response",
  invalid_cursor: "Facebook returned an invalid pagination cursor",
  cursor_loop: "Facebook repeated its pagination cursor",
  api_error: "Facebook rejected the request",
  rate_limit: "Facebook rate limit reached",
  server_error: "Facebook service is unavailable",
  invalid_post_id: "Facebook post does not belong to the configured Page",
  retry_after: "Facebook requested a longer retry delay",
};

export class FacebookApiError extends Error {
  readonly code: string;
  readonly httpStatus?: number;
  readonly graphCode?: number;

  constructor(
    code: keyof typeof messages,
    details: { httpStatus?: number; graphCode?: number } = {},
  ) {
    super(messages[code]);
    this.name = "FacebookApiError";
    this.code = code;
    if (details.httpStatus !== undefined) {
      this.httpStatus = details.httpStatus;
    }
    if (details.graphCode !== undefined) {
      this.graphCode = details.graphCode;
    }
  }
}

const rateLimitCodes = new Set([4, 17, 32, 613]);
const fields = "id,message,created_time,updated_time,permalink_url,attachments";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function graphCode(value: unknown): number | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }
  return typeof value.error.code === "number" && Number.isInteger(value.error.code)
    ? value.error.code
    : undefined;
}

function retryDelay(value: string | null, now: Date): number {
  if (value === null) {
    return 0;
  }
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - now.getTime();
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
}

export class FacebookGraphClient {
  private readonly options: FacebookGraphOptions;
  private readonly fetchPage: typeof globalThis.fetch;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly since?: number;
  private token?: Promise<string>;

  constructor(options: FacebookGraphOptions, dependencies: FacebookGraphDependencies = {}) {
    if (!/^[1-9]\d{0,31}$/.test(options.pageId) ||
        !/^v\d{1,3}\.\d{1,2}$/.test(options.apiVersion) ||
        !Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 100 ||
        !Number.isInteger(options.lookbackDays) || options.lookbackDays < 0 || options.lookbackDays > 30 ||
        typeof options.getAccessToken !== "function") {
      throw new FacebookApiError("configuration");
    }
    this.options = { ...options };
    this.fetchPage = dependencies.fetch ?? ((...args) => globalThis.fetch(...args));
    this.now = dependencies.now ?? (() => new Date());
    this.sleep = dependencies.sleep ?? (async (milliseconds) => {
      await delay(milliseconds, undefined, { signal: this.options.signal });
    });
    const startedAt = this.now().getTime();
    if (!Number.isFinite(startedAt)) {
      throw new FacebookApiError("configuration");
    }
    if (options.lookbackDays > 0) {
      this.since = Math.floor(startedAt / 1000) - options.lookbackDays * 86400;
    }
  }

  private checkCancellation(): void {
    if (this.options.signal?.aborted) {
      throw new FacebookApiError("cancelled");
    }
  }

  private getToken(): Promise<string> {
    this.token ??= (async () => {
      try {
        const token = await this.options.getAccessToken();
        if (typeof token !== "string" || token.length === 0 || token.length > 4096 || /\s/.test(token)) {
          throw new FacebookApiError("authorization");
        }
        return token;
      } catch {
        throw new FacebookApiError("authorization");
      }
    })();
    return this.token;
  }

  private async validateCursor(cursor: string): Promise<void> {
    if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 8192 ||
        cursor.includes(await this.getToken())) {
      throw new FacebookApiError("invalid_cursor");
    }
  }

  private url(path: string): URL {
    const url = new URL(`https://graph.facebook.com/${this.options.apiVersion}/${path}`);
    url.searchParams.set("fields", fields);
    return url;
  }

  private async read(url: URL): Promise<unknown> {
    this.checkCancellation();
    const token = await this.getToken();
    for (let attempt = 0; attempt <= 2; attempt++) {
      this.checkCancellation();
      const timeout = AbortSignal.timeout(15_000);
      const signal = this.options.signal === undefined
        ? timeout
        : AbortSignal.any([timeout, this.options.signal]);
      let response: Response;
      let body: unknown;
      let validJson = true;
      try {
        response = await this.fetchPage(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          redirect: "error",
          signal,
        });
        try {
          body = await response.json();
        } catch {
          validJson = false;
        }
        this.checkCancellation();
        if (timeout.aborted) {
          throw new FacebookApiError("timeout");
        }
      } catch {
        this.checkCancellation();
        throw new FacebookApiError(timeout.aborted ? "timeout" : "request_failed");
      }
      const code = graphCode(body);
      const details = {
        httpStatus: response.status,
        ...(code === undefined ? {} : { graphCode: code }),
      };
      if (code === 190) {
        throw new FacebookApiError("authorization", details);
      }
      const limited = response.status === 429 || (code !== undefined && rateLimitCodes.has(code));
      const retryable = limited || response.status >= 500;
      if (retryable) {
        const requestedDelay = retryDelay(response.headers.get("Retry-After"), this.now());
        if (requestedDelay > 5000) {
          throw new FacebookApiError("retry_after", details);
        }
        if (attempt < 2) {
          try {
            await this.sleep(Math.max(1000 * 2 ** attempt, requestedDelay));
          } catch {
            this.checkCancellation();
            throw new FacebookApiError("request_failed");
          }
          continue;
        }
        throw new FacebookApiError(limited ? "rate_limit" : "server_error", details);
      }
      if (!response.ok || (isRecord(body) && body.error !== undefined)) {
        throw new FacebookApiError("api_error", details);
      }
      if (!validJson) {
        throw new FacebookApiError("invalid_json", details);
      }
      return body;
    }
    throw new FacebookApiError("request_failed");
  }

  async listPosts(cursor?: string): Promise<{ posts: unknown[]; nextCursor?: string }> {
    this.checkCancellation();
    if (cursor !== undefined) {
      await this.validateCursor(cursor);
    }
    const url = this.url(`${this.options.pageId}/published_posts`);
    url.searchParams.set("limit", String(this.options.pageSize));
    if (this.since !== undefined) {
      url.searchParams.set("since", String(this.since));
    }
    if (cursor !== undefined) {
      url.searchParams.set("after", cursor);
    }
    const body = await this.read(url);
    if (!isRecord(body) || !Array.isArray(body.data) || body.data.length > 100) {
      throw new FacebookApiError("invalid_response");
    }
    const posts: unknown[] = body.data;
    if (body.paging === undefined) {
      return { posts };
    }
    if (!isRecord(body.paging)) {
      throw new FacebookApiError("invalid_response");
    }
    if (body.paging.next === undefined || body.paging.next === null || body.paging.next === "") {
      return { posts };
    }
    if (typeof body.paging.next !== "string" || !isRecord(body.paging.cursors) ||
        typeof body.paging.cursors.after !== "string") {
      throw new FacebookApiError("invalid_cursor");
    }
    const nextCursor = body.paging.cursors.after;
    await this.validateCursor(nextCursor);
    if (nextCursor === cursor) {
      throw new FacebookApiError("cursor_loop");
    }
    return { posts, nextCursor };
  }

  async getPost(postId: string): Promise<unknown> {
    if (typeof postId !== "string" || !/^\d+_\d+$/.test(postId) ||
        !postId.startsWith(`${this.options.pageId}_`)) {
      throw new FacebookApiError("invalid_post_id");
    }
    const body = await this.read(this.url(postId));
    if (!isRecord(body)) {
      throw new FacebookApiError("invalid_response");
    }
    return body;
  }
}
