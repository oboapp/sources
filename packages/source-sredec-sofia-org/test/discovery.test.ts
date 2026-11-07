import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RssFeedHttpError } from "@oboapp/source-web-utils/rss";
import {
  discoverRecentItems,
  extractFeedItems,
  FEED_URLS,
  type DiscoveryDependencies,
} from "../dist/esm/discovery.js";

const emptyFeed = "<rss><channel></channel></rss>";
const now = () => new Date("2026-10-26T12:00:00Z");
const noDelay = async () => {};

function feed(name: string, date = "2026-09-08T08:00:00Z"): string {
  return `<rss><channel><item><title>${name}</title>
    <link>https://sredec-sofia.org/${name}/</link><pubDate>${date}</pubDate>
    </item></channel></rss>`;
}

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

test("paginates all five feeds, preserves their order, and delays every request", async () => {
  const requests: string[] = [];
  const timeline: string[] = [];
  const fetchFeed: DiscoveryDependencies["fetchFeed"] = async (url) => {
    requests.push(url);
    timeline.push("fetch");
    const parsed = new URL(url);
    const category = decodeURIComponent(parsed.pathname);
    if (category.includes("saobshtenia")) {
      return parsed.search ? emptyFeed : feed("graffiti");
    }
    if (!category.includes("новини")) {
      return emptyFeed;
    }
    if (parsed.searchParams.get("paged") === "3") {
      return emptyFeed;
    }
    return parsed.search ? feed("graffiti") : feed("washing");
  };
  const delay = mock.fn(async (milliseconds: number) => {
    assert.equal(milliseconds, 2000);
    timeline.push("delay");
  });

  const items = await discoverRecentItems({ fetchFeed, delay, now });

  assert.deepEqual(items.map((item) => item.title), ["washing", "graffiti"]);
  assert.deepEqual(items.map((item) => item.url), [
    "https://sredec-sofia.org/washing/",
    "https://sredec-sofia.org/graffiti/",
  ]);
  assert.equal(items[1]?.date, "2026-09-08T08:00:00.000Z");
  assert.equal(requests.length, 8);
  assert.equal(delay.mock.callCount(), 8);
  assert.deepEqual(timeline, Array.from({ length: 8 }, () => ["delay", "fetch"]).flat());
  for (const url of FEED_URLS) {
    assert.ok(requests.includes(new URL(url).toString()));
  }
  assert.equal(requests[0], "https://sredec-sofia.org/category/%D0%BF%D1%83%D0%B1%D0%BB%D0%B8%D0%BA%D0%B0%D1%86%D0%B8%D0%B8/%D0%BF%D0%BE%D0%BB%D0%B5%D0%B7%D0%BD%D0%B0-%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D1%8F/feed/");
});

test("retains the first category's metadata for a shared identifier", async () => {
  const first = feed("shared").replace("<title>shared</title>", "<title>First category</title>");
  const second = feed("shared", "2026-09-09T08:00:00Z");
  const fetchFeed = async (url: string) => {
    const parsed = new URL(url);
    if (parsed.search) {
      return emptyFeed;
    }
    if (parsed.pathname === new URL(FEED_URLS[0]!).pathname) {
      return first;
    }
    if (parsed.pathname === new URL(FEED_URLS[1]!).pathname) {
      return second;
    }
    return emptyFeed;
  };

  assert.deepEqual(await discoverRecentItems({ fetchFeed, delay: noDelay, now }), [{
    url: "https://sredec-sofia.org/shared/",
    title: "First category",
    date: "2026-09-08T08:00:00.000Z",
    contentHtml: undefined,
  }]);
});

test("retains the last same-page entry's metadata for a duplicate identifier", async () => {
  const firstPage = `<rss><channel>
    <item><title>First entry</title><link>https://sredec-sofia.org/shared/</link>
      <pubDate>2026-09-08T08:00:00Z</pubDate></item>
    <item><title>Last entry</title><link>https://sredec-sofia.org/shared/</link>
      <pubDate>2026-09-09T09:00:00Z</pubDate></item>
  </channel></rss>`;
  let requests = 0;
  const fetchFeed = async () => {
    requests++;
    return requests === 1 ? firstPage : emptyFeed;
  };

  const items = await discoverRecentItems({ fetchFeed, delay: noDelay, now });

  assert.deepEqual(items, [{
    url: "https://sredec-sofia.org/shared/",
    title: "Last entry",
    date: "2026-09-09T09:00:00.000Z",
    contentHtml: undefined,
  }]);
  assert.equal(requests, 6);
});

test("uses the strict midnight UTC age cutoff and retains newer items on the same page", async () => {
  const clock = new Date("2026-10-26T23:59:59Z");
  const firstPage = feed("recent", "2026-07-28T00:00:01Z").replace(
    "</channel>",
    "<item><title>old</title><link>https://sredec-sofia.org/old/</link><pubDate>2026-07-28T00:00:00Z</pubDate></item></channel>",
  );
  const fetchFeed = mock.fn(async () => emptyFeed);
  fetchFeed.mock.mockImplementationOnce(async () => firstPage);

  const items = await discoverRecentItems({ fetchFeed, delay: noDelay, now: () => clock });

  assert.deepEqual(items.map((item) => item.url), ["https://sredec-sofia.org/recent/"]);
  assert.equal(fetchFeed.mock.callCount(), 5);
  assert.equal(clock.toISOString(), "2026-10-26T23:59:59.000Z");
});

