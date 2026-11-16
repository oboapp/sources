import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CreateSource } from "@oboapp/source-sdk";
import { createHybridSource } from "../dist/esm/hybrid.js";
import { createSource, type SourceOptions } from "../dist/esm/index.js";

const feedUrl = "https://rayon-oborishte.bg/feed/";
const postsUrl =
  "https://rayon-oborishte.bg/wp-json/wp/v2/posts?per_page=10&orderby=date&order=desc";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
});

const posts = [
  {
    link: "https://rayon-oborishte.bg/Auction%2fPost/?x=1&y=2",
    title: { rendered: "<strong>Auction</strong> &amp; &lt;public&gt;" },
    date_gmt: "2026-07-09T07:06:01",
    date: "2026-07-09T10:06:01",
    categories: [21],
  },
  {
    link: "https://rayon-oborishte.bg/Traffic%2Fnotice/",
    title: { rendered: "Traffic &#8220;notice&#8221;" },
    date_gmt: "2026-11-16T08:02:49",
    date: "2026-11-16T10:02:49",
    categories: [1, 40],
  },
];
const expectedItems = [
  {
    identifier: posts[0]!.link,
    payload: { title: "Auction & <public>", date: "2026-07-09T07:06:01.000Z" },
  },
  {
    identifier: posts[1]!.link,
    payload: { title: "Traffic “notice”", date: "2026-11-16T08:02:49.000Z" },
  },
];
const xml = `<rss><channel>${expectedItems.map((item) => {
  const link = item.identifier.replaceAll("&", "&amp;");
  const date = new Date(item.payload.date).toUTCString();
  return `<item><title><![CDATA[${item.payload.title}]]></title><link>${link}</link><pubDate>${date}</pubDate></item>`;
}).join("")}</channel></rss>`;

function discoveryFixture(options: SourceOptions = {}) {
  const launchBrowser = mock.fn(async () => {
    throw new Error("Discovery launched a browser");
  });
  const delay = mock.fn(async () => {
  });
  return { launchBrowser, delay, source: createHybridSource({ launchBrowser, delay }, options) };
}

test("root RSS keeps auctions and traffic notices outside the repairs category", async () => {
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    assert.equal(String(input), feedUrl);
    return new Response(xml);
  };
  const onRssFailure = mock.fn();
  const fixture = discoveryFixture({ onRssFailure });

  assert.deepEqual((await fixture.source.discoverItems()).items, expectedItems);
  assert.deepEqual(requests, [feedUrl]);
  assert.equal(fixture.delay.mock.callCount(), 0);
  assert.equal(onRssFailure.mock.callCount(), 0);
  assert.equal(fixture.launchBrowser.mock.callCount(), 0);
});

test("HTTP 415 uses the unfiltered API after a delay and preserves RSS identity and dates", async () => {
  const timeout = mock.method(AbortSignal, "timeout");
  const events: string[] = [];
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    events.push(url);
    if (url === feedUrl) {
      return new Response("unsupported", { status: 415 });
    }
    assert.equal(url, postsUrl);
    assert.equal(options?.headers && new Headers(options.headers).get("Accept"), "application/json");
    assert.match(new Headers(options?.headers).get("User-Agent") ?? "", /oboapp-crawler/);
    assert.ok(options?.signal instanceof AbortSignal);
    return Response.json([...posts, posts[0]]);
  };
  const fixture = discoveryFixture();
  fixture.delay.mock.mockImplementation(async () => {
    events.push("delay");
  });

  assert.deepEqual((await fixture.source.discoverItems()).items, expectedItems);
  assert.deepEqual(events, [feedUrl, "delay", postsUrl]);
  assert.equal(fixture.delay.mock.callCount(), 1);
  assert.deepEqual(timeout.mock.calls[0]?.arguments, [30_000]);
  assert.equal(fixture.launchBrowser.mock.callCount(), 0);
});

test("provider auction and traffic fixtures remain discoverable outside category 54", async () => {
  const providerPosts = JSON.parse(readFileSync(
    new URL("./fixtures/discovery-posts.json", import.meta.url),
    "utf8",
  )) as typeof posts;
  globalThis.fetch = async (input) => {
    if (String(input) === feedUrl) {
      return new Response("unsupported", { status: 415 });
    }
    return Response.json(providerPosts);
  };
  const fixture = discoveryFixture();

  assert.deepEqual((await fixture.source.discoverItems()).items, [
    {
      identifier: providerPosts[0]!.link,
      payload: {
        title: "ОБЯВЛЕНИЕ ЗА ПУБЛИЧНО ОПОВЕСТЕН КОНКУРС",
        date: "2026-07-09T07:06:01.000Z",
      },
    },
    {
      identifier: providerPosts[1]!.link,
      payload: {
        title: "Уведомление за временни ограничения в движението на територията на района",
        date: "2026-11-16T08:02:49.000Z",
      },
    },
  ]);
  assert.equal(fixture.launchBrowser.mock.callCount(), 0);
});

