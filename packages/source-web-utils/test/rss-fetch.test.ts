import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, mock, test } from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { inspect } from "node:util";
import {
  fetchFeedXml,
  RssFeedFetchError,
  RssFeedHttpError,
  RSS_FEED_FETCH_MAX_ATTEMPTS,
  RSS_FEED_FETCH_RETRY_DELAY_MS,
  type RssFeedFetchOptions,
} from "../dist/esm/rss.js";

type FetchEvent = Parameters<NonNullable<RssFeedFetchOptions["onEvent"]>>[0];

const originalFetch = globalThis.fetch;
const originalTimeZone = process.env.TZ;
const feedUrl = "https://example.com/feed/";
const xml = "<rss><channel></channel></rss>";
const clock = Date.parse("2026-11-16T10:00:00Z");

function networkError(code: string): TypeError {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error(`Connection failed: ${code}`), { code }),
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
  mock.restoreAll();
});

test("retries a transient nested network cause after pacing and reports recovery", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  const signals: AbortSignal[] = [];
  const events: FetchEvent[] = [];
  const fetchMock = mock.fn<typeof fetch>(async (_input, options) => {
    assert.ok(options?.signal);
    signals.push(options.signal);
    if (signals.length === 1) {
      throw networkError("ECONNRESET");
    }
    return new Response(xml);
  });
  globalThis.fetch = fetchMock;

  const request = fetchFeedXml(feedUrl, 30_000, {
    onEvent(event) {
      events.push(event);
    },
  });
  await settle();
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(events, [{
    type: "retry",
    url: feedUrl,
    attempt: 1,
    nextAttempt: 2,
    delayMs: RSS_FEED_FETCH_RETRY_DELAY_MS,
    reason: "network",
    code: "ECONNRESET",
  }]);
  context.mock.timers.tick(RSS_FEED_FETCH_RETRY_DELAY_MS - 1);
  await settle();
  assert.equal(fetchMock.mock.callCount(), 1);
  context.mock.timers.tick(1);

  assert.equal(await request, xml);
  assert.equal(fetchMock.mock.callCount(), RSS_FEED_FETCH_MAX_ATTEMPTS);
  assert.notEqual(signals[0], signals[1]);
  assert.deepEqual(events[1], { type: "recovered", url: feedUrl, attempts: 2 });
  context.mock.timers.tick(60_000);
  assert.ok(signals.every((signal) => !signal.aborted));
});

test("stops after the second transient failure and retains its nested cause", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  const fetchMock = mock.fn<typeof fetch>(async () => {
    throw networkError("UND_ERR_CONNECT_TIMEOUT");
  });
  globalThis.fetch = fetchMock;

  const request = fetchFeedXml(feedUrl);
  const rejected = assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof RssFeedFetchError);
    assert.equal(error.url, feedUrl);
    assert.equal(error.attempts, 2);
    assert.ok(error.message.includes(feedUrl));
    assert.match(error.message, /2/);
    assert.ok(error.cause instanceof Error);
    assert.ok(inspect(error.cause, { depth: 10 }).includes("UND_ERR_CONNECT_TIMEOUT"));
    return true;
  });
  await settle();
  context.mock.timers.tick(RSS_FEED_FETCH_RETRY_DELAY_MS);
  await rejected;
  context.mock.timers.tick(60_000);
  await settle();
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("retries a transient response-body failure", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    const response = new Response(xml);
    if (attempts === 1) {
      mock.method(response, "text", async () => {
        throw networkError("UND_ERR_BODY_TIMEOUT");
      });
    }
    return response;
  };

  const request = fetchFeedXml(feedUrl);
  await settle();
  context.mock.timers.tick(RSS_FEED_FETCH_RETRY_DELAY_MS);

  assert.equal(await request, xml);
  assert.equal(attempts, 2);
});