test("treats only a status-bearing later-page 404 as feed completion", async () => {
  let request = 0;
  const fetchFeed = async () => {
    request++;
    if (request === 1) {
      return feed("notice");
    }
    if (request === 2) {
      throw new RssFeedHttpError(404, "page2");
    }
    return emptyFeed;
  };

  assert.equal((await discoverRecentItems({ fetchFeed, delay: noDelay, now })).length, 1);
  assert.equal(request, 6);
});

for (const status of [404, 403, 500]) {
  test(`propagates first-page HTTP ${status}`, async () => {
    const fetchFeed = async () => {
      throw new RssFeedHttpError(status, "feed");
    };
    await assert.rejects(
      discoverRecentItems({ fetchFeed, delay: noDelay, now }),
      new RegExp(`RSS feed returned ${status}`),
    );
  });
}

for (const failure of [new RssFeedHttpError(500, "page2"), new Error("HTTP 404 transport failure")]) {
  test(`propagates later-page failure: ${failure.message}`, async () => {
    let request = 0;
    const fetchFeed = async () => {
      request++;
      if (request === 1) {
        return feed("notice");
      }
      throw failure;
    };
    await assert.rejects(discoverRecentItems({ fetchFeed, delay: noDelay, now }), failure);
  });
}

test("rejects repeated pages without requesting later categories", async () => {
  const fetchFeed = mock.fn(async () => feed("notice"));
  await assert.rejects(
    discoverRecentItems({ fetchFeed, delay: noDelay, now }),
    /RSS pagination repeated a page/,
  );
  assert.equal(fetchFeed.mock.callCount(), 2);
});

test("fails visibly after 100 pages instead of silently truncating a feed", async () => {
  const fetchFeed = mock.fn(async (url: string) => {
    const page = new URL(url).searchParams.get("paged") ?? "1";
    return feed(`post-${page}`);
  });
  const delay = mock.fn(noDelay);
  await assert.rejects(
    discoverRecentItems({ fetchFeed, delay, now }),
    /RSS pagination exceeded 100 pages/,
  );
  assert.equal(fetchFeed.mock.callCount(), 100);
  assert.equal(delay.mock.callCount(), 100);
});

test("reads the captured category fixtures and leaves relevance filtering to Obo", async () => {
  const files = ["useful.xml", "news.xml", "announcements.xml", "investment.xml", "discussion.xml"];
  const fetchFeed = async (url: string) => {
    const parsed = new URL(url);
    const index = FEED_URLS.findIndex((candidate) => new URL(candidate).pathname === parsed.pathname);
    return parsed.search ? emptyFeed : fixture(files[index]!);
  };

  const items = await discoverRecentItems({ fetchFeed, delay: noDelay, now });

  assert.equal(items.length, 2);
  assert.match(items[0]!.title, /ЕКОКЛАС/);
  assert.match(items[1]!.title, /военни оркестранти/);
  assert.equal(items[0]!.date, "2026-10-06T13:24:39.000Z");
  assert.equal(extractFeedItems(fixture("useful.xml"))[0]?.contentHtml, undefined);
});

test("discovers the captured graffiti notice behind the first announcements page", async () => {
  const fetchFeed = async (url: string) => {
    const parsed = new URL(url);
    if (!parsed.pathname.includes("saobshtenia")) {
      return emptyFeed;
    }
    if (parsed.searchParams.get("paged") === "3") {
      return emptyFeed;
    }
    return fixture(parsed.search ? "graffiti.xml" : "announcements.xml");
  };
  const items = await discoverRecentItems({ fetchFeed, delay: noDelay, now });

  assert.equal(items.length, 2);
  assert.equal(items[1]?.title, "Уведомление относно почистване на графити");
  assert.equal(items[1]?.date, "2026-09-08T12:39:00.000Z");
  assert.equal(items[1]?.url, "https://sredec-sofia.org/%d1%83%d0%b2%d0%b5%d0%b4%d0%be%d0%bc%d0%bb%d0%b5%d0%bd%d0%b8%d0%b5-%d0%be%d1%82%d0%bd%d0%be%d1%81%d0%bd%d0%be-%d0%bf%d0%be%d1%87%d0%b8%d1%81%d1%82%d0%b2%d0%b0%d0%bd%d0%b5-%d0%bd%d0%b0-%d0%b3%d1%80/");
});

test("preserves literal encoding, query and fragment while rejecting other hosts and malformed dates", () => {
  const xml = feed("notice").replace(
    "https://sredec-sofia.org/notice/",
    "https://sredec-sofia.org/Test%2fPost/?x=1&amp;y=2#notice",
  );
  assert.equal(extractFeedItems(xml)[0]?.url, "https://sredec-sofia.org/Test%2fPost/?x=1&y=2#notice");
  assert.deepEqual(extractFeedItems(xml.replace("sredec-sofia.org/", "example.com/")), []);
  assert.deepEqual(extractFeedItems(xml.replace("2026-09-08T08:00:00Z", "invalid")), []);
});
