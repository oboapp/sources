import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, beforeEach, mock, test } from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { inspect } from "node:util";
import type { CreateSource } from "@oboapp/source-sdk";
import { RssFeedFetchError } from "@oboapp/source-web-utils/rss";
import {
  createSource,
  type RssFeedFetchEvent,
  type RssFeedFetchOptions,
} from "../dist/esm/index.js";

const originalFetch = globalThis.fetch;
const context = { locality: "bg.sofia" };
const feedUrl = "https://lozenets.sofia.bg/category/%d0%bd%d0%be%d0%b2%d0%b8%d0%bd%d0%b8/feed/";
const identifier = "https://lozenets.sofia.bg/Test%2fPost/?x=1&y=2#notice";
const clock = Date.parse("2026-11-16T10:00:00Z");
const retryDelayMs = 2_000;
const consumerRequire = createRequire(import.meta.url);
const helperRequire = createRequire(consumerRequire.resolve("@oboapp/source-web-utils/browser"));
const { chromium } = helperRequire("playwright") as typeof import("playwright");
let browserLaunches = 0;

function feed(): string {
  return `<rss><channel>
    <item><title>Road &amp; water</title><link><![CDATA[${identifier}]]></link>
      <pubDate>Tue, 09 Jun 2026 11:13:10 +0000</pubDate></item>
    <item><title>Later duplicate</title><link><![CDATA[${identifier}]]></link>
      <pubDate>Mon, 08 Jun 2026 11:13:10 +0000</pubDate></item>
  </channel></rss>`;
}

function resetConnection(): TypeError {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("Connection reset for https://reader:password@lozenets.sofia.bg/feed/?token=private-token"), {
      code: "ECONNRESET",
    }),
  });
}