for (const { label, failure } of [
  { label: "an unclassified TypeError", failure: new TypeError("fetch failed") },
  { label: "a failed DNS name lookup", failure: networkError("ENOTFOUND") },
  { label: "an invalid TLS certificate", failure: networkError("CERT_HAS_EXPIRED") },
  {
    label: "an explicit abort with a misleading transient code",
    failure: Object.assign(new Error("Aborted"), { name: "AbortError", code: "ECONNRESET" }),
  },
]) {
  test(`does not retry ${label}`, async () => {
    const fetchMock = mock.fn<typeof fetch>(async () => {
      throw failure;
    });
    const events: FetchEvent[] = [];
    globalThis.fetch = fetchMock;

    await assert.rejects(fetchFeedXml(feedUrl, 30_000, {
      onEvent(event) {
        events.push(event);
      },
    }), (error: unknown) => {
      assert.ok(error instanceof RssFeedFetchError);
      assert.equal(error.attempts, 1);
      return true;
    });

    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(events, []);
  });
}

test("requires every AggregateError branch to be transient before retrying", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  const aggregate = new TypeError("fetch failed", {
    cause: new AggregateError([
      networkError("ECONNRESET"),
      networkError("ETIMEDOUT"),
    ], "All addresses failed"),
  });
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) {
      throw aggregate;
    }
    return new Response(xml);
  };

  const request = fetchFeedXml(feedUrl);
  await settle();
  context.mock.timers.tick(RSS_FEED_FETCH_RETRY_DELAY_MS);
  assert.equal(await request, xml);
  assert.equal(attempts, 2);

  globalThis.fetch = async () => {
    attempts++;
    throw new AggregateError([
      networkError("ECONNRESET"),
      networkError("CERT_HAS_EXPIRED"),
    ], "Mixed failure");
  };

  await assert.rejects(fetchFeedXml(feedUrl), (error: unknown) => {
    assert.ok(error instanceof RssFeedFetchError);
    assert.equal(error.attempts, 1);
    assert.ok(error.cause instanceof AggregateError);
    return true;
  });
  assert.equal(attempts, 3);
});

for (const status of [408, 500, 502, 503, 504]) {
  test(`retries HTTP ${status} once and cancels its unsuccessful response body`, async (context) => {
    context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
    const response = new Response("Unavailable", { status });
    assert.ok(response.body);
    const cancel = mock.method(response.body, "cancel", async () => {});
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      return attempts === 1 ? response : new Response(xml);
    };

    const request = fetchFeedXml(feedUrl);
    await settle();
    assert.equal(cancel.mock.callCount(), 1);
    context.mock.timers.tick(RSS_FEED_FETCH_RETRY_DELAY_MS);

    assert.equal(await request, xml);
    assert.equal(attempts, 2);
  });
}