test("all thrown RSS failures report once and recover through the API", async () => {
  const networkCause = new Error("ECONNRESET");
  const networkError = new Error("socket closed", { cause: networkCause });
  const cases = [
    { response: new Response("unsupported", { status: 415 }), message: /415/ },
    { response: new Response("missing", { status: 404 }), message: /404/ },
    { response: new Response("unavailable", { status: 503 }), message: /503/ },
    { response: new Response("not RSS"), message: /does not look like RSS/ },
    { error: networkError, message: /socket closed/ },
  ];
  for (const example of cases) {
    const requests: string[] = [];
    globalThis.fetch = async (input) => {
      requests.push(String(input));
      if (String(input) === feedUrl) {
        if (example.error) {
          throw example.error;
        }
        return example.response!;
      }
      return Response.json(posts);
    };
    const onRssFailure = mock.fn();
    const fixture = discoveryFixture({ onRssFailure });

    assert.deepEqual((await fixture.source.discoverItems()).items, expectedItems);
    assert.deepEqual(requests, [feedUrl, postsUrl]);
    assert.equal(onRssFailure.mock.callCount(), 1);
    const reportedError = onRssFailure.mock.calls[0]?.arguments[0];
    assert.ok(reportedError instanceof Error);
    assert.match(reportedError.message, example.message);
    if (example.error) {
      assert.equal(reportedError, networkError);
      assert.equal(reportedError.cause, networkCause);
    }
    assert.equal(fixture.delay.mock.callCount(), 1);
    assert.equal(fixture.launchBrowser.mock.callCount(), 0);
  }
});

test("RSS failure reporting runs before delay and API recovery", async () => {
  const originalError = new Error("RSS request failed");
  const events: string[] = [];
  globalThis.fetch = async (input) => {
    if (String(input) === feedUrl) {
      events.push("rss");
      throw originalError;
    }
    events.push("api");
    return Response.json(posts);
  };
  const onRssFailure = mock.fn(async (error: unknown) => {
    assert.equal(error, originalError);
    await Promise.resolve();
    events.push("report");
  });
  const fixture = discoveryFixture({ onRssFailure });
  fixture.delay.mock.mockImplementation(async () => {
    events.push("delay");
  });

  assert.deepEqual((await fixture.source.discoverItems()).items, expectedItems);
  assert.deepEqual(events, ["rss", "report", "delay", "api"]);
  assert.equal(onRssFailure.mock.callCount(), 1);
});

test("throwing and rejected reporting callbacks cannot block API recovery", async () => {
  const callbacks = [
    () => {
      throw new Error("reporting threw");
    },
    async () => {
      throw new Error("reporting rejected");
    },
  ];
  for (const callback of callbacks) {
    globalThis.fetch = async (input) => {
      if (String(input) === feedUrl) {
        return new Response("unavailable", { status: 503 });
      }
      return Response.json(posts);
    };
    const onRssFailure = mock.fn(callback);
    const fixture = discoveryFixture({ onRssFailure });

    assert.deepEqual((await fixture.source.discoverItems()).items, expectedItems);
    assert.equal(onRssFailure.mock.callCount(), 1);
    assert.equal(fixture.delay.mock.callCount(), 1);
    assert.equal(fixture.launchBrowser.mock.callCount(), 0);
  }
});

test("combined failures retain the original RSS error and API failure", async () => {
  const originalError = new Error("RSS network failure", { cause: new Error("DNS unavailable") });
  globalThis.fetch = async (input) => {
    if (String(input) === feedUrl) {
      throw originalError;
    }
    return new Response("unavailable", { status: 503 });
  };
  const onRssFailure = mock.fn();
  const fixture = discoveryFixture({ onRssFailure });

  await assert.rejects(fixture.source.discoverItems(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes("RSS network failure"));
    assert.ok(error.message.includes(`503 for ${postsUrl}`));
    assert.ok(error.cause instanceof AggregateError);
    assert.equal(error.cause.errors[0], originalError);
    assert.equal(error.cause.errors[0], onRssFailure.mock.calls[0]?.arguments[0]);
    assert.match(error.cause.errors[1].message, /WordPress posts API returned 503/);
    return true;
  });
  assert.equal(onRssFailure.mock.callCount(), 1);
  assert.equal(fixture.launchBrowser.mock.callCount(), 0);
});