beforeEach(() => {
  browserLaunches = 0;
  mock.method(chromium, "launch", async () => {
    browserLaunches++;
    throw new Error("RSS discovery must not open Chromium");
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
  assert.equal(browserLaunches, 0);
});

test("the public factory reports feed recovery and retains literal identifiers on repeated scans", async (testContext) => {
  testContext.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  let attempts = 0;
  const events: RssFeedFetchEvent[] = [];
  const fetchMock = mock.fn<typeof fetch>(async (input) => {
    assert.equal(input, feedUrl);
    attempts++;
    if (attempts === 1) {
      throw resetConnection();
    }
    return new Response(feed());
  });
  globalThis.fetch = fetchMock;
  const source = await createSource(context, {
    onEvent(event) {
      events.push(event);
    },
  });

  try {
    const discovery = source.discoverItems();
    await settle();
    testContext.mock.timers.tick(retryDelayMs - 1);
    await settle();
    assert.equal(fetchMock.mock.callCount(), 1);
    testContext.mock.timers.tick(1);

    const firstPage = await discovery;
    assert.deepEqual(firstPage, {
      items: [{
        identifier,
        payload: { title: "Road & water", date: "2026-06-09T11:13:10.000Z" },
      }],
    });
    assert.equal(fetchMock.mock.callCount(), 2);
    assert.deepEqual(events, [{
      type: "retry",
      url: feedUrl,
      attempt: 1,
      nextAttempt: 2,
      delayMs: retryDelayMs,
      reason: "network",
      code: "ECONNRESET",
    }, {
      type: "recovered",
      url: feedUrl,
      attempts: 2,
    }]);
    assert.deepEqual(await source.discoverItems(), firstPage);
    assert.equal(fetchMock.mock.callCount(), 3);
    assert.equal(events.length, 2);
    assert.equal(browserLaunches, 0);
  } finally {
    await source.close?.();
  }
});

test("the public factory retains feed and attempt context with a safe nested failure cause", async (testContext) => {
  testContext.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  const events: RssFeedFetchEvent[] = [];
  const fetchMock = mock.fn<typeof fetch>(async () => {
    throw resetConnection();
  });
  globalThis.fetch = fetchMock;
  const source = await createSource(context, {
    onEvent(event) {
      events.push(event);
    },
  });

  try {
    const rejected = assert.rejects(source.discoverItems(), (error: unknown) => {
      assert.ok(error instanceof RssFeedFetchError);
      assert.equal(error.url, feedUrl);
      assert.equal(error.attempts, 2);
      assert.ok(error.message.includes(feedUrl));
      assert.ok(error.cause instanceof Error);
      const diagnostic = inspect(error, { depth: 10 });
      assert.ok(diagnostic.includes("ECONNRESET"));
      for (const secret of ["reader:", "password", "private-token"]) {
        assert.ok(!diagnostic.includes(secret));
      }
      return true;
    });
    await settle();
    testContext.mock.timers.tick(retryDelayMs);

    await rejected;
    assert.equal(fetchMock.mock.callCount(), 2);
    assert.deepEqual(events.map((event) => event.type), ["retry"]);
  } finally {
    await source.close?.();
  }
});

for (const { label, status, body, expectedError } of [
  { label: "HTTP 403", status: 403, body: "Access denied", expectedError: /403/ },
  { label: "successful HTML", status: 200, body: "<html>Access denied</html>", expectedError: /does not look like RSS/ },
]) {
  test(`the public factory keeps ${label} terminal`, async () => {
    const events: RssFeedFetchEvent[] = [];
    const fetchMock = mock.fn<typeof fetch>(async () => new Response(body, { status }));
    globalThis.fetch = fetchMock;
    const source = await createSource(context, {
      onEvent(event) {
        events.push(event);
      },
    });

    try {
      await assert.rejects(source.discoverItems(), expectedError);

      assert.equal(fetchMock.mock.callCount(), 1);
      assert.deepEqual(events, []);
    } finally {
      await source.close?.();
    }
  });
}

for (const rejectAsynchronously of [false, true]) {
  test(`feed observers cannot prevent public discovery (${rejectAsynchronously ? "rejected promise" : "throw"})`, async (testContext) => {
    testContext.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
    let attempts = 0;
    const events: RssFeedFetchEvent[] = [];
    globalThis.fetch = async () => {
      attempts++;
      if (attempts === 1) {
        throw resetConnection();
      }
      return new Response(feed());
    };
    const options: RssFeedFetchOptions = {
      onEvent(event) {
        events.push(event);
        if (rejectAsynchronously) {
          return Promise.reject(new Error("Observer failed"));
        }
        throw new Error("Observer failed");
      },
    };
    const source = await createSource(context, options);

    try {
      const discovery = source.discoverItems();
      await settle();
      testContext.mock.timers.tick(retryDelayMs);

      assert.equal((await discovery).items[0]?.identifier, identifier);
      await settle();
      assert.equal(attempts, 2);
      assert.deepEqual(events.map((event) => event.type), ["retry", "recovered"]);
    } finally {
      await source.close?.();
    }
  });
}

test("keeps observer recovery events inside their source instance", async (testContext) => {
  testContext.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  const firstEvents: RssFeedFetchEvent[] = [];
  const secondEvents: RssFeedFetchEvent[] = [];
  let rejectNextRequest = false;
  globalThis.fetch = async () => {
    if (rejectNextRequest) {
      rejectNextRequest = false;
      throw resetConnection();
    }
    return new Response(feed());
  };
  const firstSource = await createSource(context, {
    onEvent(event) {
      firstEvents.push(event);
    },
  });
  const secondSource = await createSource(context, {
    onEvent(event) {
      secondEvents.push(event);
    },
  });

  try {
    rejectNextRequest = true;
    const firstDiscovery = firstSource.discoverItems();
    await settle();
    testContext.mock.timers.tick(retryDelayMs);
    assert.equal((await firstDiscovery).items[0]?.identifier, identifier);
    assert.deepEqual(firstEvents.map((event) => event.type), ["retry", "recovered"]);
    assert.equal(secondEvents.length, 0);

    assert.equal((await secondSource.discoverItems()).items[0]?.identifier, identifier);
    assert.equal(secondEvents.length, 0);
    assert.equal(firstEvents.length, 2);

    rejectNextRequest = true;
    const secondDiscovery = secondSource.discoverItems();
    await settle();
    testContext.mock.timers.tick(retryDelayMs);
    assert.equal((await secondDiscovery).items[0]?.identifier, identifier);
    assert.deepEqual(secondEvents.map((event) => event.type), ["retry", "recovered"]);
    assert.equal(firstEvents.length, 2);

    const defaultSource = await createSource(context);
    try {
      assert.equal((await defaultSource.discoverItems()).items[0]?.identifier, identifier);
      assert.equal(firstEvents.length, 2);
      assert.equal(secondEvents.length, 2);
    } finally {
      await defaultSource.close?.();
    }

    rejectNextRequest = true;
    const laterDiscovery = firstSource.discoverItems();
    await settle();
    testContext.mock.timers.tick(retryDelayMs);
    assert.equal((await laterDiscovery).items[0]?.identifier, identifier);
    assert.deepEqual(firstEvents.map((event) => event.type), ["retry", "recovered", "retry", "recovered"]);
    assert.equal(secondEvents.length, 2);
  } finally {
    await firstSource.close?.();
    await secondSource.close?.();
  }
});

test("CommonJS exposes the same optional observer and remains SDK-factory compatible", async (testContext) => {
  testContext.mock.timers.enable({ apis: ["Date", "setTimeout"], now: clock });
  const commonJs = consumerRequire("../dist/cjs/index.js") as typeof import("../dist/esm/index.js");
  const sdkFactory: CreateSource = commonJs.createSource;
  const events: RssFeedFetchEvent[] = [];
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) {
      throw resetConnection();
    }
    return new Response(feed());
  };
  const source = await commonJs.createSource(context, {
    onEvent(event) {
      events.push(event);
    },
  });

  try {
    const discovery = source.discoverItems();
    await settle();
    testContext.mock.timers.tick(retryDelayMs);

    assert.equal((await discovery).items[0]?.identifier, identifier);
    assert.equal(attempts, 2);
    assert.deepEqual(events.map((event) => event.type), ["retry", "recovered"]);
  } finally {
    await source.close?.();
  }

  const defaultSource = await sdkFactory(context);
  try {
    assert.equal((await defaultSource.discoverItems()).items[0]?.identifier, identifier);
    assert.equal(attempts, 3);
    assert.equal(events.length, 2);
  } finally {
    await defaultSource.close?.();
  }
});