for (const status of [401, 403, 404, 429, 501]) {
  test(`keeps HTTP ${status} terminal without a retry instruction`, async () => {
    const fetchMock = mock.fn<typeof fetch>(async () => {
      return new Response("Unavailable", { status });
    });
    globalThis.fetch = fetchMock;

    await assert.rejects(fetchFeedXml(`${feedUrl}?paged=2`), (error: unknown) => {
      assert.ok(error instanceof RssFeedHttpError);
      assert.equal(error.status, status);
      assert.equal(error.url, `${feedUrl}?paged=2`);
      assert.equal(error.attempts, 1);
      assert.ok(error.message.replace(error.url, "").includes("paged=2"));
      return true;
    });

    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

test("retains the final HTTP status after exhausting a retry", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  const fetchMock = mock.fn<typeof fetch>(async () => new Response("Unavailable", { status: 503 }));
  globalThis.fetch = fetchMock;

  const request = fetchFeedXml(feedUrl);
  const rejected = assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof RssFeedHttpError);
    assert.equal(error.status, 503);
    assert.equal(error.attempts, 2);
    assert.match(error.message, /2/);
    return true;
  });
  await settle();
  context.mock.timers.tick(RSS_FEED_FETCH_RETRY_DELAY_MS);
  await rejected;
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("keeps cleanup failures from replacing a terminal HTTP status", async () => {
  const response = new Response("Denied", { status: 403 });
  assert.ok(response.body);
  const cancel = mock.method(response.body, "cancel", async () => {
    throw new Error("Cleanup failed");
  });
  globalThis.fetch = async () => response;

  await assert.rejects(fetchFeedXml(feedUrl), (error: unknown) => {
    assert.ok(error instanceof RssFeedHttpError);
    assert.equal(error.status, 403);
    return true;
  });
  assert.equal(cancel.mock.callCount(), 1);
});

for (const retryAfter of [
  "3",
  new Date(clock + 3_000).toUTCString(),
  "Monday, 16-Nov-26 10:00:03 GMT",
  "Mon Nov 16 10:00:03 2026",
]) {
  test(`honors Retry-After ${retryAfter} before HTTP recovery`, async (context) => {
    process.env.TZ = "Europe/Sofia";
    context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
    let attempts = 0;
    const events: FetchEvent[] = [];
    globalThis.fetch = async () => {
      attempts++;
      return attempts === 1
        ? new Response("Busy", { status: 503, headers: { "Retry-After": retryAfter } })
        : new Response(xml);
    };

    const request = fetchFeedXml(feedUrl, 10_000, {
      onEvent(event) {
        events.push(event);
      },
    });
    await settle();
    assert.deepEqual(events[0], {
      type: "retry",
      url: feedUrl,
      attempt: 1,
      nextAttempt: 2,
      delayMs: 3_000,
      reason: "http",
      status: 503,
    });
    context.mock.timers.tick(2_999);
    await settle();
    assert.equal(attempts, 1);
    context.mock.timers.tick(1);

    assert.equal(await request, xml);
    assert.equal(attempts, 2);
  });
}

test("retries HTTP 429 only after a valid Retry-After and the minimum pacing delay", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return attempts === 1
      ? new Response("Rate limited", { status: 429, headers: { "Retry-After": "1" } })
      : new Response(xml);
  };

  const request = fetchFeedXml(feedUrl);
  await settle();
  context.mock.timers.tick(1_999);
  await settle();
  assert.equal(attempts, 1);
  context.mock.timers.tick(1);

  assert.equal(await request, xml);
  assert.equal(attempts, 2);

  globalThis.fetch = async () => {
    attempts++;
    return new Response("Rate limited", { status: 429, headers: { "Retry-After": "invalid" } });
  };
  await assert.rejects(fetchFeedXml(feedUrl), (error: unknown) => {
    assert.ok(error instanceof RssFeedHttpError);
    assert.equal(error.status, 429);
    assert.equal(error.attempts, 1);
    return true;
  });
  assert.equal(attempts, 3);
});

