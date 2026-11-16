import {
  describeFeedUrl,
  diagnosticError,
  diagnosticFeedUrl,
  diagnosticPagination,
} from "./rss-diagnostics.js";

export const RSS_FEED_FETCH_TIMEOUT_MS = 30_000;
export const RSS_FEED_FETCH_MAX_ATTEMPTS = 2;
export const RSS_FEED_FETCH_RETRY_DELAY_MS = 2_000;

const TIMEOUT_MESSAGE = "RSS timeout budget exhausted";
const RETRYABLE_HTTP_STATUSES = new Set([408, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
]);

/** HTTP status remains available to sources with provider-specific pagination. */
export class RssFeedHttpError extends Error {
  readonly url: string;

  constructor(
    readonly status: number,
    url: string,
    readonly attempts = 1,
    readonly retryAfterMs?: number,
  ) {
    const attemptText = attempts === 1 ? "attempt" : "attempts";
    super(`RSS feed returned ${status} for ${describeFeedUrl(url)} after ${attempts} ${attemptText}`);
    this.name = "RssFeedHttpError";
    this.url = diagnosticFeedUrl(url);
  }
}

/** Fetch and body-read failures retain a safe copy of the original exception chain. */
export class RssFeedFetchError extends Error {
  readonly url: string;

  constructor(
    url: string,
    readonly attempts: number,
    cause: unknown,
    readonly timedOut = false,
  ) {
    const safeCause = diagnosticError(cause);
    const reason = timedOut ? "timed out" : "failed";
    const attemptText = attempts === 1 ? "attempt" : "attempts";
    super(
      `RSS feed request ${reason} for ${describeFeedUrl(url)} after ${attempts} ${attemptText}: ${safeCause.message}`,
      { cause: safeCause },
    );
    this.name = "RssFeedFetchError";
    this.url = diagnosticFeedUrl(url);
  }
}

class RssFeedContentError extends Error {
  constructor(url: string, attempts: number) {
    const attemptText = attempts === 1 ? "attempt" : "attempts";
    super(`RSS feed response does not look like RSS (possible anti-bot or error page) for ${describeFeedUrl(url)} after ${attempts} ${attemptText}`);
    this.name = "RssFeedContentError";
  }
}

export type RssFeedFetchEvent = {
  type: "retry";
  url: string;
  attempt: number;
  nextAttempt: number;
  delayMs: number;
  reason: "network" | "http";
  status?: number;
  code?: string;
  pagination?: string;
} | {
  type: "recovered";
  url: string;
  attempts: number;
  pagination?: string;
};

export interface RssFeedFetchOptions {
  onEvent?: (event: RssFeedFetchEvent) => void;
}

function reportEvent(options: RssFeedFetchOptions, event: RssFeedFetchEvent): void {
  try {
    const reported = options.onEvent?.(event);
    void Promise.resolve(reported).catch(() => {
      // Observers do not change collection outcomes.
    });
  } catch {
    // Observers do not change collection outcomes.
  }
}

function httpDateTimestamp(text: string): number {
  if (/^[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/.test(text)) {
    return Date.parse(`${text} GMT`);
  }
  const obsoleteDate = /^[A-Za-z]+, (\d{2})-([A-Za-z]{3})-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(text);
  if (obsoleteDate) {
    const limit = new Date(Date.now());
    limit.setUTCFullYear(limit.getUTCFullYear() + 50);
    const year = Math.floor(limit.getUTCFullYear() / 100) * 100 + Number(obsoleteDate[3]);
    const candidate = new Date(Date.parse(`${obsoleteDate[1]} ${obsoleteDate[2]} ${year} ${obsoleteDate[4]} GMT`));
    if (candidate.getTime() > limit.getTime()) {
      candidate.setUTCFullYear(year - 100);
    }
    return candidate.getTime();
  }
  if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) {
    return Date.parse(text);
  }
  return Number.NaN;
}

function retryAfterDelay(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const milliseconds = Number(text) * 1_000;
    return Number.isFinite(milliseconds) ? milliseconds : Number.POSITIVE_INFINITY;
  }
  const timestamp = httpDateTimestamp(text);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - Date.now());
}

async function readResponse(
  url: string,
  signal: AbortSignal,
  attempts: number,
  checkBudget: () => void,
): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; oboapp-crawler/1.0)",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
    signal,
  });
  checkBudget();
  if (!response.ok) {
    const retryAfterMs = retryAfterDelay(response.headers.get("Retry-After"));
    try {
      await response.body?.cancel();
    } catch {
      // A body cleanup failure must preserve the original HTTP status.
    }
    throw new RssFeedHttpError(response.status, url, attempts, retryAfterMs);
  }
  const text = await response.text();
  checkBudget();
  if (!text.includes("<rss") && !text.includes("<channel>")) {
    throw new RssFeedContentError(url, attempts);
  }
  return text;
}

