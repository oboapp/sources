import { setTimeout as wait } from "node:timers/promises";

const transientCodes = new Set([
  "ECONNRESET", "ETIMEDOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET",
]);

function transientError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }
  const cause = error.cause;
  const code = typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "";
  const message = typeof cause === "object" && cause && "message" in cause ? String(cause.message) : "";
  return transientCodes.has(code) || ["TimeoutError", "AbortError"].includes(error.name) ||
    /ECONNRESET|ETIMEDOUT|timed out|fetch failed/i.test(error.message + " " + message);
}

export interface HttpOptions {
  fetch?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
}

async function readResponse(response: Response, url: string, feed: boolean): Promise<string | Error> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const failure = new Error(`Serdika returned HTTP ${response.status} for ${url}`);
    if ([408, 425, 429].includes(response.status) || response.status >= 500) {
      return failure;
    }
    throw failure;
  }
  const text = await response.text();
  if (feed && !text.includes("<atom:feed")) {
    return new Error("Unexpected Serdika response format (expected an ATOM feed)");
  }
  return text;
}

export async function readPortal(
  url: string,
  feed: boolean,
  options: HttpOptions,
  signal?: AbortSignal,
): Promise<string> {
  const fetchPage = options.fetch ?? fetch;
  const timeoutMs = feed ? 30_000 : 45_000;
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(timeoutMs);
    let failure: Error;
    try {
      const response = await fetchPage(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      const body = await readResponse(response, url, feed);
      if (typeof body === "string") {
        return body;
      }
      failure = body;
    } catch (error) {
      signal?.throwIfAborted();
      if (!transientError(error)) {
        throw error;
      }
      failure = error;
    }
    if (attempt >= 3) {
      throw failure;
    }
    await (options.delay ?? wait)(attempt * 1_000);
  }
}