test("declines Retry-After delays that do not fit the remaining deadline", async () => {
  const fetchMock = mock.fn<typeof fetch>(async () => {
    return new Response("Busy", { status: 503, headers: { "Retry-After": "60" } });
  });
  const events: FetchEvent[] = [];
  globalThis.fetch = fetchMock;

  await assert.rejects(fetchFeedXml(feedUrl, 30_000, {
    onEvent(event) {
      events.push(event);
    },
  }), (error: unknown) => {
    assert.ok(error instanceof RssFeedHttpError);
    assert.equal(error.status, 503);
    assert.equal(error.attempts, 1);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(events, []);
});

for (const retryAfter of ["-1", "1.5"]) {
  test(`keeps HTTP 429 terminal for invalid numeric Retry-After ${retryAfter}`, async () => {
    const fetchMock = mock.fn<typeof fetch>(async () => {
      return new Response("Rate limited", { status: 429, headers: { "Retry-After": retryAfter } });
    });
    globalThis.fetch = fetchMock;

    await assert.rejects(fetchFeedXml(feedUrl), (error: unknown) => {
      assert.ok(error instanceof RssFeedHttpError);
      assert.equal(error.status, 429);
      assert.equal(error.attempts, 1);
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

test("interprets an RFC850 year within fifty future years before checking the retry budget", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  const fetchMock = mock.fn<typeof fetch>(async () => {
    return new Response("Busy", {
      status: 503,
      headers: { "Retry-After": "Sunday, 16-Nov-70 10:00:03 GMT" },
    });
  });
  const events: FetchEvent[] = [];
  globalThis.fetch = fetchMock;

  const request = fetchFeedXml(feedUrl, 30_000, {
    onEvent(event) {
      events.push(event);
    },
  });
  const rejected = assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof RssFeedHttpError);
    assert.equal(error.attempts, 1);
    return true;
  });
  await settle();
  context.mock.timers.tick(RSS_FEED_FETCH_RETRY_DELAY_MS);

  await rejected;
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(events, []);
});

test("interprets an RFC850 year beyond the fifty-year future window as a past date", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    return attempts === 1
      ? new Response("Busy", {
        status: 503,
        headers: { "Retry-After": "Wednesday, 16-Nov-77 10:00:03 GMT" },
      })
      : new Response(xml);
  };

  const request = fetchFeedXml(feedUrl);
  await settle();
  context.mock.timers.tick(RSS_FEED_FETCH_RETRY_DELAY_MS);

  assert.equal(await request, xml);
  assert.equal(attempts, 2);
});

test("uses one timeout budget across the first attempt, pacing and response body", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  const signals: AbortSignal[] = [];
  let attempts = 0;
  globalThis.fetch = async (_input, options) => {
    assert.ok(options?.signal);
    const signal = options.signal;
    signals.push(signal);
    attempts++;
    if (attempts === 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1_000);
      });
      throw networkError("ECONNRESET");
    }
    const response = new Response();
    mock.method(response, "text", async () => {
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("Body deadline"), { name: "AbortError" }));
        }, { once: true });
      });
    });
    return response;
  };

  const request = fetchFeedXml(feedUrl, 5_000);
  const rejected = assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof RssFeedFetchError);
    assert.equal(error.attempts, 2);
    return true;
  });
  context.mock.timers.tick(1_000);
  await settle();
  context.mock.timers.tick(2_000);
  await settle();
  assert.equal(attempts, 2);
  context.mock.timers.tick(1_999);
  await settle();
  assert.equal(signals[1]?.aborted, false);
  context.mock.timers.tick(1);

  await rejected;
  assert.equal(signals[1]?.aborted, true);
  assert.equal(signals[0]?.aborted, false);
});

test("enforces the deadline when a response body ignores its abort signal", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  let signal: AbortSignal | undefined;
  const response = new Response();
  mock.method(response, "text", async () => {
    return new Promise<string>(() => {});
  });
  const fetchMock = mock.fn<typeof fetch>(async (_input, options) => {
    signal = options?.signal ?? undefined;
    return response;
  });
  globalThis.fetch = fetchMock;

  const request = fetchFeedXml(feedUrl, 25);
  const rejected = assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof RssFeedFetchError);
    assert.equal(error.attempts, 1);
    assert.equal(error.timedOut, true);
    return true;
  });
  await settle();
  context.mock.timers.tick(24);
  assert.equal(signal?.aborted, false);
  context.mock.timers.tick(1);

  await rejected;
  assert.equal(signal?.aborted, true);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("rejects XML completed after the deadline before its timer callback runs", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  const response = new Response();
  mock.method(response, "text", async () => {
    mock.method(Date, "now", () => clock + 26);
    return xml;
  });
  const fetchMock = mock.fn<typeof fetch>(async () => response);
  globalThis.fetch = fetchMock;

  await assert.rejects(fetchFeedXml(feedUrl, 25), (error: unknown) => {
    assert.ok(error instanceof RssFeedFetchError);
    assert.equal(error.attempts, 1);
    assert.equal(error.timedOut, true);
    return true;
  });

  assert.equal(fetchMock.mock.callCount(), 1);
});