test("a valid empty RSS feed neither reports a failure nor invokes the API", async () => {
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response("<rss><channel></channel></rss>");
  };
  const onRssFailure = mock.fn();
  const fixture = discoveryFixture({ onRssFailure });

  assert.deepEqual((await fixture.source.discoverItems()).items, []);
  assert.deepEqual(requests, [feedUrl]);
  assert.equal(onRssFailure.mock.callCount(), 0);
  assert.equal(fixture.delay.mock.callCount(), 0);
});

test("the public factory remains SDK compatible and forwards reporting options", async () => {
  const sdkFactory: CreateSource = createSource;
  const sdkSource = await sdkFactory({ locality: "bg.sofia" });
  await sdkSource.close?.();
  const originalError = new Error("RSS unavailable");
  globalThis.fetch = async (input) => {
    if (String(input) === feedUrl) {
      throw originalError;
    }
    return Response.json([]);
  };
  const onRssFailure = mock.fn();
  const source = createSource({ locality: "bg.sofia" }, { onRssFailure });

  assert.deepEqual((await source.discoverItems()).items, []);
  assert.equal(onRssFailure.mock.callCount(), 1);
  assert.equal(onRssFailure.mock.calls[0]?.arguments[0], originalError);
  await source.close?.();
});

test("title cleanup handles quoted tag attributes and unmatched angle brackets", async () => {
  for (const [rendered, title] of [
    ['<span title="1 > 0">Auction</span> &lt;public&gt;', "Auction <public>"],
    ["<".repeat(100_000), "<".repeat(100_000)],
  ]) {
    globalThis.fetch = async (input) => {
      if (String(input) === feedUrl) {
        return new Response("unsupported", { status: 415 });
      }
      return Response.json([{ ...posts[0], title: { rendered } }]);
    };
    const fixture = discoveryFixture();

    assert.deepEqual((await fixture.source.discoverItems()).items[0], {
      identifier: posts[0]!.link,
      payload: { title, date: "2026-07-09T07:06:01.000Z" },
    });
    assert.equal(fixture.launchBrowser.mock.callCount(), 0);
  }
});

test("failed API requests expose both the original 415 and concrete fallback details", async () => {
  for (const failure of [
    async () => new Response("unsupported", { status: 415 }),
    async () => new Response("unavailable", { status: 503 }),
    async () => {
      throw new Error("request timed out");
    },
    async () => new Response("not JSON"),
  ]) {
    const requests: string[] = [];
    globalThis.fetch = async (input) => {
      requests.push(String(input));
      if (String(input) === feedUrl) {
        return new Response("unsupported", { status: 415 });
      }
      return failure();
    };
    const fixture = discoveryFixture();

    await assert.rejects(fixture.source.discoverItems(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(`415 for ${feedUrl}`));
      assert.ok(error.message.includes(postsUrl));
      assert.match(error.message, /WordPress posts API returned (415|503)|request timed out|invalid JSON/);
      assert.ok(error.cause instanceof Error);
      return true;
    });
    assert.deepEqual(requests, [feedUrl, postsUrl]);
    assert.equal(fixture.launchBrowser.mock.callCount(), 0);
  }
});

test("malformed API metadata fails the whole discovery before details", async () => {
  const invalidPayloads: unknown[] = [
    {},
    [null],
    [{ ...posts[0], link: "not a URL" }],
    [{ ...posts[0], link: "https://example.com/post/" }],
    [{ ...posts[0], link: "http://rayon-oborishte.bg/post/" }],
    [{ ...posts[0], link: "https://rayon-oborishte.bg:8443/post/" }],
    [{ ...posts[0], link: "https://user:password@rayon-oborishte.bg/post/" }],
    [{ ...posts[0], title: { rendered: "<em></em>" } }],
    [{ ...posts[0], date_gmt: "2026-11-16T08:02:49Z" }],
    [{ ...posts[0], date_gmt: "2026-02-31T08:02:49" }],
    [{ ...posts[0], date_gmt: "2026-99-99T08:02:49" }],
    Array.from({ length: 11 }, () => posts[0]),
  ];
  for (const payload of invalidPayloads) {
    globalThis.fetch = async (input) => {
      if (String(input) === feedUrl) {
        return new Response("unsupported", { status: 415 });
      }
      return Response.json(payload);
    };
    const fixture = discoveryFixture();

    await assert.rejects(fixture.source.discoverItems(), /415.*WordPress fallback failed:.*invalid/);
    assert.equal(fixture.launchBrowser.mock.callCount(), 0);
  }
});

test("an empty API response is a successful empty discovery", async () => {
  globalThis.fetch = async (input) => {
    if (String(input) === feedUrl) {
      return new Response("unsupported", { status: 415 });
    }
    return Response.json([]);
  };
  const fixture = discoveryFixture();

  assert.deepEqual((await fixture.source.discoverItems()).items, []);
  assert.equal(fixture.launchBrowser.mock.callCount(), 0);
});