async function readFeedAttempt(url: string, deadline: number, attempts: number): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutFailure = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(TIMEOUT_MESSAGE));
    }, Math.max(0, deadline - Date.now()));
  });
  function checkBudget(): void {
    if (timedOut || Date.now() >= deadline) {
      timedOut = true;
      controller.abort();
      throw new Error(TIMEOUT_MESSAGE);
    }
  }
  try {
    return await Promise.race([
      readResponse(url, controller.signal, attempts, checkBudget),
      timeoutFailure,
    ]);
  } catch (error) {
    if (error instanceof RssFeedHttpError || error instanceof RssFeedContentError) {
      throw error;
    }
    throw new RssFeedFetchError(url, attempts, error, timedOut);
  } finally {
    clearTimeout(timeoutId);
  }
}

function transientNetworkCode(error: Error): string | undefined {
  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return undefined;
  }
  const code: unknown = Reflect.get(error, "code");
  if (typeof code === "string" && !RETRYABLE_NETWORK_CODES.has(code)) {
    return undefined;
  }
  const children: unknown[] = [];
  if (error.cause !== undefined) {
    children.push(error.cause);
  }
  if (error instanceof AggregateError) {
    children.push(...error.errors);
  }
  const childCodes = children.map((child) => {
    return child instanceof Error ? transientNetworkCode(child) : undefined;
  });
  if (childCodes.includes(undefined)) {
    return undefined;
  }
  return typeof code === "string" ? code : childCodes[0];
}

function retryDetails(error: unknown): {
  delayMs: number;
  reason: "network" | "http";
  status?: number;
  code?: string;
} | undefined {
  if (error instanceof RssFeedHttpError) {
    if (!RETRYABLE_HTTP_STATUSES.has(error.status)
        && !(error.status === 429 && error.retryAfterMs !== undefined)) {
      return undefined;
    }
    return {
      delayMs: Math.max(RSS_FEED_FETCH_RETRY_DELAY_MS, error.retryAfterMs ?? 0),
      reason: "http",
      status: error.status,
    };
  }
  if (!(error instanceof RssFeedFetchError) || error.timedOut) {
    return undefined;
  }
  const code = error.cause instanceof Error ? transientNetworkCode(error.cause) : undefined;
  return code ? { delayMs: RSS_FEED_FETCH_RETRY_DELAY_MS, reason: "network", code } : undefined;
}

async function waitForRetry(
  error: unknown,
  attempt: number,
  deadline: number,
  context: { url: string; pagination?: string },
  options: RssFeedFetchOptions,
): Promise<void> {
  const retry = retryDetails(error);
  if (attempt >= RSS_FEED_FETCH_MAX_ATTEMPTS || !retry || retry.delayMs >= deadline - Date.now()) {
    throw error;
  }
  reportEvent(options, {
    type: "retry", ...context, ...retry, attempt, nextAttempt: attempt + 1,
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, retry.delayMs);
  });
  if (Date.now() >= deadline) {
    throw error;
  }
}

/** Fetch and read RSS with at most one paced retry within one total timeout budget. */
export async function fetchFeedXml(
  url: string,
  timeoutMs = RSS_FEED_FETCH_TIMEOUT_MS,
  options: RssFeedFetchOptions = {},
): Promise<string> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new RangeError("RSS timeout must be a positive number no greater than 2147483647 milliseconds");
  }
  const deadline = Date.now() + timeoutMs;
  const safeUrl = diagnosticFeedUrl(url);
  const pagination = diagnosticPagination(safeUrl);
  const context = pagination ? { url: safeUrl, pagination } : { url: safeUrl };
  for (let attempt = 1; ; attempt++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new RssFeedFetchError(url, attempt - 1, new Error(TIMEOUT_MESSAGE), true);
    }
    try {
      const xml = await readFeedAttempt(url, deadline, attempt);
      if (Date.now() >= deadline) {
        throw new RssFeedFetchError(url, attempt, new Error(TIMEOUT_MESSAGE), true);
      }
      if (attempt > 1) {
        reportEvent(options, { type: "recovered", ...context, attempts: attempt });
      }
      return xml;
    } catch (error) {
      await waitForRetry(error, attempt, deadline, context, options);
    }
  }
}