test("does not read a response arriving after a fetch has timed out", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  const response = new Response(xml);
  const readBody = mock.method(response, "text");
  let signal: AbortSignal | undefined;
  globalThis.fetch = async (_input, options) => {
    signal = options?.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      setTimeout(() => {
        resolve(response);
      }, 35);
    });
  };

  const request = fetchFeedXml(feedUrl, 25);
  const rejected = assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof RssFeedFetchError);
    assert.equal(error.attempts, 1);
    assert.equal(error.timedOut, true);
    return true;
  });
  context.mock.timers.tick(25);
  await rejected;
  context.mock.timers.tick(10);
  await settle();

  assert.equal(signal?.aborted, true);
  assert.equal(readBody.mock.callCount(), 0);
});

test("does not start another attempt when pacing would exhaust the total budget", async () => {
  const fetchMock = mock.fn<typeof fetch>(async () => {
    throw networkError("ECONNRESET");
  });
  const events: FetchEvent[] = [];
  globalThis.fetch = fetchMock;

  await assert.rejects(fetchFeedXml(feedUrl, RSS_FEED_FETCH_RETRY_DELAY_MS, {
    onEvent(event) {
      events.push(event);
    },
  }), (error: unknown) => {
    assert.ok(error instanceof RssFeedFetchError);
    assert.equal(error.attempts, 1);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(events, []);
});

test("does not begin a delayed retry after the total deadline has elapsed", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  const fetchMock = mock.fn<typeof fetch>(async () => {
    throw networkError("ECONNRESET");
  });
  globalThis.fetch = fetchMock;

  const request = fetchFeedXml(feedUrl, 5_000);
  const rejected = assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof RssFeedFetchError);
    assert.equal(error.attempts, 1);
    return true;
  });
  await settle();
  context.mock.timers.tick(5_000);

  await rejected;
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("keeps unsuccessful RSS validation terminal", async () => {
  const fetchMock = mock.fn<typeof fetch>(async () => new Response("<html>Provider error</html>"));
  globalThis.fetch = fetchMock;

  await assert.rejects(fetchFeedXml(feedUrl), /does not look like RSS/);

  assert.equal(fetchMock.mock.callCount(), 1);
});

test("redacts diagnostic URLs and nested causes while retaining safe pagination", async () => {
  const privateUrl = "https://reader:password@example.com/feed/?token=private-token&paged=2&format=feed&type=rss&start=0&person=private-person#private-fragment";
  const original = new TypeError(`fetch failed for ${privateUrl}`, {
    cause: Object.assign(new Error(`DNS failed for ${privateUrl}`), {
      code: "ENOTFOUND",
      errno: -3008,
      syscall: "getaddrinfo",
      authorization: "do-not-forward",
    }),
  });
  const fetchMock = mock.fn<typeof fetch>(async (input) => {
    assert.equal(input, privateUrl);
    throw original;
  });
  globalThis.fetch = fetchMock;

  await assert.rejects(fetchFeedXml(privateUrl), (error: unknown) => {
    assert.ok(error instanceof RssFeedFetchError);
    const diagnosticUrl = new URL(error.url);
    assert.equal(diagnosticUrl.username, "");
    assert.equal(diagnosticUrl.password, "");
    assert.equal(diagnosticUrl.hash, "");
    assert.deepEqual([...diagnosticUrl.searchParams], [
      ["paged", "2"],
      ["format", "feed"],
      ["type", "rss"],
      ["start", "0"],
    ]);
    assert.ok(error.message.replace(error.url, "").includes("paged=2"));
    assert.ok(error.cause instanceof Error);
    assert.notEqual(error.cause, original);
    assert.equal(error.cause.name, "TypeError");
    assert.ok(error.cause.cause instanceof Error);
    assert.equal(Reflect.get(error.cause.cause, "code"), "ENOTFOUND");
    assert.equal(Reflect.get(error.cause.cause, "errno"), -3008);
    assert.equal(Reflect.get(error.cause.cause, "syscall"), "getaddrinfo");
    const diagnostic = inspect(error, { depth: 20 });
    for (const secret of ["reader:", "password", "private-token", "private-person", "private-fragment", "do-not-forward"]) {
      assert.ok(!diagnostic.includes(secret));
    }
    return true;
  });

  assert.equal(fetchMock.mock.callCount(), 1);
  assert.ok(original.message.includes("password"));
});

test("drops unrecognized query values and preserves bounded cyclic diagnostics", async () => {
  const cyclic = new Error("Cyclic failure");
  cyclic.cause = cyclic;
  const privateUrl = "https://example.com/feed/?paged=2&page=private&format=private&type=private&feed=private&token=private";
  globalThis.fetch = async () => {
    throw cyclic;
  };

  await assert.rejects(fetchFeedXml(privateUrl), (error: unknown) => {
    assert.ok(error instanceof RssFeedFetchError);
    assert.equal(error.url, `${feedUrl}?paged=2`);
    const seen = new Set<object>();
    let current: unknown = error;
    while (current !== null && typeof current === "object") {
      assert.ok(!seen.has(current));
      seen.add(current);
      current = Reflect.get(current, "cause");
    }
    assert.ok(seen.size < 10);
    return true;
  });
});

test("keeps sensitive request data out of status-bearing HTTP errors", async () => {
  const privateUrl = "https://reader:password@example.com/feed/?paged=2&token=private-token#private-fragment";
  globalThis.fetch = async (input) => {
    assert.equal(input, privateUrl);
    return new Response("Denied", { status: 403 });
  };

  await assert.rejects(fetchFeedXml(privateUrl), (error: unknown) => {
    assert.ok(error instanceof RssFeedHttpError);
    assert.equal(error.status, 403);
    assert.equal(error.url, `${feedUrl}?paged=2`);
    const diagnostic = inspect(error, { depth: 5 });
    for (const secret of ["reader:", "password", "private-token", "private-fragment"]) {
      assert.ok(!diagnostic.includes(secret));
    }
    return true;
  });
});

test("keeps retry observer exceptions from changing successful collection", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  let attempts = 0;
  const events: FetchEvent[] = [];
  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) {
      throw networkError("EAI_AGAIN");
    }
    return new Response(xml);
  };

  const request = fetchFeedXml(feedUrl, 30_000, {
    onEvent(event) {
      events.push(event);
      throw new Error("Observer failed");
    },
  });
  await settle();
  context.mock.timers.tick(RSS_FEED_FETCH_RETRY_DELAY_MS);

  assert.equal(await request, xml);
  assert.deepEqual(events.map((event) => event.type), ["retry", "recovered"]);
});

test("handles rejected observer promises without losing recovery", async (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) {
      throw networkError("ECONNREFUSED");
    }
    return new Response(xml);
  };

  const request = fetchFeedXml(feedUrl, 30_000, {
    async onEvent() {
      throw new Error("Async observer failed");
    },
  });
  await settle();
  context.mock.timers.tick(RSS_FEED_FETCH_RETRY_DELAY_MS);

  assert.equal(await request, xml);
  await settle();
  assert.equal(attempts, 2);
});

test("exposes matching CommonJS retry constants and diagnostic error classes", async () => {
  const require = createRequire(import.meta.url);
  const commonJs = require("../dist/cjs/rss.js") as typeof import("../dist/esm/rss.js");
  assert.equal(commonJs.RSS_FEED_FETCH_MAX_ATTEMPTS, RSS_FEED_FETCH_MAX_ATTEMPTS);
  assert.equal(commonJs.RSS_FEED_FETCH_RETRY_DELAY_MS, RSS_FEED_FETCH_RETRY_DELAY_MS);
  globalThis.fetch = async () => {
    throw new Error("Unknown transport failure");
  };

  await assert.rejects(commonJs.fetchFeedXml(feedUrl), (error: unknown) => {
    assert.ok(error instanceof commonJs.RssFeedFetchError);
    assert.equal(error.url, feedUrl);
    assert.equal(error.attempts, 1);
    return true;
  });
});
